"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contextTrimmer = exports.ContextTrimmer = void 0;
class ContextTrimmer {
    constructor(config) { }
    init(projectRoot) { }
    startBackgroundTrim() { }
    stopBackgroundTrim() { }
    cacheSystemPrompt(key, content) { }
    getCachedPrompt(key) { return null; }
    trim(messages) { return { trimmed: messages, archived: [], tokensSaved: 0 }; }
    extractSummary(messages) { return { originalReq: '', finalCode: [], architecture: '', keyErrors: [], decisions: [] }; }
    deduplicate(content, existingBlocks) { return content; }
    getArchiveStats() { return { archivedCount: 0, totalTokensSaved: 0, recentArchives: [] }; }
    onTrim;
}
exports.ContextTrimmer = ContextTrimmer;
exports.contextTrimmer = new ContextTrimmer();
