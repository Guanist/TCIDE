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
exports.AutoHealManager = exports.autoHealManager = void 0;
/**
 * TCIDE AutoHeal Manager — P0 编译/运行报错自动自愈闭环
 *
 * 流程:
 *   终端抓取报错日志 → 自动定位报错文件+代码行 → AI 生成修复代码 → 自动应用修改 → 重新编译验证
 *
 * 容错规则:
 *   - 单类问题最多自动重试 3 次
 *   - 重试失败立即停止，弹窗提示人工介入
 *   - 禁止死循环（全局重试上限 + 同类错误去重 + 超时保护）
 */
const child_process = require("child_process");
const path = require("path");
const fs = require("fs");

/** 默认配置 */
const DEFAULT_CONFIG = {
    /** 单类问题最大重试次数 */
    maxRetries: 3,
    /** 全局最大重试次数 */
    globalMaxRetries: 12,
    /** 每次修复超时 (ms) */
    fixTimeoutMs: 60000,
    /** 编译超时 (ms) */
    buildTimeoutMs: 120000,
    /** 相同指纹错误的最小间隔 (ms)，防止死循环 */
    dedupIntervalMs: 10000,
};

/**
 * @typedef {Object} BuildError
 * @property {string} filePath - 报错文件路径
 * @property {number} line - 行号
 * @property {number} [column]
 * @property {string} message - 错误消息
 * @property {string} [code] - 错误代码
 * @property {string} raw - 原始报错行
 * @property {string} fingerprint - 错误指纹（用于去重）
 */

/**
 * @typedef {Object} HealResult
 * @property {number} fixed - 修复成功数
 * @property {number} failed - 修复失败数
 * @property {Array<{error: BuildError, success: boolean, message: string}>} results
 */

class AutoHealManager {
    constructor(config = {}) {
        this.options = { ...DEFAULT_CONFIG, ...config };
        /** @type {Map<string, number>} 错误指纹 → 重试次数 */
        this.retryCounts = new Map();
        /** @type {Map<string, number>} 错误指纹 → 最近修复时间 */
        this.lastFixTime = new Map();
        /** @type {number} 全局重试计数 */
        this.globalRetryCount = 0;

        /** @type {(phase: string, message: string) => void|null} */
        this.onProgress = null;
        /** @type {(result: HealResult) => void|null} */
        this.onComplete = null;

        this.isRunning = false;
        this.abortController = null;
    }

    // ── 错误解析 ──
    /**
     * 从编译/运行输出中解析错误
     * @param {string} output - 编译输出
     * @param {string} projectRoot - 项目根目录
     * @returns {BuildError[]}
     */
    parseErrors(output, projectRoot) {
        if (!output) return [];
        const errors = [];
        const lines = output.split('\n');

        // 多种编译器/运行时错误格式
        for (const line of lines) {
            const parsed = this._parseSingleError(line, projectRoot);
            if (parsed) {
                parsed.fingerprint = this._fingerprintError(parsed);
                errors.push(parsed);
            }
        }

        // 如果没有解析到结构化错误，尝试整段解析
        if (errors.length === 0 && output.length > 0) {
            const fallback = this._parseFallback(output, projectRoot);
            if (fallback) {
                fallback.fingerprint = this._fingerprintError(fallback);
                errors.push(fallback);
            }
        }

        // 去重（同文件同行同类型只保留一个）
        return this._deduplicateErrors(errors);
    }

