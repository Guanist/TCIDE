"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batchModifier = exports.BatchModifier = void 0;
class BatchModifier {
    constructor() { }
    collectFiles(projectRoot, filter) { return []; }
    search(projectRoot, pattern, options) { return { matches: [], count: 0 }; }
    preview(projectRoot, search, replace, options) { return { changes: [], totalChanges: 0, totalMatches: 0 }; }
    apply(projectRoot, search, replace, options) { return { results: [], backupId: '', stats: { modified: 0, failed: 0 } }; }
    async refactor(projectRoot, oldName, newName, language, options) { return { results: [], backupId: '', stats: { modified: 0, failed: 0 } }; }
    rollback(backupId) { return []; }
    listBackups() { return []; }
    clearBackup(backupId) { return false; }
    clearAllBackups() { }
}
exports.BatchModifier = BatchModifier;
exports.batchModifier = new BatchModifier();
