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
exports.SemanticChunker = exports.semanticChunker = void 0;
/**
 * TCIDE Semantic Chunker — P0 大文件自动语义分片加载
 *
 * 核心能力:
 *   - 按代码语义（函数/类/模块/接口）分片，而非单纯按行数切割
 *   - 可视区域优先加载，滚动时预加载相邻分片
 *   - 分片对用户无感（无阻塞弹窗，仅轻量占位提示）
 *   - 文件体积阈值检测（可配置），低于阈值的文件不分片
 *
 * 语义边界识别:
 *   - JavaScript/TypeScript: function/class/interface/enum/export/import 块
 *   - Python: def/class 缩进块
 *   - Go: func/type/const/var 块
 *   - 通用: 空行分隔的逻辑段落
 */
const fs = require("fs");
const path = require("path");

/** 默认配置 */
const DEFAULT_OPTIONS = {
    /** 触发分片的行数阈值 */
    lineThreshold: 500,
    /** 每个分片的目标行数 */
    chunkTargetLines: 200,
    /** 分片重叠行数（避免边界割裂） */
    overlapLines: 3,
    /** 预加载前瞻分片数 */
    preloadAhead: 2,
    /** 预加载后顾分片数 */
    preloadBehind: 1,
    /** 预览行数（分片未加载时的占位预览） */
    previewLines: 20,
};

/**
 * @typedef {Object} Chunk
 * @property {number} index - 分片序号
 * @property {number} startLine - 起始行 (1-indexed)
 * @property {number} endLine - 结束行 (1-indexed)
 * @property {number} byteOffset - 字节偏移
 * @property {number} byteLength - 字节长度
 * @property {'function'|'class'|'module'|'import'|'block'|'generic'} semanticType
 * @property {string} [semanticName] - 语义标识（函数名/类名等）
 * @property {string} preview - 前 N 行预览文本
 * @property {'virtual'|'loaded'|'error'} status
 */

