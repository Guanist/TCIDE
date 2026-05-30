"use strict";
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") result[k[i]] = mod[k];
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.LintManager = exports.lintManager = void 0;
/**
 * TCIDE Lint Manager — P0 实时语法校验 & 代码格式化
 *
 * 能力:
 *   - ESLint / Prettier / Stylelint 集成
 *   - 行内实时标红报错，悬浮展示错误原因+修复建议
 *   - 区分语法错误、规范警告、性能提示
 *   - 文件右下角错误/警告数量角标
 *   - 单文件/全项目一键批量修复
 *   - 保存时自动格式化+修复
 *
 * 架构: 主进程管理 Lint 工具发现、进程执行、结果聚合。
 *       通过 IPC 推送诊断结果到渲染进程展示。
 */
const child_process = require("child_process");
const path = require("path");
const fs = require("fs");

/** Lint 工具定义 */
const LINT_TOOLS = {
    eslint: {
        name: 'ESLint',
        npmPkg: 'eslint',
        configFiles: ['.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.yaml', '.eslintrc.yml', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.ts', 'eslint.config.cjs'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.vue'],
        lintArgs: (filePath) => ['--format', 'json', filePath],
        projectLintArgs: (root) => ['--format', 'json', '--ext', '.js,.jsx,.ts,.tsx,.mjs,.cjs', root],
        fixArgs: (filePath) => ['--fix', filePath],
        parseDiagnostics: (raw) => _parseEslintOutput(raw),
    },
    prettier: {
        name: 'Prettier',
        npmPkg: 'prettier',
        configFiles: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yaml', '.prettierrc.yml', '.prettierrc.toml', 'prettier.config.js', 'prettier.config.mjs'],
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.json', '.css', '.scss', '.less', '.html', '.vue', '.md', '.yaml', '.yml', '.graphql'],
        lintArgs: (filePath) => ['--check', filePath],
        projectLintArgs: (root) => ['--check', `${root}/**/*`],
        fixArgs: (filePath) => ['--write', filePath],
        parseDiagnostics: (raw) => _parsePrettierOutput(raw),
    },
};

/**
 * @typedef {Object} Diagnostic
 * @property {'error'|'warning'|'info'|'hint'} severity
 * @property {string} message - 错误描述
 * @property {number} line - 行号 (1-indexed)
 * @property {number} column - 列号 (1-indexed)
 * @property {number} [endLine]
 * @property {number} [endColumn]
 * @property {string} [ruleId] - ESLint 规则 ID
 * @property {string} [source] - 来源工具 (eslint/prettier)
 * @property {string} [fix] - 修复建议文本
 */

class LintManager {
    constructor() {
        /** @type {(diagnostics: Diagnostic[]) => void|null} */
        this.onDiagnostics = null;
        /** @type {(status: {totalErrors: number, totalWarnings: number, linting: boolean, formatting: boolean}) => void|null} */
        this.onStatusChange = null;

        this.status = { totalErrors: 0, totalWarnings: 0, linting: false, formatting: false };
        /** @type {Map<string, Diagnostic[]>} */
        this.diagnosticsByFile = new Map();
        /** @type {Map<string, boolean>} 工具安装缓存 */
        this.installedCache = new Map();
        /** @internal 防抖定时器 */
        this._debounceTimers = new Map();
    }

    // ── 工具检测 ──

    /**
     * 检查 Lint 工具是否安装
     * @param {string} projectRoot
     * @param {'eslint'|'prettier'} tool
     */
    isInstalled(projectRoot, tool) {
        const cacheKey = `${projectRoot}::${tool}`;
        if (this.installedCache.has(cacheKey)) return this.installedCache.get(cacheKey);

        const toolDef = LINT_TOOLS[tool];
        if (!toolDef) return false;

        // 1. 检查项目 node_modules
        const localBin = path.join(projectRoot, 'node_modules', '.bin', tool);
        if (_isExecutable(localBin)) {
            this.installedCache.set(cacheKey, true);
            return true;
        }

        // 2. 检查项目配置
        for (const cfgFile of toolDef.configFiles) {
            if (fs.existsSync(path.join(projectRoot, cfgFile))) {
                this.installedCache.set(cacheKey, true);
                return true;
            }
        }

        // 3. 检查全局安装
        try {
            child_process.execSync(`${tool} --version`, { stdio: 'pipe', timeout: 3000 });
            this.installedCache.set(cacheKey, true);
            return true;
        } catch {
            this.installedCache.set(cacheKey, false);
            return false;
        }
    }

