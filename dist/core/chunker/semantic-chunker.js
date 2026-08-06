"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.semanticChunker = exports.SemanticChunker = void 0;
class SemanticChunker {
    boundaryPatterns = {
        typescript: /^(export\s+)?(async\s+)?(function|class|interface|enum|const\s+\w+\s*=\s*(async\s+)?\(|export\s+type)/m,
        javascript: /^(export\s+)?(async\s+)?(function|class|const\s+\w+\s*=\s*(async\s+)?\(|module\.exports)/m,
        python: /^(def\s+|class\s+|async\s+def\s+|@\w+)/m,
        go: /^(func\s+|type\s+\w+\s+struct|type\s+\w+\s+interface)/m,
        rust: /^(pub\s+)?(fn\s+|struct\s+|impl\s+|trait\s+|enum\s+|mod\s+)/m,
        java: /^\s*(public|private|protected|static|final|abstract|class|interface|enum)\s/m,
        kotlin: /^\s*(fun\s+|class\s+|object\s+|interface\s+|enum\s+class|data\s+class|sealed\s+)/m,
        cpp: /^(class\s+|struct\s+|enum\s+|template\s*<|\w+\s+\w+::\w+\s*\(|[\w&*]+\s+\w+\s*\()/m,
    };
    /** Split file into semantic chunks */
    chunkFile(content, language, maxLines = 200) {
        const lines = content.split('\n');
        const pattern = this.boundaryPatterns[language] || null;
        const chunks = [];
        let currentStart = 1;
        let currentLines = [];
        let lastBoundary = 'line';
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const isBoundary = pattern ? pattern.test(line) : false;
            const lineNum = i + 1;
            // Check if we should split here
            const shouldSplit = (isBoundary && currentLines.length > maxLines * 0.5) ||
                (!isBoundary && currentLines.length >= maxLines);
            if (shouldSplit && currentLines.length > 0) {
                chunks.push({
                    index: chunks.length,
                    startLine: currentStart,
                    endLine: lineNum - 1,
                    content: currentLines.join('\n'),
                    boundary: lastBoundary,
                });
                currentStart = lineNum;
                currentLines = [];
                lastBoundary = isBoundary ? this.detectBoundary(line, language) : 'line';
            }
            if (isBoundary && currentLines.length === 0) {
                lastBoundary = this.detectBoundary(line, language);
            }
            currentLines.push(line);
        }
        // Final chunk
        if (currentLines.length > 0) {
            chunks.push({
                index: chunks.length,
                startLine: currentStart,
                endLine: lines.length,
                content: currentLines.join('\n'),
                boundary: lastBoundary,
            });
        }
        if (chunks.length === 0) {
            chunks.push({ index: 0, startLine: 1, endLine: lines.length, content, boundary: 'line' });
        }
        return chunks;
    }
    detectBoundary(line, language) {
        if (/class|interface|enum|struct|trait/.test(line))
            return 'class';
        if (/function|func|def|fun\s/.test(line))
            return 'function';
        if (/^{/.test(line.trim()))
            return 'block';
        return 'line';
    }
    /** Get a summary of chunk boundaries for display */
    getChunkSummary(chunks) {
        return chunks.map(c => `Chunk ${c.index + 1}: lines ${c.startLine}-${c.endLine} (${c.boundary})`).join('\n');
    }
}
exports.SemanticChunker = SemanticChunker;
exports.semanticChunker = new SemanticChunker();