    // ── 自动修复主循环 ──
    /**
     * 执行自动修复闭环
     * @param {BuildError[]} errors - 待修复的错误
     * @param {string} projectRoot - 项目根目录
     * @param {(error: BuildError, context: string) => Promise<{code: string, explanation: string}>} aiFixFn - AI 修复函数
     * @param {string} buildCmd - 编译/验证命令
     * @returns {Promise<HealResult>}
     */
    async autoHeal(errors, projectRoot, aiFixFn, buildCmd) {
        if (!errors || errors.length === 0) return { fixed: 0, failed: 0, results: [] };

        this.isRunning = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const results = [];

        for (const error of errors) {
            if (signal.aborted) break;

            // 检查重试限制
            const fingerprint = error.fingerprint;
            const retries = this.retryCounts.get(fingerprint) || 0;

            if (retries >= this.options.maxRetries) {
                results.push({
                    error,
                    success: false,
                    message: `已达最大重试次数 (${this.options.maxRetries})，需人工介入`,
                });
                this._progress('skip', `跳过 ${error.filePath}:${error.line} (已重试 ${retries} 次)`);
                continue;
            }

            if (this.globalRetryCount >= this.options.globalMaxRetries) {
                results.push({ error, success: false, message: '全局重试已达上限，停止自愈' });
                this._progress('abort', '全局重试上限已到');
                break;
            }

            // 去重保护：相同错误短时间内不重复修复
            const lastFix = this.lastFixTime.get(fingerprint) || 0;
            if (Date.now() - lastFix < this.options.dedupIntervalMs) {
                this._progress('skip', `跳过重复错误: ${error.message.substring(0, 80)}`);
                continue;
            }

            this._progress('fixing', `正在修复: ${error.filePath}:${error.line} — ${error.message.substring(0, 80)}`);

            try {
                // 1. 读取错误上下文（错误行 ± 20 行）
                const context = this._readContext(error, projectRoot);

                // 2. 调用 AI 修复
                const fixResult = await Promise.race([
                    aiFixFn(error, context),
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('AI 修复超时')), this.options.fixTimeoutMs)
                    ),
                ]);

                if (signal.aborted) break;

                // 3. 备份原文件
                const backupPath = this._backupFile(error.filePath);

                // 4. 应用修复
                try {
                    fs.writeFileSync(error.filePath, fixResult.code, 'utf-8');
                } catch (writeErr) {
                    // 回滚
                    if (backupPath) fs.copyFileSync(backupPath, error.filePath);
                    throw new Error(`写入修复代码失败: ${writeErr.message}`);
                }

                // 5. 重新编译验证
                const buildOk = await this._verifyBuild(buildCmd, projectRoot, signal);

                if (buildOk) {
                    results.push({ error, success: true, message: fixResult.explanation || '修复成功' });
                    this.retryCounts.delete(fingerprint);
                    this._progress('fixed', `✓ 已修复: ${error.filePath}:${error.line}`);
                } else {
                    // 回滚
                    if (backupPath) fs.copyFileSync(backupPath, error.filePath);
                    this.retryCounts.set(fingerprint, retries + 1);
                    this.lastFixTime.set(fingerprint, Date.now());
                    results.push({ error, success: false, message: '修复后编译仍失败，已回滚' });
                    this._progress('retry', `✗ 修复验证失败: ${error.filePath}:${error.line} (重试 ${retries + 1}/${this.options.maxRetries})`);
                }

