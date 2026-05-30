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
exports.VectorIndexer = exports.vectorIndexer = void 0;
/**
 * TCIDE Vector Indexer — P1 项目全局向量索引
 *
 * 实现:
 *   - TF-IDF 向量化 (零外部依赖)
 *   - 全仓库文件/函数/类/接口的语义结构化索引
 *   - 增量更新 (仅重索引变更文件)
 *   - BM25 语义召回 (文件级别 + 符号级别)
 *
 * 索引内容: 文件路径/名称、Import/Package、Type(type/interface/class)、
 *           函数/方法签名、JSDoc、注释、包依赖关系
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.venv', 'venv', '.idea', '.vscode', 'target', 'out']);
const INDEX_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.pyw', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.c', '.cpp', '.cc', '.h', '.hpp', '.vue', '.svelte']);

class VectorIndexer {
    constructor() {
        this.indexPath = null;
        this.documents = new Map(); // docId -> { type, file, symbol, text, tokens }
        this.invertedIndex = new Map(); // token -> [{docId, tf, positions}]
        this.idfValues = new Map(); // token -> idf
        this.fileHashes = new Map(); // filePath -> hash (for incremental)
        this.docCount = 0;
        this.isIndexing = false;
        this.onProgress = null;
    }

    // ── 初始化 ──
    init(projectRoot) {
        this.projectRoot = projectRoot;
        this.indexPath = path.join(projectRoot, '.tcide', 'index', 'vector.json');
        const dir = path.dirname(this.indexPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        this._loadIndex();
    }

    // ── 全量索引 ──
    async indexAll(onProgress) {
        if (this.isIndexing) return { indexed: 0, skipped: 0 };
        this.isIndexing = true;
        this.onProgress = onProgress;

        const files = this._collectFiles();
        let indexed = 0, skipped = 0;

        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const hash = this._hashFile(file);
            const oldHash = this.fileHashes.get(file);

            if (hash === oldHash) {
                skipped++;
                this.onProgress?.({ phase: 'skip', file, progress: i / files.length });
                continue;
            }

            try {
                this._removeFileDocuments(file);
                const docs = this._parseFile(file);
                for (const doc of docs) {
                    const docId = `doc_${this.docCount++}`;
                    this.documents.set(docId, doc);
                    this._indexDocument(docId, doc);
                }
                this.fileHashes.set(file, hash);
                indexed++;
                this.onProgress?.({ phase: 'index', file, progress: i / files.length });
            } catch (err) {
                console.warn(`[VectorIndex] Skip ${file}:`, err.message);
            }
        }

        this._computeIDF();
        this._saveIndex();
        this.isIndexing = false;
        this.onProgress?.({ phase: 'done', indexed, skipped });
        return { indexed, skipped };
    }

    // ── 语义搜索 (BM25) ──
    /**
     * @param {string} query - 自然语言查询
     * @param {object} options - { topK, filterType, filterLanguage, minScore }
     * @returns {Array<{docId, type, file, symbol, text, score}>}
     */
    search(query, options = {}) {
        const { topK = 20, filterType, filterLanguage, minScore = 0.1 } = options;
        const queryTokens = this._tokenize(query);

        // BM25 scoring
        const scores = new Map(); // docId -> score
        const avgDocLength = this._avgDocLength();
        const k1 = 1.2, b = 0.75;
        const idfThreshold = Math.log(1 + (this.docCount / Math.max(this.docCount * 0.1, 1)));

        for (const token of queryTokens) {
            const idf = this.idfValues.get(token) || 0;
            if (idf < idfThreshold) continue; // skip common terms

            const postings = this.invertedIndex.get(token);
            if (!postings) continue;

            for (const posting of postings) {
                const doc = this.documents.get(posting.docId);
                if (!doc) continue;
                if (filterType && doc.type !== filterType) continue;
                if (filterLanguage && doc.language !== filterLanguage) continue;

                const tf = posting.tf || 1;
                const docLen = doc.tokens ? doc.tokens.length : 1;
                const bm25 = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / Math.max(avgDocLength, 1)));

                const current = scores.get(posting.docId) || 0;
                scores.set(posting.docId, current + bm25);
            }
        }

        // Sort & return top K
        const results = [];
        for (const [docId, score] of scores) {
            if (score < minScore) continue;
            const doc = this.documents.get(docId);
            results.push({ docId, ...doc, score });
        }

        results.sort((a, b) => b.score - a.score);
        return options.returnAll ? results : results.slice(0, topK);
    }

    // ── 符号搜索 (按函数/类名) ──
    searchSymbol(name, options = {}) {
        return this.search(name, {
            filterType: 'symbol',
            topK: options.topK || 10,
            filterLanguage: options.language,
        });
    }

    // ── 获取文件的所有索引符号 ──
    getFileSymbols(filePath) {
        const syms = [];
        for (const [docId, doc] of this.documents) {
            if (doc.file === filePath && doc.type === 'symbol') {
                syms.push({ docId, ...doc });
            }
        }
        return syms;
    }

    // ── 获取索引统计 ──
    getStats() {
        return {
            totalDocuments: this.documents.size,
            totalFiles: this.fileHashes.size,
            totalTokens: this.invertedIndex.size,
            types: this._countByType(),
            languages: this._countByLanguage(),
        };
    }

    // ── 获取依赖图 ──
    getDependencies(filePath) {
        const deps = [];
        for (const [docId, doc] of this.documents) {
            if (doc.file === filePath && doc.type === 'import') {
                deps.push({ module: doc.symbol, type: doc.importType });
            }
        }
        return deps;
    }

    // ── 找到导入某模块的所有文件 ──
    findImporters(moduleName) {
        const importers = [];
        for (const [docId, doc] of this.documents) {
            if (doc.type === 'import' && doc.symbol?.includes(moduleName)) {
                importers.push(doc.file);
            }
        }
        return [...new Set(importers)];
    }

    // ── 清除索引 ──
    clear() {
        this.documents.clear();
        this.invertedIndex.clear();
        this.idfValues.clear();
        this.fileHashes.clear();
        this.docCount = 0;
        this._saveIndex();
    }

    // ── 私有: 文件收集 ──
    _collectFiles() {
        const files = [];
        const walk = (dir, depth = 0) => {
            if (depth > 10 || files.length > 10000) return;
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith('.') && entry.name !== '.env') continue;
                    if (SKIP_DIRS.has(entry.name)) continue;
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        walk(fullPath, depth + 1);
                    } else if (entry.isFile()) {
                        const ext = path.extname(entry.name).toLowerCase();
                        if (INDEX_EXTENSIONS.has(ext) && fs.statSync(fullPath).size < 2 * 1024 * 1024) {
                            files.push(fullPath);
                        }
                    }
                }
            } catch { /* skip */ }
        };
        walk(this.projectRoot);
        return files;
    }

    // ── 私有: 文件解析 ──
    _parseFile(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');
        const relPath = path.relative(this.projectRoot, filePath);
        const language = this._detectLanguage(filePath);
        const docs = [];

        // Doc: File-level metadata
        docs.push({
            type: 'file',
            file: filePath,
            relPath,
            language,
            symbol: `FILE:${relPath}`,
            text: `File: ${relPath}\nLanguage: ${language}`,
            tokens: this._tokenize(`${relPath} ${language}`),
        });

        // Parse symbols and imports
        const parsers = this._getParsers(language);
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('//') || line.startsWith('#')) continue;

            // Imports
            if (parsers.import) {
                const importMatch = line.match(parsers.import);
                if (importMatch) {
                    docs.push({
                        type: 'import',
                        file: filePath,
                        relPath,
                        language,
                        symbol: importMatch[1] || importMatch[0],
                        importType: importMatch[2] || 'default',
                        lineNumber: i + 1,
                        text: `Import: ${importMatch[0]}`,
                        tokens: this._tokenize(`import ${importMatch[1] || importMatch[0]}`),
                    });
                    continue;
                }
            }

            // Function/Class/Interface declarations
            for (const [kind, regex] of Object.entries(parsers.symbols || {})) {
                const m = line.match(regex);
                if (m) {
                    const name = m[1] || m[2];
                    if (name && name.length > 1 && name.length < 100) {
                        // Get doc comment
                        let docComment = '';
                        for (let j = i - 1; j >= 0 && j >= i - 5; j--) {
                            const prevLine = lines[j].trim();
                            if (prevLine.startsWith('//') || prevLine.startsWith('/**') || prevLine.startsWith('*') || prevLine.startsWith('#')) {
                                docComment = prevLine.replace(/^[/#* ]+/, '').trim() + ' ' + docComment;
                            } else {
                                break;
                            }
                        }

                        const text = `${kind}: ${name}\n${docComment}`.trim();
                        docs.push({
                            type: 'symbol',
                            file: filePath,
                            relPath,
                            language,
                            symbol: name,
                            kind,
                            lineNumber: i + 1,
                            text,
                            tokens: this._tokenize(`${name} ${kind} ${docComment}`),
                        });
                    }
                    break;
                }
            }
        }

        return docs;
    }

    // ── 私有: 语言检测 ──
    _detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = {
            '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
            '.ts': 'typescript', '.tsx': 'typescript',
            '.py': 'python', '.pyw': 'python',
            '.go': 'go', '.rs': 'rust', '.java': 'java',
            '.kt': 'kotlin', '.kts': 'kotlin',
            '.swift': 'swift', '.vue': 'vue', '.svelte': 'svelte',
            '.c': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.h': 'c', '.hpp': 'cpp',
        };
        return map[ext] || 'unknown';
    }

    // ── 私有: 解析器 ──
    _getParsers(language) {
        switch (language) {
            case 'javascript':
            case 'typescript':
                return {
                    import: /import\s+(?:\{[^}]*\}|(\w+))\s+from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/,
                    symbols: {
                        function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/,
                        class: /(?:export\s+)?class\s+(\w+)/,
                        constFn: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/,
                        interface: /(?:export\s+)?interface\s+(\w+)/,
                        type: /(?:export\s+)?type\s+(\w+)/,
                        method: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{/,
                    }
                };
            case 'python':
                return {
                    import: /(?:from\s+(\S+)\s+)?import\s+(.+)/,
                    symbols: {
                        function: /def\s+(\w+)/,
                        class: /class\s+(\w+)/,
                        decorator: /@(\w+)/,
                    }
                };
            case 'go':
                return {
                    import: /"([^"]+)"/,
                    symbols: {
                        function: /func\s+(?:\([^)]*\)\s+)?(\w+)/,
                        struct: /type\s+(\w+)\s+struct/,
                        interface: /type\s+(\w+)\s+interface/,
                    }
                };
            case 'java':
            case 'kotlin':
                return {
                    import: /import\s+([\w.]+)/,
                    symbols: {
                        class: /(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/,
                        interface: /(?:public\s+)?interface\s+(\w+)/,
                        function: /(?:public|private|protected|internal)?\s*(?:static\s+)?(?:suspend\s+)?fun\s+(\w+)|(?:public|private|protected)\s+(?:static\s+)?\w+\s+(\w+)\s*\(/,
                    }
                };
            default:
                return { symbols: {} };
        }
    }

    // ── 私有: 索引操作 ──
    _indexDocument(docId, doc) {
        if (!doc.tokens) return;
        const tfMap = new Map();
        for (let i = 0; i < doc.tokens.length; i++) {
            const token = doc.tokens[i];
            if (!tfMap.has(token)) tfMap.set(token, { count: 0, positions: [] });
            const entry = tfMap.get(token);
            entry.count++;
            entry.positions.push(i);
        }

        for (const [token, { count, positions }] of tfMap) {
            if (!this.invertedIndex.has(token)) {
                this.invertedIndex.set(token, []);
            }
            this.invertedIndex.get(token).push({ docId, tf: count, positions });
        }
    }

    _removeFileDocuments(filePath) {
        const toRemove = [];
        for (const [docId, doc] of this.documents) {
            if (doc.file === filePath) toRemove.push(docId);
        }
        for (const docId of toRemove) {
            this.documents.delete(docId);
        }
        // Clean inverted index (expensive, but only on file changes)
        for (const [token, postings] of this.invertedIndex) {
            this.invertedIndex.set(token, postings.filter(p => !toRemove.includes(p.docId)));
        }
    }

    _computeIDF() {
        this.idfValues.clear();
        for (const [token, postings] of this.invertedIndex) {
            this.idfValues.set(token, Math.log(1 + (this.documents.size - postings.length + 0.5) / (postings.length + 0.5)));
        }
    }

    _avgDocLength() {
        let total = 0;
        let count = 0;
        for (const doc of this.documents.values()) {
            if (doc.tokens) { total += doc.tokens.length; count++; }
        }
        return count > 0 ? total / count : 10;
    }

    // ── 私有: 分词 ──
    _tokenize(text) {
        if (!text) return [];
        // camelCase/PascalCase splitting
        let processed = text.toLowerCase()
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/[_\-\.\/]/g, ' ')
            .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        const tokens = processed.split(' ').filter(t => t.length > 1);
        // Add bigrams for partial match
        const bigrams = [];
        for (let i = 0; i < tokens.length - 1; i++) {
            bigrams.push(tokens[i] + '_' + tokens[i + 1]);
        }
        return [...tokens, ...bigrams];
    }

    _hashFile(filePath) {
        try {
            const content = fs.readFileSync(filePath);
            return crypto.createHash('md5').update(content).digest('hex');
        } catch {
            return '00000000';
        }
    }

    _countByType() {
        const counts = {};
        for (const doc of this.documents.values()) {
            counts[doc.type] = (counts[doc.type] || 0) + 1;
        }
        return counts;
    }

    _countByLanguage() {
        const counts = {};
        for (const doc of this.documents.values()) {
            if (doc.language) counts[doc.language] = (counts[doc.language] || 0) + 1;
        }
        return counts;
    }

    // ── 持久化 ──
    _saveIndex() {
        if (!this.indexPath) return;
        try {
            const data = {
                version: 1,
                updatedAt: Date.now(),
                projectRoot: this.projectRoot,
                docCount: this.docCount,
                documents: Array.from(this.documents.entries()),
                invertedIndex: Array.from(this.invertedIndex.entries()),
                fileHashes: Array.from(this.fileHashes.entries()),
            };
            fs.writeFileSync(this.indexPath, JSON.stringify(data, null, 0), 'utf-8');
        } catch (err) {
            console.warn('[VectorIndex] Save failed:', err.message);
        }
    }

    _loadIndex() {
        if (!this.indexPath || !fs.existsSync(this.indexPath)) return;
        try {
            const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
            if (data.version !== 1) return;
            this.documents = new Map(data.documents || []);
            this.invertedIndex = new Map(data.invertedIndex || []);
            this.fileHashes = new Map(data.fileHashes || []);
            this.docCount = data.docCount || this.documents.size;
            this._computeIDF();
        } catch {
            // Corrupt index, start fresh
            this.documents = new Map();
            this.invertedIndex = new Map();
            this.fileHashes = new Map();
        }
    }
}

exports.VectorIndexer = VectorIndexer;
exports.vectorIndexer = new VectorIndexer();
