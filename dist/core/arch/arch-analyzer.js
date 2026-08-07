"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
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
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchitectureAnalyzer = void 0;
/**
 * PersonalIDE - Architecture Analyzer
 * 依赖图分析 + 代码异味检测 + 架构概览
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const LANG_EXTS = {
    '.kt': 'kotlin', '.java': 'java', '.xml': 'xml', '.gradle': 'gradle', '.kts': 'kotlin',
    '.py': 'python', '.js': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json', '.md': 'markdown', '.rs': 'rust', '.go': 'go',
    '.css': 'css', '.scss': 'css', '.html': 'html', '.yaml': 'yaml', '.yml': 'yaml',
    '.toml': 'toml', '.sh': 'shell',
};
const SKIP_DIRS = new Set(['node_modules', 'build', '.gradle', 'target', 'dist', '.git', '.idea', '.vscode', '__pycache__', '.venv']);
// ── Import regex patterns per language ──
const IMPORT_PATTERNS = [
    // Python
    { exts: ['.py'], regex: /^(?:from\s+(\S+)\s+import|import\s+(\S+))/gm, group: 1 },
    // TypeScript/JavaScript
    { exts: ['.ts', '.tsx', '.js', '.jsx'], regex: /(?:import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/gm, group: 1 },
    // Kotlin/Java
    { exts: ['.kt', '.kts', '.java'], regex: /^import\s+([\w.]+)/gm, group: 1 },
    // Go
    { exts: ['.go'], regex: /^import\s+(?:"([^"]+)"|\(\s*(?:"([^"]+)"\s*)*\))/gm, group: 1 },
    // Rust
    { exts: ['.rs'], regex: /^use\s+([\w:]+)/gm, group: 1 },
];
// ── Code smell patterns ──
const SMELL_PATTERNS = [
    { type: 'todo-fixme', regex: /\b(TODO|FIXME|HACK|XXX)\b/gi, severity: 'warn', msg: '未完成的 TODO/FIXME' },
    { type: 'magic-number', regex: /\b(?!0\b|1\b|2\b|10\b|100\b|60\b|24\b)\d{3,}\b/g, severity: 'warn', msg: '魔法数字' },
];
class ArchitectureAnalyzer {
    projectRoot;
    nodes = new Map();
    edges = [];
    smells = [];
    totalLines = 0;
    totalSize = 0;
    languages = {};
    fileCount = 0;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    async analyze() {
        await this.walkAndAnalyze(this.projectRoot);
        this.resolveDeps();
        this.detectCircularDeps();
        return {
            projectType: this.detectProjectType(),
            totalFiles: this.fileCount,
            totalLines: this.totalLines,
            totalSize: this.totalSize,
            languages: this.languages,
            nodes: Array.from(this.nodes.values()),
            edges: this.edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to)),
            smells: this.smells.slice(0, 500),
            entryPoints: this.findEntryPoints(),
            circularDeps: this.circularDeps,
        };
    }
    circularDeps = [];
    async walkAndAnalyze(dir, depth = 0) {
        if (depth > 10)
            return;
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name))
                continue;
            const fullPath = path.join(dir, entry.name);
            const relPath = path.relative(this.projectRoot, fullPath);
            if (entry.isDirectory()) {
                // 检查是否为模块（含 source 文件）
                const hasSrc = this.dirHasSourceFiles(fullPath);
                if (hasSrc) {
                    this.nodes.set(relPath, {
                        id: relPath, name: entry.name, path: relPath,
                        type: 'directory', language: '', size: 0, lines: 0,
                        imports: [], exports: [], depCount: 0,
                    });
                }
                await this.walkAndAnalyze(fullPath, depth + 1);
            }
            else {
                const ext = path.extname(entry.name).toLowerCase();
                const lang = LANG_EXTS[ext];
                if (!lang)
                    continue;
                this.fileCount++;
                this.languages[lang] = (this.languages[lang] || 0) + 1;
                let content = '';
                try {
                    const stat = fs.statSync(fullPath);
                    this.totalSize += stat.size;
                    if (stat.size > 500 * 1024)
                        continue; // skip > 500KB
                    content = fs.readFileSync(fullPath, 'utf-8');
                }
                catch {
                    continue;
                }
                const lines = content.split('\n');
                const lineCount = lines.length;
                this.totalLines += lineCount;
                // 提取 imports
                const imports = this.extractImports(content, ext);
                // 提取 exports (顶层声明)
                const exports = this.extractExports(content, lang);
                this.nodes.set(relPath, {
                    id: relPath, name: entry.name, path: relPath,
                    type: 'file', language: lang,
                    size: fs.statSync(fullPath).size, lines: lineCount,
                    imports, exports, depCount: 0,
                });
                // 依赖边
                for (const imp of imports) {
                    this.edges.push({ from: relPath, to: imp, type: 'import' });
                }
                // 代码异味检测
                this.detectSmells(relPath, content, lines);
            }
        }
    }
    extractImports(content, ext) {
        const imports = new Set();
        for (const pattern of IMPORT_PATTERNS) {
            if (!pattern.exts.includes(ext))
                continue;
            const matches = content.matchAll(pattern.regex);
            for (const m of matches) {
                const imp = m[pattern.group] || m[2] || m[3];
                if (imp && !imp.startsWith('java.') && !imp.startsWith('kotlin.')) {
                    imports.add(imp);
                }
            }
        }
        return Array.from(imports);
    }
    extractExports(content, lang) {
        const exports = [];
        const patterns = [];
        if (['kotlin', 'java'].includes(lang)) {
            patterns.push({ regex: /^(?:(?:data\s+|sealed\s+|abstract\s+|open\s+)?class|interface|object|enum\s+class)\s+(\w+)/gm, nameGroup: 1 }, { regex: /^(?:suspend\s+)?fun\s+(\w+)/gm, nameGroup: 1 });
        }
        else if (['typescript', 'javascript'].includes(lang)) {
            patterns.push({ regex: /^export\s+(?:default\s+)?(?:class|interface|function|const|let|var|type|enum)\s+(\w+)/gm, nameGroup: 1 });
        }
        else if (lang === 'python') {
            patterns.push({ regex: /^(?:class|def)\s+(\w+)/gm, nameGroup: 1 });
        }
        for (const p of patterns) {
            for (const m of content.matchAll(p.regex)) {
                exports.push(m[p.nameGroup]);
            }
        }
        return exports;
    }
    detectSmells(relPath, content, lines) {
        // 大文件 (>500 行)
        if (lines.length > 500) {
            this.smells.push({ file: relPath, type: 'long-file', line: 1, severity: 'warn',
                message: `文件过长 (${lines.length} 行)，建议拆分` });
        }
        // 长函数 (>80 行)
        const funcPatterns = [
            /^(?:suspend\s+)?fun\s+(\w+)/gm,
            /^def\s+(\w+)/gm,
            /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm,
        ];
        for (const pattern of funcPatterns) {
            for (const m of content.matchAll(pattern)) {
                const startLine = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
                // 估算函数体长度（粗粒度：到下一个同缩进级别）
                let endLine = Math.min(startLine + 80, lines.length);
                for (let i = startLine; i < lines.length; i++) {
                    if (i - startLine > 80) {
                        endLine = i;
                        break;
                    }
                }
                if (endLine - startLine > 80) {
                    this.smells.push({ file: relPath, type: 'long-function', line: startLine, severity: 'warn',
                        message: `函数 ${m[1]} 过长 (约 ${endLine - startLine} 行)` });
                }
            }
        }
        // 大类 (>300 行)
        if (content.includes('class ') && lines.length > 300) {
            this.smells.push({ file: relPath, type: 'large-class', line: 1, severity: 'warn',
                message: `类可能过大 (${lines.length} 行)` });
        }
        // TODO/FIXME
        for (const pattern of SMELL_PATTERNS) {
            for (const m of content.matchAll(pattern.regex)) {
                const line = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
                this.smells.push({ file: relPath, type: pattern.type, line, severity: 'warn',
                    message: `${pattern.msg}: ${m[0]}` });
            }
        }
        // 深度嵌套（超过4层缩进）
        const indentCounts = [];
        for (const line of lines) {
            const indent = (line.match(/^(\s+)/)?.[1]?.length || 0) / 2;
            if (indent > 4)
                indentCounts.push(indent);
        }
        if (indentCounts.length > 10) {
            const maxIndent = Math.max(...indentCounts);
            this.smells.push({ file: relPath, type: 'deep-nesting', line: 1, severity: 'warn',
                message: `存在深度嵌套 (最大 ${maxIndent} 层)` });
        }
        // 参数过多的函数 (>5 个参数)
        const paramPattern = /(?:fun\s+\w+\(([^)]+)\)|def\s+\w+\(([^)]+)\)|function\s+\w+\(([^)]+)\))/g;
        for (const m of content.matchAll(paramPattern)) {
            const params = (m[1] || m[2] || m[3] || '').split(',').filter(s => s.trim() && !s.trim().startsWith('//'));
            if (params.length > 5) {
                const line = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
                this.smells.push({ file: relPath, type: 'too-many-params', line, severity: 'warn',
                    message: `函数参数过多 (${params.length} 个)` });
            }
        }
    }
    // ── 依赖解析：模糊导入映射到实际文件 ──
    resolveDeps() {
        const nodeList = Array.from(this.nodes.values());
        const pathIndex = new Map(); // 短路径 → 完整路径
        for (const node of nodeList) {
            if (node.type === 'file') {
                pathIndex.set(node.name, node.id);
                pathIndex.set(node.id, node.id);
                // 无扩展名版本
                const noExt = node.name.replace(/\.[^.]+$/, '');
                if (noExt !== node.name)
                    pathIndex.set(noExt, node.id);
            }
        }
        const resolved = [];
        for (const edge of this.edges) {
            let targetId = pathIndex.get(edge.to);
            // Kotlin/Java: import com.foo.Bar → src/com/foo/Bar.kt
            if (!targetId && edge.to.includes('.')) {
                const parts = edge.to.split('.');
                for (let i = 0; i < parts.length; i++) {
                    const candidate = parts.slice(i).join('/');
                    for (const ext of ['.kt', '.java', '.ts', '.js', '.py', '.go', '.rs']) {
                        const found = pathIndex.get(candidate + ext);
                        if (found) {
                            targetId = found;
                            break;
                        }
                    }
                    if (targetId)
                        break;
                }
            }
            // 模糊匹配：导入路径包含文件名
            if (!targetId) {
                const importLower = edge.to.toLowerCase().replace(/\\/g, '/');
                for (const [name, id] of pathIndex) {
                    if (name.toLowerCase().replace(/\\/g, '/').endsWith(importLower)) {
                        targetId = id;
                        break;
                    }
                }
            }
            if (targetId) {
                resolved.push({ ...edge, to: targetId });
                // 更新被依赖计数
                const node = this.nodes.get(targetId);
                if (node)
                    node.depCount++;
            }
        }
        this.edges = resolved;
    }
    detectCircularDeps() {
        const adj = new Map();
        for (const edge of this.edges) {
            if (!adj.has(edge.from))
                adj.set(edge.from, new Set());
            adj.get(edge.from).add(edge.to);
        }
        const visited = new Set();
        const stack = [];
        const onStack = new Set();
        const dfs = (node) => {
            const cycles = [];
            visited.add(node);
            stack.push(node);
            onStack.add(node);
            for (const neighbor of adj.get(node) || []) {
                if (!visited.has(neighbor)) {
                    cycles.push(...dfs(neighbor));
                }
                else if (onStack.has(neighbor)) {
                    const cycleStart = stack.indexOf(neighbor);
                    if (cycleStart >= 0) {
                        cycles.push([...stack.slice(cycleStart), neighbor]);
                    }
                }
            }
            stack.pop();
            onStack.delete(node);
            return cycles;
        };
        for (const node of adj.keys()) {
            if (!visited.has(node)) {
                this.circularDeps.push(...dfs(node));
            }
        }
        // 生成对应的 smell 条目
        for (const cycle of this.circularDeps) {
            const file = cycle[0] || '';
            this.smells.push({
                file, type: 'circular-dep', line: 1, severity: 'error',
                message: `循环依赖: ${cycle.join(' → ')}`,
            });
        }
    }
    findEntryPoints() {
        const entries = [];
        const candidates = [
            'src/main/index.ts', 'src/index.ts', 'index.ts', 'main.ts',
            'src/main/java', 'app/src/main/java', 'main.py', 'app.py',
            'main.go', 'src/main.rs', 'src/main/kotlin',
        ];
        for (const c of candidates) {
            const full = path.join(this.projectRoot, c);
            if (fs.existsSync(full)) {
                // 如果是目录，找主类文件
                if (fs.statSync(full).isDirectory()) {
                    const files = fs.readdirSync(full).filter(f => f.endsWith('.kt') || f.endsWith('.java'));
                    for (const f of files.slice(0, 3))
                        entries.push(c + '/' + f);
                }
                else {
                    entries.push(c);
                }
            }
        }
        // 降级：找最小的且有导出的文件
        if (entries.length === 0) {
            const nodeList = Array.from(this.nodes.values())
                .filter(n => n.type === 'file' && n.depCount > 0)
                .sort((a, b) => b.depCount - a.depCount);
            for (const n of nodeList.slice(0, 3))
                entries.push(n.path);
        }
        return entries;
    }
    dirHasSourceFiles(dir) {
        const exts = ['.kt', '.java', '.ts', '.tsx', '.js', '.py', '.go', '.rs'];
        try {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.isFile() && exts.includes(path.extname(entry.name).toLowerCase()))
                    return true;
            }
        }
        catch {
            return false;
        }
        return false;
    }
    detectProjectType() {
        if (fs.existsSync(path.join(this.projectRoot, 'build.gradle.kts')) ||
            fs.existsSync(path.join(this.projectRoot, 'build.gradle'))) {
            if (fs.existsSync(path.join(this.projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml')))
                return 'android';
            return 'gradle';
        }
        if (fs.existsSync(path.join(this.projectRoot, 'package.json')))
            return 'npm';
        if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml')))
            return 'rust';
        if (fs.existsSync(path.join(this.projectRoot, 'go.mod')))
            return 'go';
        if (fs.existsSync(path.join(this.projectRoot, 'pyproject.toml')) ||
            fs.existsSync(path.join(this.projectRoot, 'setup.py')))
            return 'python';
        return 'generic';
    }
}
exports.ArchitectureAnalyzer = ArchitectureAnalyzer;