    getInstallGuide(tool) {
        const guides = {
            eslint: 'npm install -D eslint   或   yarn add -D eslint',
            prettier: 'npm install -D prettier   或   yarn add -D prettier',
        };
        return guides[tool] || '';
    }

    // ── Lint 操作 ──

    /**
     * 对单文件执行 Lint
     * @param {string} filePath
     * @param {string} projectRoot
     * @returns {Promise<{diagnostics: Diagnostic[], errors: number, warnings: number}>}
     */
    async lintFile(filePath, projectRoot) {
        const ext = path.extname(filePath).toLowerCase();
        const allDiagnostics = [];

        for (const [toolKey, toolDef] of Object.entries(LINT_TOOLS)) {
            if (!toolDef.extensions.includes(ext)) continue;
            if (!this.isInstalled(projectRoot, toolKey)) continue;

            try {
                const raw = this._runTool(toolKey, toolDef.lintArgs(filePath), projectRoot);
                const diags = toolDef.parseDiagnostics(raw).filter(d => d.line > 0);
                for (const d of diags) d.source = toolKey;
                allDiagnostics.push(...diags);
            } catch (err) {
                // 工具执行失败（如语法错误导致 ESLint 崩溃）
                const errMsg = err.stderr || err.message || String(err);
                if (errMsg.includes('Parsing error') || errMsg.includes('SyntaxError')) {
                    allDiagnostics.push({
                        severity: 'error',
                        message: `语法解析失败: ${errMsg.split('\n')[0]}`,
                        line: 1, column: 1,
                        source: toolKey,
                    });
                }
            }
        }

        const errors = allDiagnostics.filter(d => d.severity === 'error').length;
        const warnings = allDiagnostics.filter(d => d.severity !== 'error').length;

        this.diagnosticsByFile.set(filePath, allDiagnostics);
        this._updateStatus();
        if (this.onDiagnostics) this.onDiagnostics(allDiagnostics);

        return { diagnostics: allDiagnostics, errors, warnings };
    }

    /**
     * 格式化单个文件
     * @param {string} filePath
     * @param {string} projectRoot
     * @returns {Promise<{success: boolean, formatted: string|null, error: string}>}
     */
    async formatFile(filePath, projectRoot) {
        if (!this.isInstalled(projectRoot, 'prettier')) {
            return { success: false, formatted: null, error: 'Prettier 未安装' };
        }

        try {
            const toolDef = LINT_TOOLS.prettier;
            this._runTool('prettier', toolDef.fixArgs(filePath), projectRoot);
            // Prettier --write 直接修改文件
            const formatted = fs.readFileSync(filePath, 'utf-8');
            return { success: true, formatted, error: '' };
        } catch (err) {
            return { success: false, formatted: null, error: err.stderr || err.message || String(err) };
        }
    }

