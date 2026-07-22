"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticChunker = exports.SemanticChunker = void 0;
class SemanticChunker {
    constructor(config) { }
    needsChunking(filePath) { return false; }
    chunkFile(filePath) { return { chunks: [], totalLines: 0, language: '' }; }
    getChunkIndex(filePath, lineNumber) { return -1; }
    getViewportChunks(filePath, startLine, endLine) { return []; }
    getPreview(filePath) { return { lines: [], totalLines: 0, hasMore: false, language: '' }; }
    getPlaceholderText(chunk) { return ''; }
    invalidate(filePath) { }
    clearAll() { }
}
exports.SemanticChunker = SemanticChunker;
exports.semanticChunker = new SemanticChunker();