                // 清理备份
                if (backupPath) {
                    try { fs.unlinkSync(backupPath); } catch {}
                }

            } catch (err) {
                this.retryCounts.set(fingerprint, retries + 1);
                results.push({ error, success: false, message: err.message || String(err) });
                this._progress('error', `修复异常: ${err.message}`);
            }

            this.globalRetryCount++;
        }

        this.isRunning = false;
        const summary = {
            fixed: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length,
            results,
        };

        if (this.onComplete) {
            try { this.onComplete(summary); } catch {}
        }

        return summary;
    }

    /** 中止自动修复 */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
        }
        this.isRunning = false;
        this._progress('abort', '用户手动中止自愈流程');
    }

    // ── 错误解析器 ──
    /** @returns {BuildError|null} */
    _parseSingleError(line, projectRoot) {
        // TypeScript / JavaScript
        let match = line.match(/^(.+?)\((\d+),(\d+)\)\s*:\s*error\s+(\w+)\s*:\s*(.+)$/);
        if (match) return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), column: parseInt(match[3]), code: match[4], message: match[5].trim(), raw: line };

        // Python traceback
        match = line.match(/^\s*File\s+"(.+?)",\s*line\s+(\d+)(?:,\s*in\s+(\w+))?/);
        if (match) return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), message: match[3] ? `in ${match[3]}` : 'Python Error', raw: line };

        // Go
        match = line.match(/^(.+?\.go):(\d+):(\d+):\s*(.+)$/);
        if (match) return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), column: parseInt(match[3]), message: match[4].trim(), raw: line };

        // GCC / Clang
        match = line.match(/^(.+?):(\d+):(\d+):\s*(?:fatal\s+)?(error|warning):\s*(.+)$/i);
        if (match) return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), column: parseInt(match[3]), message: match[5].trim(), raw: line };

        // Rust
        match = line.match(/-->\s*(.+?):(\d+):(\d+)/);
        if (match) return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), column: parseInt(match[3]), message: 'Rust compilation error', raw: line };

        // ESLint
        match = line.match(/^\s*(\d+):(\d+)\s+(error|warning)\s+(.+?)\s{2,}(.+)$/);
        if (match) return { filePath: '', line: parseInt(match[1]), column: parseInt(match[2]), message: `${match[4]} — ${match[5]}`, raw: line, code: match[4] };

        // 通用：file:line: message
        match = line.match(/^(.+?):(\d+):\s*(.+)$/);
        if (match && (line.includes('error') || line.includes('Error'))) {
            return { filePath: this._resolvePath(match[1], projectRoot), line: parseInt(match[2]), message: match[3].trim(), raw: line };
        }

        return null;
    }

    _parseFallback(output, projectRoot) {
        // 无法结构化解析时，提取第一条错误描述
        const errorLines = output.split('\n').filter(l =>
            /error|exception|failed|panic|traceback/i.test(l) && l.length > 10
        );
        if (errorLines.length === 0) return null;
        return {
            filePath: '',
            line: 1,
            message: errorLines[0].trim().substring(0, 200),
            raw: errorLines[0],
        };
    }

    // ── 文件操作 ──
    _readContext(error, projectRoot) {
        if (!error.filePath || !fs.existsSync(error.filePath)) {
            return `// 无法读取源文件: ${error.filePath}\n// 错误: ${error.message}`;
        }

        try {
            const content = fs.readFileSync(error.filePath, 'utf-8');
            const lines = content.split('\n');
            const start = Math.max(0, error.line - 21);
            const end = Math.min(lines.length, error.line + 20);
            const contextLines = lines.slice(start, end);

            // 标记错误行
            const annotated = contextLines.map((l, i) => {
                const lineNum = start + i + 1;
                const marker = lineNum === error.line ? '>>>' : '   ';
                return `${marker} ${String(lineNum).padStart(4)}| ${l}`;
            });

            return `// 文件: ${error.filePath}\n// 错误行: ${error.line}\n// 错误: ${error.message}\n` + annotated.join('\n');
        } catch {
            return `// 无法读取文件: ${error.filePath}\n// 错误: ${error.message}`;
        }
    }

    _backupFile(filePath) {
        if (!filePath || !fs.existsSync(filePath)) return null;
        const backupPath = filePath + '.tcide-autofix-backup';
        try {
            fs.copyFileSync(filePath, backupPath);
            return backupPath;
        } catch {
            return null;
        }
    }

    async _verifyBuild(buildCmd, projectRoot, signal) {
        if (!buildCmd) return true; // 无验证命令，默认通过

        try {
            const result = child_process.execSync(buildCmd, {
                cwd: projectRoot,
                timeout: this.options.buildTimeoutMs,
                encoding: 'utf-8',
                stdio: 'pipe',
                shell: process.platform === 'win32',
            });
            return true;
        } catch (err) {
            // 编译失败
            if (signal.aborted) return false;

            // 检查是否属于可重试的错误类型
            const output = (err.stdout || '') + (err.stderr || '');
            const newErrors = this.parseErrors(output, projectRoot);
            return newErrors.length === 0; // 无新错误即视为通过
        }
    }

    // ── 工具方法 ──
    _resolvePath(filePath, projectRoot) {
        if (!filePath) return '';
        if (path.isAbsolute(filePath)) return filePath;
        if (projectRoot) return path.join(projectRoot, filePath);
        return filePath;
    }

    _fingerprintError(error) {
        // 指纹 = 文件名 + 行号 + 错误代码 + 消息关键词哈希
        const key = `${error.filePath || ''}:${error.line}:${error.code || ''}:${error.message.substring(0, 50)}`;
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            hash = ((hash << 5) - hash) + key.charCodeAt(i);
            hash |= 0;
        }
        return String(hash);
    }

    _deduplicateErrors(errors) {
        const seen = new Map();
        const result = [];
        for (const err of errors) {
            const key = err.fingerprint || `${err.filePath}:${err.line}:${err.message.substring(0, 40)}`;
            if (!seen.has(key)) {
                seen.set(key, true);
                result.push(err);
            }
        }
        return result;
    }

    _progress(phase, message) {
        if (this.onProgress) {
            try { this.onProgress(phase, message); } catch {}
        }
    }
}
exports.AutoHealManager = AutoHealManager;

exports.autoHealManager = new AutoHealManager();