    /**
     * 全项目 Lint
     * @param {string} projectRoot
     * @param {(file: string, percent: number) => void} [onProgress]
     * @returns {Promise<Map<string, Diagnostic[]>>}
     */
    async lintProject(projectRoot, onProgress) {
        this.status.linting = true;
        this._updateStatus();

        const result = new Map();
        const files = this._collectProjectFiles(projectRoot);
        const total = files.length;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                const { diagnostics } = await this.lintFile(file, projectRoot);
                result.set(file, diagnostics);
            } catch { result.set(file, []); }
            if (onProgress) onProgress(file, Math.round(((i + 1) / total) * 100));
        }

        this.status.linting = false;
        this._updateStatus();
        return result;
    }

    /**
     * 批量修复
     * @param {string} projectRoot
     * @param {string[]} filePaths
     * @returns {Promise<Array<{file: string, fixed: boolean, error: string}>>}
     */
    async fixAll(projectRoot, filePaths) {
        const results = [];
        const files = filePaths || Array.from(this.diagnosticsByFile.keys());

        for (const file of files) {
            try {
                if (this.isInstalled(projectRoot, 'eslint')) {
                    this._runTool('eslint', LINT_TOOLS.eslint.fixArgs(file), projectRoot);
                }
                if (this.isInstalled(projectRoot, 'prettier')) {
                    this._runTool('prettier', LINT_TOOLS.prettier.fixArgs(file), projectRoot);
                }
                results.push({ file, fixed: true, error: '' });
            } catch (err) {
                results.push({ file, fixed: false, error: err.stderr || err.message || String(err) });
            }
        }

        return results;
    }

    // ── 查询 ──

    getFileSummary(filePath) {
        const diags = this.diagnosticsByFile.get(filePath) || [];
        const errors = diags.filter(d => d.severity === 'error').length;
        const warnings = diags.filter(d => d.severity !== 'error').length;
        return { errors, warnings, total: diags.length };
    }

    getProjectSummary() {
        let totalErrors = 0, totalWarnings = 0;
        for (const diags of this.diagnosticsByFile.values()) {
            totalErrors += diags.filter(d => d.severity === 'error').length;
            totalWarnings += diags.filter(d => d.severity !== 'error').length;
        }
        return { totalErrors, totalWarnings };
    }

    clearFile(filePath) {
        this.diagnosticsByFile.delete(filePath);
    }

    clearAll() {
        this.diagnosticsByFile.clear();
        this.status = { totalErrors: 0, totalWarnings: 0, linting: false, formatting: false };
        this._updateStatus();
    }

    // ── 内部 ──

    _runTool(tool, args, cwd) {
        const result = child_process.spawnSync(tool, args, {
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 30000,
            encoding: 'utf-8',
            shell: process.platform === 'win32',
        });
        if (result.error) throw result.error;
        // Prettier 以非零退出码表示需要格式化（非真实错误）
        if (tool === 'prettier' && result.status === 1) return result.stdout;
        if (result.status !== 0 && result.status !== 1) {
            const err = new Error(result.stderr || `Lint 工具退出码: ${result.status}`);
            err.stderr = result.stderr;
            err.stdout = result.stdout;
            throw err;
        }
        return result.stdout;
    }

    _collectProjectFiles(root, maxFiles = 500) {
        const files = [];
        const exclude = ['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', '__pycache__', '.venv', 'venv', 'coverage'];
        const exts = new Set();
        for (const tool of Object.values(LINT_TOOLS)) {
            for (const ext of tool.extensions) exts.add(ext);
        }

        function walk(dir, depth) {
            if (depth > 8 || files.length >= maxFiles) return;
            let entries;
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
            catch { return; }
            for (const e of entries) {
                if (e.name.startsWith('.') && e.name !== '.eslintrc.js' && e.name !== '.prettierrc.js') continue;
                const full = path.join(dir, e.name);
                if (e.isDirectory()) {
                    if (!exclude.includes(e.name)) walk(full, depth + 1);
                } else if (e.isFile() && exts.has(path.extname(e.name).toLowerCase())) {
                    files.push(full);
                }
            }
        }
        walk(root, 0);
        return files;
    }

    _updateStatus() {
        const summary = this.getProjectSummary();
        this.status.totalErrors = summary.totalErrors;
        this.status.totalWarnings = summary.totalWarnings;
        if (this.onStatusChange) this.onStatusChange({ ...this.status });
    }
}
exports.LintManager = LintManager;

// ── 输出解析器 ──

/** 解析 ESLint JSON 输出 */
function _parseEslintOutput(raw) {
    if (!raw || !raw.trim()) return [];
    try {
        const results = JSON.parse(raw);
        const diags = [];
        for (const fileResult of results) {
            for (const msg of fileResult.messages || []) {
                diags.push({
                    severity: msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info',
                    message: msg.message,
                    line: msg.line || 1,
                    column: msg.column || 1,
                    endLine: msg.endLine,
                    endColumn: msg.endColumn,
                    ruleId: msg.ruleId || null,
                    fix: msg.fix ? msg.fix.text || null : null,
                    source: 'eslint',
                });
            }
        }
        return diags;
    } catch {
        return [];
    }
}

/** 解析 Prettier 输出 */
function _parsePrettierOutput(raw) {
    if (!raw || !raw.trim()) return [];
    const diags = [];
    // Prettier --check 输出 "file.js" 表示该文件需要格式化
    const lines = raw.split('\n').filter(l => l.trim());
    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('Checking') && !trimmed.startsWith('Code style')) {
            diags.push({
                severity: 'warning',
                message: '代码格式不符合 Prettier 规范，建议格式化',
                line: 1, column: 1,
                source: 'prettier',
                ruleId: 'prettier-format',
            });
        }
    }
    return diags;
}

/** 检查文件是否可执行（Windows 需加 .cmd） */
function _isExecutable(filePath) {
    if (process.platform === 'win32') {
        return fs.existsSync(filePath + '.cmd') || fs.existsSync(filePath + '.ps1') || fs.existsSync(filePath);
    }
    try {
        fs.accessSync(filePath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

exports.lintManager = new LintManager();
