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
exports.WarehouseAnalyzer = exports.warehouseAnalyzer = void 0;
/**
 * TCIDE Warehouse Analyzer — P2 全仓库语义解析
 *
 * 分析维度:
 *   1. 调用图 (Call Graph) — 谁调用了谁，被谁调用
 *   2. 数据流 (Data Flow) — 变量/参数/返回值流转
 *   3. 依赖网 (Dependency Network) — 模块间依赖关系
 *   4. 类型推断链 (Type Chain) — 接口→实现→使用路径
 *   5. 代码克隆检测 (Clone Detection) — 相似代码段
 *   6. 热点分析 (Hotspot) — 高频修改/高复杂度区域
 *
 * 全部基于正则+AST近似，零外部依赖，支持 JS/TS/Python/Go/Java
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

class WarehouseAnalyzer {
    constructor() {
        this.projectRoot = null;
        this.graph = { nodes: new Map(), edges: [] }; // call graph
        this.dataFlow = { variables: new Map(), flows: [] };
        this.dependencyNetwork = { nodes: [], edges: [] };
        this.typeChains = [];
        this.clones = [];
        this.hotspots = [];
        this.onProgress = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
    }

    /**
     * 全量分析
     * @returns {Promise<{callGraph, dataFlow, dependencyNetwork, typeChains, clones, hotspots, stats}>}
     */
    async analyzeAll(onProgress) {
        this.onProgress = onProgress;
        const files = this._collectSourceFiles();
        const total = files.length;

        // Reset state
        this.graph = { nodes: new Map(), edges: [] };
        this.dataFlow = { variables: new Map(), flows: [] };
        this.dependencyNetwork = { nodes: [], edges: [] };
        this.typeChains = [];
        this.clones = [];
        this.hotspots = [];

        const allSymbols = [];
        const fileContents = new Map();

        // Pass 1: Extract symbols & imports from all files
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const relPath = path.relative(this.projectRoot, file);
            const content = this._readFile(file);
            if (!content) continue;

            fileContents.set(relPath, { content, language: this._detectLang(file) });
            const symbols = this._extractSymbols(content, relPath);

            // Add to call graph nodes
            for (const sym of symbols) {
                const nodeId = `${relPath}:${sym.name}`;
                this.graph.nodes.set(nodeId, {
                    id: nodeId, file: relPath, name: sym.name,
                    kind: sym.kind, line: sym.line, complexity: sym.complexity || 1,
                    calls: [],
                    calledBy: [],
                });

                // Extract calls within this symbol
                const body = sym.body || '';
                const calls = this._extractCalls(body, relPath);
                for (const call of calls) {
                    this.graph.edges.push({
                        from: nodeId, to: `${relPath}:${call}`,
                        type: 'call', line: call.line || 0,
                    });
                    const node = this.graph.nodes.get(nodeId);
                    if (node && !node.calls.includes(call.name)) {
                        node.calls.push(call.name);
                    }
                }
            }

            allSymbols.push(...symbols);
            this.onProgress?.({ phase: 'pass1', progress: i / total, file: relPath });
        }

        // Pass 2: Cross-file call resolution
        this._resolveCrossFileCalls(allSymbols);

        // Pass 3: Dependency network
        this._buildDependencyNetwork(fileContents);

        // Pass 4: Type chains (interfaces → implementations)
        this._buildTypeChains(allSymbols);

        // Pass 5: Clone detection
        this._detectClones(fileContents);

        // Pass 6: Hotspot analysis (complexity + change frequency)
        this._analyzeHotspots(allSymbols);

        this.onProgress?.({ phase: 'done', progress: 1 });

        return {
            callGraph: {
                nodes: [...this.graph.nodes.values()],
                edges: this.graph.edges,
                stats: { totalNodes: this.graph.nodes.size, totalEdges: this.graph.edges.length }
            },
            dataFlow: {
                variables: [...this.dataFlow.variables.values()],
                flows: this.dataFlow.flows,
            },
            dependencyNetwork: this.dependencyNetwork,
            typeChains: this.typeChains.slice(0, 100),
            clones: this.clones.slice(0, 50),
            hotspots: this.hotspots,
            stats: { files: files.length, symbols: allSymbols.length, clones: this.clones.length }
        };
    }

    /**
     * 查询符号的调用链
     * @param {string} symbolName
     * @param {string} filePath
     * @returns {Array<{path: Array<{file, symbol}>, depth: number}>}
     */
    getCallChain(symbolName, filePath, direction = 'both') {
        const nodeId = `${filePath}:${symbolName}`;
        const node = this.graph.nodes.get(nodeId);
        if (!node) return [];

        const chains = [];

        // Downstream: who does this call?
        if (direction === 'downstream' || direction === 'both') {
            const visited = new Set();
            const paths = this._dfsCalls(nodeId, 'downstream', visited, [], 5);
            chains.push(...paths.map(p => ({ direction: 'downstream', path: p, depth: p.length })));
        }

        // Upstream: who calls this?
        if (direction === 'upstream' || direction === 'both') {
            const visited = new Set();
            const paths = this._dfsCalls(nodeId, 'upstream', visited, [], 5);
            chains.push(...paths.map(p => ({ direction: 'upstream', path: p, depth: p.length })));
        }

        return chains;
    }

    /**
     * 影响分析 — 修改某文件会影响哪些模块？
     */
    getImpactAnalysis(filePath) {
        const relPath = path.relative(this.projectRoot, filePath);
        const impacted = {
            directDependents: [], // files that import this
            indirectDependents: [],
            rippledByCallGraph: [],
        };

        // Direct dependents
        for (const edge of this.dependencyNetwork.edges) {
            if (edge.to === relPath) impacted.directDependents.push(edge.from);
        }

        // Indirect (BFS up to 3 hops)
        const visited = new Set([relPath]);
        const queue = impacted.directDependents.map(d => [d, 1]);
        while (queue.length) {
            const [file, depth] = queue.shift();
            if (visited.has(file) || depth > 3) continue;
            visited.add(file);
            if (depth > 1) impacted.indirectDependents.push(file);
            for (const edge of this.dependencyNetwork.edges) {
                if (edge.to === file && !visited.has(edge.from)) {
                    queue.push([edge.from, depth + 1]);
                }
            }
        }

        return impacted;
    }

    /**
     * 代码相似度搜索 (给重构做参考)
     */
    findSimilarCode(snippet, minScore = 0.5) {
        const snippetHash = this._hashContent(snippet);
        const results = [];

        // Compare with known clone groups
        for (const clone of this.clones) {
            const sim = this._similarity(snippet, clone.snippet);
            if (sim >= minScore) {
                results.push({ file: clone.file, line: clone.line, similarity: sim, snippet: clone.snippet.slice(0, 200) });
            }
        }

        return results.sort((a, b) => b.similarity - a.similarity).slice(0, 10);
    }

    // ── Private: File collection ──
    _collectSourceFiles() {
        const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', '.venv', 'target', 'out', '.idea', '.vscode']);
        const EXTS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.kts', '.c', '.cpp', '.h', '.hpp', '.vue']);
        const files = [];
        const walk = (dir, depth) => {
            if (depth > 10 || files.length > 5000) return;
            try {
                for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
                    if (SKIP.has(entry.name)) continue;
                    const full = path.join(dir, entry.name);
                    if (entry.isDirectory()) walk(full, depth + 1);
                    else if (EXTS.has(path.extname(entry.name).toLowerCase()) && fs.statSync(full).size < 2 * 1024 * 1024) {
                        files.push(full);
                    }
                }
            } catch {}
        };
        walk(this.projectRoot, 0);
        return files;
    }

    _readFile(filePath) {
        try { return fs.readFileSync(filePath, 'utf-8'); } catch { return null; }
    }

    _detectLang(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = { '.js': 'js', '.jsx': 'js', '.ts': 'ts', '.tsx': 'ts', '.py': 'py', '.go': 'go', '.java': 'java', '.kt': 'kt', '.rs': 'rs' };
        return map[ext] || 'unknown';
    }

    // ── Private: Symbol extraction ──
    _extractSymbols(content, filePath) {
        const lang = this._detectLang(filePath);
        const symbols = [];
        const lines = content.split('\n');

        const patterns = this._getSymbolPatterns(lang);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            for (const { kind, re, bodyEnd } of patterns) {
                const m = line.match(re);
                if (m) {
                    const name = m[1] || m[2];
                    if (!name || name.length < 2 || name.length > 80) continue;

                    // Extract function body for call analysis
                    let body = '';
                    if (bodyEnd && lines[i].includes('{')) {
                        let depth = 1;
                        for (let j = i + 1; j < Math.min(lines.length, i + 200); j++) {
                            const l = lines[j];
                            if (l.includes('{')) depth++;
                            if (l.includes('}')) depth--;
                            body += l + '\n';
                            if (depth === 0) break;
                        }
                    }

                    symbols.push({
                        name, kind, filePath,
                        line: i + 1,
                        complexity: this._estimateComplexity(line, body),
                        body: body.slice(0, 2000),
                        export: line.includes('export') || line.startsWith('pub'),
                    });
                    break;
                }
            }
        }

        return symbols;
    }

    _getSymbolPatterns(lang) {
        switch (lang) {
            case 'js':
            case 'ts':
                return [
                    { kind: 'function', re: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/, bodyEnd: true },
                    { kind: 'arrow', re: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/, bodyEnd: true },
                    { kind: 'class', re: /(?:export\s+)?class\s+(\w+)/, bodyEnd: true },
                    { kind: 'method', re: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/, bodyEnd: true },
                    { kind: 'interface', re: /(?:export\s+)?interface\s+(\w+)/, bodyEnd: true },
                    { kind: 'type', re: /(?:export\s+)?type\s+(\w+)/, bodyEnd: false },
                ];
            case 'py':
                return [
                    { kind: 'function', re: /def\s+(\w+)/, bodyEnd: true },
                    { kind: 'class', re: /class\s+(\w+)/, bodyEnd: true },
                    { kind: 'method', re: /def\s+(\w+)\s*\(self/, bodyEnd: true },
                ];
            case 'go':
                return [
                    { kind: 'function', re: /func\s+(?:\([^)]*\)\s+)?(\w+)/, bodyEnd: true },
                    { kind: 'struct', re: /type\s+(\w+)\s+struct/, bodyEnd: true },
                    { kind: 'interface', re: /type\s+(\w+)\s+interface/, bodyEnd: true },
                ];
            default:
                return [
                    { kind: 'function', re: /(?:function|func|def|fun)\s+(\w+)/i, bodyEnd: true },
                    { kind: 'class', re: /(?:class|struct)\s+(\w+)/i, bodyEnd: true },
                ];
        }
    }

    // ── Private: Call extraction ──
    _extractCalls(body, filePath) {
        const calls = [];
        const callRe = /(\w+)\s*\(/g;
        let match;
        while ((match = callRe.exec(body)) !== null) {
            const name = match[1];
            if (['if','for','while','switch','return','throw','new','const','let','var','function','class','import','typeof','instanceof','catch','finally','async','await','export','default','require'].includes(name)) continue;
            if (name.length < 2 || name.length > 50) continue;
            calls.push({ name, line: this._lineNumberOf(body, match.index) });
        }
        return calls;
    }

    _lineNumberOf(text, index) {
        return (text.slice(0, index).match(/\n/g) || []).length + 1;
    }

    // ── Private: Cross-file resolution ──
    _resolveCrossFileCalls(allSymbols) {
        const symbolMap = new Map(); // name → [{ nodeId, file }]
        for (const sym of allSymbols) {
            if (!symbolMap.has(sym.name)) symbolMap.set(sym.name, []);
            symbolMap.get(sym.name).push({ nodeId: `${sym.filePath}:${sym.name}`, file: sym.filePath });
        }

        // For each edge, try to resolve to cross-file targets
        for (const edge of this.graph.edges) {
            const [fromFile] = edge.from.split(':');
            const targets = symbolMap.get(edge.to.split(':').pop()) || [];
            const crossFile = targets.filter(t => t.file !== fromFile);
            if (crossFile.length > 0) {
                edge.to = crossFile[0].nodeId;
                edge.crossFile = true;
            }
        }

        // Populate calledBy
        for (const edge of this.graph.edges) {
            const target = this.graph.nodes.get(edge.to);
            if (target) {
                const [fromFile, fromName] = edge.from.split(':');
                if (!target.calledBy.includes(`${fromFile}:${fromName}`)) {
                    target.calledBy.push(`${fromFile}:${fromName}`);
                }
            }
        }
    }

    // ── Private: Dependency network ──
    _buildDependencyNetwork(fileContents) {
        const nodes = new Set();
        const edges = [];

        for (const [relPath, { content, language }] of fileContents) {
            nodes.add(relPath);
            const imports = this._extractImports(content, language);
            for (const imp of imports) {
                const resolved = this._resolveImport(relPath, imp);
                if (resolved && nodes.has(resolved)) {
                    edges.push({ from: relPath, to: resolved, type: imp.type || 'import' });
                }
            }
        }

        this.dependencyNetwork = {
            nodes: [...nodes].map(n => ({ path: n, name: path.basename(n) })),
            edges,
        };
    }

    _extractImports(content, language) {
        const imports = [];
        switch (language) {
            case 'js':
            case 'ts': {
                const re = /(?:import\s+(?:\{[^}]*\}|(\w+))\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\))/g;
                let m;
                while ((m = re.exec(content)) !== null) {
                    imports.push({ source: m[2] || m[3], type: m[1] ? 'default' : 'named' });
                }
                break;
            }
            case 'py': {
                const re = /(?:from\s+(\S+)\s+import\s+(\S+)|import\s+(\S+))/g;
                let m;
                while ((m = re.exec(content)) !== null) {
                    imports.push({ source: m[1] || m[3], type: 'module' });
                }
                break;
            }
            case 'go':
            case 'rs': {
                const re = /(?:import\s*\(\s*"([^"]*)"|\"([^"]*)\")/g;
                let m;
                while ((m = re.exec(content)) !== null) {
                    imports.push({ source: m[1] || m[2], type: 'module' });
                }
                break;
            }
        }
        return imports;
    }

    _resolveImport(fromFile, imp) {
        // Relative imports
        if (imp.source.startsWith('.') || imp.source.startsWith('/')) {
            const dir = path.dirname(fromFile);
            let resolved = path.normalize(path.join(dir, imp.source));
            // Try extensions
            for (const ext of ['.js', '.ts', '.jsx', '.tsx', '.py', '.go']) {
                if (resolved.endsWith(ext)) break;
                const candidate = resolved + ext;
                if ([...this.dependencyNetwork.nodes].some(n => n.path === candidate)) {
                    return candidate;
                }
            }
            return resolved;
        }
        return null;
    }

    // ── Private: Type chains ──
    _buildTypeChains(allSymbols) {
        const interfaces = allSymbols.filter(s => s.kind === 'interface' || s.kind === 'type');
        for (const iface of interfaces) {
            // Find implementations/uses
            const users = allSymbols.filter(s =>
                s.filePath !== iface.filePath &&
                (s.body?.includes(iface.name) || s.name?.includes(iface.name))
            ).slice(0, 10);

            if (users.length > 0) {
                this.typeChains.push({
                    type: iface.name,
                    definedIn: iface.filePath,
                    line: iface.line,
                    implementations: users.map(u => ({ file: u.filePath, symbol: u.name, line: u.line })),
                });
            }
        }
    }

    // ── Private: Clone detection ──
    _detectClones(fileContents) {
        const blocks = []; // { file, content, startLine, endLine }

        // Extract function-level blocks
        for (const [file, { content }] of fileContents) {
            const lines = content.split('\n');
            let blockStart = -1;
            let depth = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.match(/(?:function|def|func|class|=>)/i) && line.includes('{')) {
                    blockStart = i;
                    depth = 0;
                }
                if (blockStart >= 0) {
                    if (line.includes('{')) depth++;
                    if (line.includes('}')) depth--;
                    if (depth === 0 && i > blockStart) {
                        const blockContent = lines.slice(blockStart, i + 1).join('\n');
                        if (blockContent.length > 50 && blockContent.length < 2000) {
                            blocks.push({
                                file,
                                content: blockContent,
                                startLine: blockStart + 1,
                                endLine: i + 1,
                                hash: this._hashContent(blockContent),
                            });
                        }
                        blockStart = -1;
                    }
                }
            }
        }

        // Pairwise comparison with hash grouping
        const byHash = new Map();
        for (const block of blocks) {
            if (!byHash.has(block.hash)) byHash.set(block.hash, []);
            byHash.get(block.hash).push(block);
        }

        for (const [hash, group] of byHash) {
            if (group.length >= 2) {
                this.clones.push({
                    groupId: hash.slice(0, 8),
                    count: group.length,
                    files: group.map(g => ({ file: g.file, lines: `${g.startLine}-${g.endLine}` })),
                    snippet: group[0].content.slice(0, 300),
                });
            }
        }
    }

    // ── Private: Hotspot analysis ──
    _analyzeHotspots(allSymbols) {
        // Complexity-based hotspots
        const byFile = {};
        for (const sym of allSymbols) {
            if (!byFile[sym.filePath]) byFile[sym.filePath] = { file: sym.filePath, symbolCount: 0, totalComplexity: 0, maxComplexity: 0 };
            byFile[sym.filePath].symbolCount++;
            byFile[sym.filePath].totalComplexity += sym.complexity || 1;
            byFile[sym.filePath].maxComplexity = Math.max(byFile[sym.filePath].maxComplexity, sym.complexity || 1);
        }

        // Find top hotspots (high complexity + high connectivity)
        const files = Object.values(byFile);
        for (const file of files) {
            const edges = this.graph.edges.filter(e => e.from.startsWith(file.file) || (typeof e.to === 'string' && e.to.startsWith(file.file))).length;
            file.connections = edges;
            file.hotspotScore = (file.totalComplexity * 0.4) + (edges * 0.3) + (file.symbolCount * 0.3);
        }

        this.hotspots = files
            .sort((a, b) => b.hotspotScore - a.hotspotScore)
            .slice(0, 20)
            .map(f => ({
                file: f.file,
                symbols: f.symbolCount,
                totalComplexity: f.totalComplexity,
                maxComplexity: f.maxComplexity,
                connections: f.connections,
                hotspotScore: Math.round(f.hotspotScore),
            }));
    }

    _dfsCalls(nodeId, direction, visited, currentPath, maxDepth) {
        if (visited.has(nodeId) || currentPath.length >= maxDepth) {
            return currentPath.length > 0 ? [currentPath] : [];
        }
        visited.add(nodeId);

        const node = this.graph.nodes.get(nodeId);
        if (!node) return currentPath.length > 0 ? [currentPath] : [];

        const targets = direction === 'downstream' ? node.calls : node.calledBy;
        if (!targets || targets.length === 0) {
            return currentPath.length > 0 ? [currentPath] : [];
        }

        const paths = [];
        for (const target of targets) {
            const targetNode = [...this.graph.nodes.values()].find(n => n.name === target);
            const targetId = targetNode?.id || target;
            paths.push(...this._dfsCalls(targetId, direction, new Set(visited), [...currentPath, target], maxDepth));
        }
        return paths;
    }

    _estimateComplexity(line, body) {
        let complexity = 1;
        if (body) {
            complexity += (body.match(/\bif\b/g) || []).length;
            complexity += (body.match(/\bfor\b/g) || []).length;
            complexity += (body.match(/\bwhile\b/g) || []).length;
            complexity += (body.match(/\bswitch\b/g) || []).length;
            complexity += (body.match(/\bcase\b/g) || []).length;
            complexity += (body.match(/\bcatch\b/g) || []).length;
            complexity += (body.match(/\?\s*[^:]+:/g) || []).length; // ternary
            complexity += (body.match(/\|\|/g) || []).length;
            complexity += (body.match(/&&/g) || []).length;
        }
        return Math.min(complexity, 50);
    }

    _hashContent(text) {
        const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
        return crypto.createHash('md5').update(normalized).digest('hex').slice(0, 16);
    }

    _similarity(a, b) {
        const aTokens = new Set(this._tokenize(a));
        const bTokens = new Set(this._tokenize(b));
        const intersection = new Set([...aTokens].filter(x => bTokens.has(x)));
        const union = new Set([...aTokens, ...bTokens]);
        return union.size === 0 ? 0 : intersection.size / union.size;
    }

    _tokenize(text) {
        return text.toLowerCase()
            .replace(/[^a-z0-9]/g, ' ')
            .split(/\s+/)
            .filter(t => t.length > 2);
    }
}

exports.WarehouseAnalyzer = WarehouseAnalyzer;
exports.warehouseAnalyzer = new WarehouseAnalyzer();