class SemanticChunker {
    constructor(config = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...config };
        /** @type {Map<string, {chunks: Chunk[], totalLines: number, language: string, version: number}>} */
        this._cache = new Map();
        /** @type {Map<string, string>} 已加载的全文内容缓存 */
        this._contentCache = new Map();
    }

    // ── 判断是否需要分片 ──
    /**
     * 快速判断文件是否需要分片（基于文件大小估算行数）
     */
    needsChunking(filePath) {
        try {
            const stat = fs.statSync(filePath);
            // 粗略估算：平均每行 40 字节
            const estimatedLines = Math.ceil(stat.size / 40);
            return estimatedLines > this.options.lineThreshold;
        } catch {
            return false;
        }
    }

    // ── 分片核心逻辑 ──
    /**
     * 对文件执行语义分片
     * @returns {{chunks: Chunk[], totalLines: number, language: string}}
     */
    chunkFile(filePath) {
        try {
            const cached = this._cache.get(filePath);
            const stat = fs.statSync(filePath);
            const version = stat.mtimeMs;

            // 缓存命中（文件未修改）
            if (cached && cached.version === version) {
                return { chunks: cached.chunks, totalLines: cached.totalLines, language: cached.language };
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            this._contentCache.set(filePath, content);

            const lines = content.split('\n');
            const totalLines = lines.length;
            const language = this._detectLanguage(filePath);

            // 不需要分片
            if (totalLines <= this.options.lineThreshold) {
                const chunk = {
                    index: 0,
                    startLine: 1,
                    endLine: totalLines,
                    byteOffset: 0,
                    byteLength: Buffer.byteLength(content, 'utf-8'),
                    semanticType: 'generic',
                    preview: lines.slice(0, this.options.previewLines).join('\n'),
                    status: 'loaded',
                };
                const result = { chunks: [chunk], totalLines, language };
                this._cache.set(filePath, { ...result, version });
                return result;
            }

            // 执行语义分片
            const boundaries = this._findSemanticBoundaries(lines, language);
            const chunks = this._buildChunks(lines, boundaries, content);

            const result = { chunks, totalLines, language };
            this._cache.set(filePath, { ...result, version });
            return result;
        } catch (e) {
            // 异常降级：文件不可读/编码错误/语法异常时，用简单行数分片兜底
            console.warn(`[Chunker] 语义分片异常，降级为行分片: ${filePath}`, e.message);
            try {
                const content = this._contentCache.get(filePath) || '';
                const lines = content ? content.split('\n') : [];
                const totalLines = lines.length;
                if (!totalLines) return { chunks: [], totalLines: 0, language: this._detectLanguage(filePath) };
                const chunkSize = this.options.chunkTargetLines;
                const chunks = [];
                for (let i = 0; i < totalLines; i += chunkSize) {
                    const end = Math.min(i + chunkSize, totalLines);
                    chunks.push({
                        index: chunks.length,
                        startLine: i + 1,
                        endLine: end,
                        byteOffset: content.split('\n').slice(0, i).join('\n').length,
                        byteLength: lines.slice(i, end).join('\n').length,
                        semanticType: 'generic',
                        preview: lines.slice(i, Math.min(i + this.options.previewLines, end)).join('\n'),
                        status: 'virtual',
                    });
                }
                const result = { chunks, totalLines, language: this._detectLanguage(filePath) };
                return result;
            } catch (fallbackErr) {
                console.error(`[Chunker] 降级分片也失败: ${filePath}`, fallbackErr.message);
                return { chunks: [], totalLines: 0, language: this._detectLanguage(filePath) };
            }
        }
    }

    // ── 查询 ──
    /**
     * 根据行号定位所在分片
     */
    getChunkIndex(filePath, lineNumber) {
        const entry = this._cache.get(filePath);
        if (!entry) return -1;
        for (const chunk of entry.chunks) {
            if (lineNumber >= chunk.startLine && lineNumber <= chunk.endLine) {
                return chunk.index;
            }
        }
        return -1;
    }

    /**
     * 获取视口范围内的分片（当前可见区域 + 预加载）
     */
    getViewportChunks(filePath, startLine, endLine) {
        const entry = this._cache.get(filePath);
        if (!entry) return [];

        const result = [];
        for (const chunk of entry.chunks) {
            // 视口重叠检测
            if (chunk.startLine <= endLine + this.options.preloadAhead * this.options.chunkTargetLines &&
                chunk.endLine >= startLine - this.options.preloadBehind * this.options.chunkTargetLines) {
                result.push(chunk);
            }
        }
        return result;
    }

    /**
     * 获取文件预览（分片模式下的摘要视图）
     */
    getPreview(filePath) {
        const entry = this._cache.get(filePath);
        if (!entry) {
            // 未分片，返回前 N 行
            try {
                const content = this._contentCache.get(filePath) || fs.readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                return {
                    lines: lines.slice(0, this.options.previewLines),
                    totalLines: lines.length,
                    hasMore: lines.length > this.options.previewLines,
                    language: this._detectLanguage(filePath),
                };
            } catch {
                return { lines: [], totalLines: 0, hasMore: false, language: '' };
            }
        }

        const firstChunk = entry.chunks[0];
        return {
            lines: (firstChunk?.preview || '').split('\n'),
            totalLines: entry.totalLines,
            hasMore: entry.totalLines > this.options.previewLines,
            language: entry.language,
        };
    }

    /**
     * 获取分片占位提示文本
     */
    getPlaceholderText(chunk) {
        const typeLabels = {
            function: '函数',
            class: '类',
            module: '模块',
            import: '导入',
            block: '代码块',
            generic: '代码',
        };
        const label = typeLabels[chunk.semanticType] || '代码';
        const name = chunk.semanticName ? ` ${chunk.semanticName}` : '';
        return `// --- ${label}${name} (行 ${chunk.startLine}-${chunk.endLine}) [点击加载] ---`;
    }

    // ── 缓存管理 ──
    invalidate(filePath) {
        this._cache.delete(filePath);
        this._contentCache.delete(filePath);
    }

    clearAll() {
        this._cache.clear();
        this._contentCache.clear();
    }

    // ── 语义边界识别 ──
    /**
     * 根据语言类型识别语义边界
     */
    _findSemanticBoundaries(lines, language) {
        /**
         * @type {Array<{line: number, type: string, name: string}>}
         */
        const boundaries = [{ line: 1, type: 'start', name: '' }];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();

            // 跳过空行和纯注释
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('--')) {
                continue;
            }

            const lineNum = i + 1;
            let match = null;

            switch (language) {
                case 'javascript':
                case 'typescript':
                case 'tsx':
                case 'jsx':
                case 'vue':
                    // function / async function / arrow function assigned to const
                    match = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
                    if (match) { boundaries.push({ line: lineNum, type: 'function', name: match[1] }); break; }

                    // class
                    match = trimmed.match(/^(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/);
                    if (match) { boundaries.push({ line: lineNum, type: 'class', name: match[1] }); break; }

                    // interface / type
                    match = trimmed.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/);
                    if (match && !trimmed.includes('=')) { boundaries.push({ line: lineNum, type: 'class', name: match[1] }); break; }

                    // const/let/var 块级赋值（可能是大对象/函数）
                    match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:function|async\s*\(|\(|{)/);
                    if (match) { boundaries.push({ line: lineNum, type: 'function', name: match[1] }); break; }

                    // import 块（多行 import 合并为一个边界）
                    match = trimmed.match(/^import\s+/);
                    if (match) {
                        const lastImport = boundaries.filter(b => b.type === 'import').pop();
                        if (!lastImport || lineNum - lastImport.line > 5) {
                            boundaries.push({ line: lineNum, type: 'import', name: '' });
                        }
                        break;
                    }
                    break;

                case 'python':
                    // def (不缩进)
                    if (/^def\s+(\w+)/.test(trimmed)) {
                        const pyMatch = trimmed.match(/^def\s+(\w+)/);
                        boundaries.push({ line: lineNum, type: 'function', name: pyMatch[1] });
                    }
                    // class (不缩进)
                    else if (/^class\s+(\w+)/.test(trimmed)) {
                        const pyMatch = trimmed.match(/^class\s+(\w+)/);
                        boundaries.push({ line: lineNum, type: 'class', name: pyMatch[1] });
                    }
                    // import/from 块
                    else if (/^(?:import|from)\s+/.test(trimmed)) {
                        const lastImport = boundaries.filter(b => b.type === 'import').pop();
                        if (!lastImport || lineNum - lastImport.line > 5) {
                            boundaries.push({ line: lineNum, type: 'import', name: '' });
                        }
                    }
                    break;

                case 'go':
                    // func
                    match = trimmed.match(/^func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)/);
                    if (match) { boundaries.push({ line: lineNum, type: 'function', name: match[1] }); break; }
                    // type
                    match = trimmed.match(/^type\s+(\w+)/);
                    if (match) { boundaries.push({ line: lineNum, type: 'class', name: match[1] }); break; }
                    // const/var 块
                    if (/^(?:const|var)\s*\(/.test(trimmed)) {
                        boundaries.push({ line: lineNum, type: 'block', name: trimmed.split(/\s+/)[0] });
                    }
                    break;

                default:
                    // 通用：空行分隔（大逻辑段落）
                    if (language !== 'all' && i > 0 && !lines[i - 1].trim() && !trimmed.startsWith('//')) {
                        // 仅在行数差距足够大时才添加边界
                        const lastBoundary = boundaries[boundaries.length - 1];
                        const gap = lineNum - lastBoundary.line;
                        if (gap >= this.options.chunkTargetLines * 0.5) {
                            boundaries.push({ line: lineNum, type: 'block', name: '' });
                        }
                    }
                    break;
            }
        }

        // 结束边界
        boundaries.push({ line: lines.length + 1, type: 'end', name: '' });

        return boundaries;
    }

    /**
     * 根据边界构建分片
     */
    _buildChunks(lines, boundaries, fullContent) {
        const chunks = [];
        const target = this.options.chunkTargetLines;
        const overlap = this.options.overlapLines;

        // 按 target 行数分组边界
        let chunkStart = 1;
        let chunkIndex = 0;
        let accumulatedLines = 0;

        for (let i = 0; i < boundaries.length - 1; i++) {
            const curr = boundaries[i];
            const next = boundaries[i + 1];
            const segmentLines = next.line - curr.line;

            // 跳过初始 start 边界
            if (curr.type === 'start') {
                chunkStart = curr.line;
                continue;
            }

            accumulatedLines += segmentLines;

            if (accumulatedLines >= target || next.type === 'end') {
                const endLine = next.line - 1;
                const startByte = this._lineToByte(fullContent, chunkStart);
                const endByte = this._lineToByte(fullContent, Math.min(endLine + 1, lines.length + 1));
                const contentSlice = lines.slice(chunkStart - 1, endLine);

                chunks.push({
                    index: chunkIndex++,
                    startLine: chunkStart,
                    endLine,
                    byteOffset: startByte,
                    byteLength: endByte - startByte,
                    semanticType: curr.type || 'generic',
                    semanticName: curr.name || '',
                    preview: contentSlice.slice(0, this.options.previewLines).join('\n'),
                    status: 'virtual',
                });

                // 下一个 chunk 从当前语义块的下一行开始（减去重叠）
                chunkStart = Math.max(next.line - overlap, chunkStart);
                accumulatedLines = 0;
            }
        }

        // 确保最后一个分片覆盖到文件末尾
        if (chunks.length > 0) {
            chunks[chunks.length - 1].endLine = lines.length;
        }

        return chunks;
    }

    // ── 工具方法 ──
    _detectLanguage(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        const map = {
            '.js': 'javascript', '.jsx': 'jsx', '.mjs': 'javascript', '.cjs': 'javascript',
            '.ts': 'typescript', '.tsx': 'tsx',
            '.vue': 'vue', '.svelte': 'svelte',
            '.py': 'python', '.pyw': 'python',
            '.go': 'go',
            '.rs': 'rust',
            '.java': 'java',
            '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.c': 'cpp', '.h': 'cpp', '.hpp': 'cpp',
            '.cs': 'csharp',
            '.rb': 'ruby',
            '.php': 'php',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.sql': 'sql',
            '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
            '.json': 'json', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
            '.md': 'markdown', '.mdx': 'markdown',
            '.css': 'css', '.scss': 'scss', '.less': 'less',
            '.html': 'html', '.htm': 'html',
        };
        return map[ext] || '';
    }

    _lineToByte(content, lineNumber) {
        let bytes = 0;
        let currentLine = 1;
        for (let i = 0; i < content.length; i++) {
            if (currentLine >= lineNumber) break;
            if (content[i] === '\n') currentLine++;
            // UTF-8 多字节字符
            const code = content.charCodeAt(i);
            if (code >= 0xD800 && code <= 0xDBFF) { i++; bytes++; } // surrogate pair
            bytes++;
        }
        return bytes;
    }
}
exports.SemanticChunker = SemanticChunker;

exports.semanticChunker = new SemanticChunker();
