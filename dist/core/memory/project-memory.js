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
exports.ProjectMemory = exports.projectMemory = void 0;
/**
 * TCIDE Project Memory — P1 项目记忆沉淀引擎
 *
 * 自动记录/召回：
 *   - 技术栈 (语言/框架/构建工具/包管理器)
 *   - 编码风格 (.editorconfig/.eslintrc/.prettierrc/命名约定)
 *   - 目录规范 (项目结构树模板)
 *   - 历史重构记录 (重命名/拆分/合并 的代码片段)
 *   - 通用解决方案模板 (从对话中提取的 fix 模式)
 *
 * 新会话启动时自动注入到 System Prompt 的静态缓存段。
 */
const fs = require("fs");
const path = require("path");

const MEMORY_CACHE_TTL = 1800000; // 30分钟缓存有效期

class ProjectMemory {
    constructor() {
        this.projectRoot = null;
        this.memoryDir = null;
        this.memory = null;
        this.lastCacheTime = 0;
        this.changeListeners = [];
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
        this.memoryDir = path.join(projectRoot, '.tcide', 'memory');
        if (!fs.existsSync(this.memoryDir)) fs.mkdirSync(this.memoryDir, { recursive: true });
        this._loadMemory();
        this._autoDetect();
    }

    // ── 记忆注入 (给 System Prompt 用) ──
    getMemoryInjection() {
        // 检查缓存是否过期
        if (this.memory && Date.now() - this.lastCacheTime < MEMORY_CACHE_TTL) {
            return this._formatInjection();
        }
        this._autoDetect();
        return this._formatInjection();
    }

    // ── 自动检测 ──
    _autoDetect() {
        if (!this.projectRoot) return;
        this.memory = this.memory || {};

        // 技术栈检测
        this.memory.techStack = this._detectTechStack();

        // 编码风格
        this.memory.codingStyle = this._detectCodingStyle();

        // 目录规范
        this.memory.directoryLayout = this._detectDirectoryLayout();

        // 包管理
        this.memory.packageManager = this._detectPackageManager();

        // 自动保存
        this._saveMemory();
        this.lastCacheTime = Date.now();
    }

    // ── 手动记录 ──
    recordRefactor(type, description, oldCode, newCode, filePath) {
        if (!this.memory) this.memory = {};
        if (!this.memory.refactors) this.memory.refactors = [];

        this.memory.refactors.push({
            type,              // rename / extract / inline / move
            description,
            oldCode: oldCode?.slice(0, 500),
            newCode: newCode?.slice(0, 500),
            filePath: filePath ? path.relative(this.projectRoot, filePath) : null,
            timestamp: Date.now(),
        });

        // Keep last 50 refactors
        if (this.memory.refactors.length > 50) {
            this.memory.refactors = this.memory.refactors.slice(-50);
        }

        this._saveMemory();
        this.lastCacheTime = Date.now();
    }

    recordPattern(trigger, solution, context, source = 'conversation') {
        if (!this.memory) this.memory = {};
        if (!this.memory.patterns) this.memory.patterns = [];

        // Check duplicate
        const exists = this.memory.patterns.find(p => 
            p.trigger === trigger || (solution && p.solution?.slice(0, 100) === solution?.slice(0, 100))
        );
        if (exists) {
            exists.count = (exists.count || 1) + 1;
            exists.lastUsed = Date.now();
        } else {
            this.memory.patterns.push({
                trigger,
                solution: solution?.slice(0, 1000),
                context: context?.slice(0, 500),
                source,
                count: 1,
                createdAt: Date.now(),
                lastUsed: Date.now(),
            });
        }

        // Keep last 100 patterns
        if (this.memory.patterns.length > 100) {
            this.memory.patterns = this.memory.patterns.slice(-100);
        }

        this._saveMemory();
        this.lastCacheTime = Date.now();
    }

    recordDecision(topic, decision, alternatives, rationale) {
        if (!this.memory) this.memory = {};
        if (!this.memory.decisions) this.memory.decisions = [];

        this.memory.decisions.push({
            topic,
            decision,
            alternatives: alternatives || [],
            rationale: rationale?.slice(0, 500),
            timestamp: Date.now(),
        });

        if (this.memory.decisions.length > 30) {
            this.memory.decisions = this.memory.decisions.slice(-30);
        }

        this._saveMemory();
    }

