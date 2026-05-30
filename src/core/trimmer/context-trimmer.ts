export class ContextTrimmer {
  constructor(config?: any) { }
  init(projectRoot: string): void { }
  startBackgroundTrim(): void { }
  stopBackgroundTrim(): void { }
  cacheSystemPrompt(key: string, content: string): void { }
  getCachedPrompt(key: string): any { return null; }
  trim(messages: any[]): any { return { trimmed: messages, archived: [], tokensSaved: 0 }; }
  extractSummary(messages: any[]): any { return { originalReq: '', finalCode: [], architecture: '', keyErrors: [], decisions: [] }; }
  deduplicate(content: string, existingBlocks: Set<string>): string { return content; }
  getArchiveStats(): any { return { archivedCount: 0, totalTokensSaved: 0, recentArchives: [] }; }
  onTrim: any;
}
export const contextTrimmer = new ContextTrimmer();