export class SemanticChunker {
  constructor(config?: any) { }
  needsChunking(filePath: string): boolean { return false; }
  chunkFile(filePath: string): any { return { chunks: [], totalLines: 0, language: '' }; }
  getChunkIndex(filePath: string, lineNumber: number): number { return -1; }
  getViewportChunks(filePath: string, startLine: number, endLine: number): any[] { return []; }
  getPreview(filePath: string): any { return { lines: [], totalLines: 0, hasMore: false, language: '' }; }
  getPlaceholderText(chunk: any): string { return ''; }
  invalidate(filePath: string): void { }
  clearAll(): void { }
}
export const semanticChunker = new SemanticChunker();