    // ── 召回 ──
    searchPatterns(query) {
        if (!this.memory?.patterns) return [];
        const queryLower = query.toLowerCase();
        return this.memory.patterns
            .filter(p => 
                p.trigger?.toLowerCase().includes(queryLower) ||
                p.solution?.toLowerCase().includes(queryLower) ||
                p.context?.toLowerCase().includes(queryLower)
            )
            .sort((a, b) => b.lastUsed - a.lastUsed)
            .slice(0, 5);
    }

    searchDecisions(query) {
        if (!this.memory?.decisions) return [];
        const queryLower = query.toLowerCase();
        return this.memory.decisions
            .filter(d => d.topic?.toLowerCase().includes(queryLower) || d.decision?.toLowerCase().includes(queryLower))
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, 5);
    }

    getRecentRefactors(limit = 10) {
        if (!this.memory?.refactors) return [];
        return this.memory.refactors.slice(-limit).reverse();
    }

    // ── 时间线 ──
    getTimeline() {
        const events = [];
        if (this.memory?.refactors) {
            for (const r of this.memory.refactors) {
                events.push({ type: 'refactor', ...r });
            }
        }
        if (this.memory?.decisions) {
            for (const d of this.memory.decisions) {
                events.push({ type: 'decision', ...d });
            }
        }
        events.sort((a, b) => b.timestamp - a.timestamp);
        return events.slice(0, 20);
    }

    // ── 导出/重置 ──
    exportAll() {
        return JSON.parse(JSON.stringify(this.memory || {}));
    }

    reset() {
        this.memory = null;
        if (this.memoryDir && fs.existsSync(this.memoryDir)) {
            try { fs.rmSync(this.memoryDir, { recursive: true }); } catch {}
        }
    }

    onChange(callback) {
        this.changeListeners.push(callback);
    }

    // ── 私有: 检测逻辑 ──
    _detectTechStack() {
        const stack = {
            languages: [],
            frameworks: [],
            buildTools: [],
            databases: [],
            lastDetected: Date.now(),
        };

        // Package.json
        const pkgJson = path.join(this.projectRoot, 'package.json');
        if (fs.existsSync(pkgJson)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgJson, 'utf-8'));
                if (pkg.dependencies) {
                    // Framework detection
                    if (pkg.dependencies.react || pkg.devDependencies?.react) stack.frameworks.push('React');
                    if (pkg.dependencies.vue || pkg.devDependencies?.vue) stack.frameworks.push('Vue');
                    if (pkg.dependencies.next || pkg.devDependencies?.next) stack.frameworks.push('Next.js');
                    if (pkg.dependencies.express) stack.frameworks.push('Express');
                    if (pkg.dependencies.nestjs || pkg.dependencies['@nestjs/core']) stack.frameworks.push('NestJS');
                    if (pkg.dependencies.fastify) stack.frameworks.push('Fastify');
                    if (pkg.dependencies.angular || pkg.dependencies['@angular/core']) stack.frameworks.push('Angular');
                    if (pkg.dependencies.svelte || pkg.devDependencies?.svelte) stack.frameworks.push('Svelte');
                    if (pkg.dependencies.electron) stack.frameworks.push('Electron');
                    if (pkg.dependencies.tauri || pkg.dependencies['@tauri-apps/cli']) stack.frameworks.push('Tauri');
                    if (pkg.dependencies.three) stack.frameworks.push('Three.js');
                    if (pkg.dependencies.express || pkg.dependencies.koa) {
                        if (pkg.dependencies.prisma || pkg.dependencies.typeorm || pkg.dependencies.knex) stack.databases.push('SQL (ORM)');
                    }
                    if (pkg.dependencies.mongoose || pkg.dependencies.mongodb) stack.databases.push('MongoDB');
                    if (pkg.dependencies.redis || pkg.dependencies.ioredis) stack.databases.push('Redis');
                    if (pkg.dependencies.pg || pkg.dependencies['node-postgres']) stack.databases.push('PostgreSQL');
                    if (pkg.dependencies.mysql2 || pkg.dependencies.mysql) stack.databases.push('MySQL');
                    // Build tools
                    if (pkg.dependencies.webpack || pkg.devDependencies?.webpack) stack.buildTools.push('Webpack');
                    if (pkg.dependencies.vite || pkg.devDependencies?.vite) stack.buildTools.push('Vite');
                    if (pkg.dependencies.turbo || pkg.devDependencies?.turbo) stack.buildTools.push('Turbo');
                    if (pkg.dependencies.esbuild || pkg.devDependencies?.esbuild) stack.buildTools.push('ESBuild');
                }
                if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) {
                    stack.languages.push('TypeScript');
                } else {
                    stack.languages.push('JavaScript');
                }
            } catch {}
        }

        // Python
        const reqTxt = path.join(this.projectRoot, 'requirements.txt');
        const pyproj = path.join(this.projectRoot, 'pyproject.toml');
        if (fs.existsSync(reqTxt) || fs.existsSync(pyproj)) {
            stack.languages.push('Python');
            if (fs.existsSync(pyproj)) {
                try {
                    const pyContent = fs.readFileSync(pyproj, 'utf-8');
                    if (pyContent.includes('django')) stack.frameworks.push('Django');
                    if (pyContent.includes('fastapi')) stack.frameworks.push('FastAPI');
                    if (pyContent.includes('flask')) stack.frameworks.push('Flask');
                } catch {}
            }
        }

        // Golang
        if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) {
            stack.languages.push('Go');
            try {
                const goMod = fs.readFileSync(path.join(this.projectRoot, 'go.mod'), 'utf-8');
                if (goMod.includes('gin-gonic')) stack.frameworks.push('Gin');
                if (goMod.includes('echo')) stack.frameworks.push('Echo');
                if (goMod.includes('fiber')) stack.frameworks.push('Fiber');
            } catch {}
        }

        // Rust
        if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) {
            stack.languages.push('Rust');
            try {
                const cargo = fs.readFileSync(path.join(this.projectRoot, 'Cargo.toml'), 'utf-8');
                if (cargo.includes('actix')) stack.frameworks.push('Actix');
                if (cargo.includes('axum')) stack.frameworks.push('Axum');
                if (cargo.includes('rocket')) stack.frameworks.push('Rocket');
                if (cargo.includes('tauri')) stack.frameworks.push('Tauri');
            } catch {}
        }

        // Java/Kotlin
        if (fs.existsSync(path.join(this.projectRoot, 'build.gradle')) || fs.existsSync(path.join(this.projectRoot, 'build.gradle.kts'))) {
            stack.languages.push('Kotlin/Java');
            stack.buildTools.push('Gradle');
        }
        if (fs.existsSync(path.join(this.projectRoot, 'pom.xml'))) {
            stack.languages.push('Java');
            stack.buildTools.push('Maven');
        }

        return stack;
    }

    _detectCodingStyle() {
        const style = {
            indent: '2 spaces',
            quotes: 'single',
            semicolons: true,
            maxLineLength: 100,
            naming: {},
        };

        // Read .editorconfig
        const editorConfig = path.join(this.projectRoot, '.editorconfig');
        if (fs.existsSync(editorConfig)) {
            try {
                const content = fs.readFileSync(editorConfig, 'utf-8');
                const indentMatch = content.match(/indent_size\s*=\s*(\d+)/);
                if (indentMatch) style.indent = `${indentMatch[1]} spaces`;
                const styleMatch = content.match(/indent_style\s*=\s*(\w+)/);
                if (styleMatch?.[1] === 'tab') style.indent = 'tabs';
            } catch {}
        }

        // Read .eslintrc
        const eslintFiles = ['.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yaml'];
        for (const f of eslintFiles) {
            const fp = path.join(this.projectRoot, f);
            if (fs.existsSync(fp)) {
                try {
                    let config;
                    if (f.endsWith('.json')) {
                        config = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                    } else {
                        const content = fs.readFileSync(fp, 'utf-8');
                        if (content.includes('singleQuote')) style.quotes = content.includes("singleQuote: true") ? 'single' : 'double';
                        if (content.includes('semi')) style.semicolons = content.match(/['"]semi['"]\s*:\s*false/) ? false : true;
                        if (content.includes('max-len')) {
                            const m = content.match(/max-len['"]\s*:\s*\[.*?(\d+)/);
                            if (m) style.maxLineLength = parseInt(m[1]);
                        }
                    }
                } catch {}
                break;
            }
        }

        // Read .prettierrc
        for (const f of ['.prettierrc', '.prettierrc.json', 'prettier.config.js']) {
            const fp = path.join(this.projectRoot, f);
            if (fs.existsSync(fp)) {
                try {
                    const config = JSON.parse(fs.readFileSync(fp, 'utf-8'));
                    if (config.singleQuote !== undefined) style.quotes = config.singleQuote ? 'single' : 'double';
                    if (config.semi !== undefined) style.semicolons = config.semi;
                    if (config.tabWidth) style.indent = `${config.tabWidth} spaces`;
                    if (config.printWidth) style.maxLineLength = config.printWidth;
                } catch {}
                break;
            }
        }

        return style;
    }

    _detectDirectoryLayout() {
        const layout = { topLevel: [], hasSrc: false, hasTests: false, hasMonorepo: false };
        try {
            const entries = fs.readdirSync(this.projectRoot, { withFileTypes: true });
            layout.topLevel = entries
                .filter(e => e.isDirectory() && !e.name.startsWith('.') || e.name === '.github')
                .map(e => e.name)
                .filter(name => !['node_modules', '.git'].includes(name));
            layout.hasSrc = layout.topLevel.includes('src');
            layout.hasTests = layout.topLevel.includes('test') || layout.topLevel.includes('tests') || layout.topLevel.includes('__tests__');
            layout.hasMonorepo = fs.existsSync(path.join(this.projectRoot, 'packages')) ||
                                 fs.existsSync(path.join(this.projectRoot, 'apps'));
        } catch {}
        return layout;
    }

    _detectPackageManager() {
        if (fs.existsSync(path.join(this.projectRoot, 'pnpm-lock.yaml'))) return 'pnpm';
        if (fs.existsSync(path.join(this.projectRoot, 'yarn.lock'))) return 'yarn';
        if (fs.existsSync(path.join(this.projectRoot, 'package-lock.json'))) return 'npm';
        if (fs.existsSync(path.join(this.projectRoot, 'bun.lockb'))) return 'bun';
        if (fs.existsSync(path.join(this.projectRoot, 'Cargo.lock'))) return 'cargo';
        if (fs.existsSync(path.join(this.projectRoot, 'go.sum'))) return 'go mod';
        return 'unknown';
    }

    _formatInjection() {
        if (!this.memory) return '';

        const m = this.memory;
        let injection = '\n【项目记忆 - Project Memory】\n';

        if (m.techStack) {
            injection += `\n## 技术栈\n`;
            if (m.techStack.languages?.length) injection += `- 语言: ${m.techStack.languages.join(', ')}\n`;
            if (m.techStack.frameworks?.length) injection += `- 框架: ${m.techStack.frameworks.join(', ')}\n`;
            if (m.techStack.buildTools?.length) injection += `- 构建工具: ${m.techStack.buildTools.join(', ')}\n`;
            if (m.techStack.databases?.length) injection += `- 数据库: ${m.techStack.databases.join(', ')}\n`;
        }

        if (m.packageManager) injection += `\n- 包管理器: ${m.packageManager}\n`;

        if (m.codingStyle) {
            injection += `\n## 编码风格\n`;
            injection += `- 缩进: ${m.codingStyle.indent}\n`;
            injection += `- 引号: ${m.codingStyle.quotes}\n`;
            injection += `- 分号: ${m.codingStyle.semicolons ? '需要' : '不需要'}\n`;
        }

        if (m.directoryLayout) {
            injection += `\n## 项目结构\n`;
            injection += `- 顶层目录: ${m.directoryLayout.topLevel?.slice(0, 8).join(', ') || '无'}\n`;
            if (m.directoryLayout.hasSrc) injection += `- 源码在 src/ 下\n`;
            if (m.directoryLayout.hasTests) injection += `- 有测试目录\n`;
        }

        if (m.patterns?.length) {
            const frequent = m.patterns
                .filter(p => p.count >= 2)
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
            if (frequent.length) {
                injection += `\n## 常用修复模式\n`;
                for (const p of frequent) {
                    injection += `- 触发: ${p.trigger?.slice(0, 60)} → 方案: ${p.solution?.slice(0, 80)}\n`;
                }
            }
        }

        if (m.decisions?.length) {
            const recent = m.decisions.slice(-5).reverse();
            injection += `\n## 近期技术决策\n`;
            for (const d of recent) {
                injection += `- ${d.topic}: ${d.decision?.slice(0, 60)}\n`;
            }
        }

        injection += '\n【项目记忆结束】\n';
        return injection;
    }

    _saveMemory() {
        if (!this.memoryDir) return;
        try {
            fs.writeFileSync(
                path.join(this.memoryDir, 'memory.json'),
                JSON.stringify(this.memory, null, 2),
                'utf-8'
            );
        } catch (err) {
            console.warn('[ProjectMemory] Save failed:', err.message);
        }
    }

    _loadMemory() {
        if (!this.memoryDir) return;
        const fp = path.join(this.memoryDir, 'memory.json');
        if (fs.existsSync(fp)) {
            try {
                this.memory = JSON.parse(fs.readFileSync(fp, 'utf-8'));
            } catch {
                this.memory = {};
            }
        } else {
            this.memory = {};
        }
        this.lastCacheTime = 0; // force re-detect
    }
}

exports.ProjectMemory = ProjectMemory;
exports.projectMemory = new ProjectMemory();
