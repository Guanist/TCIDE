"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.lintManager = exports.LintManager = void 0;
class LintManager {
    constructor() { this.onDiagnostics = null; this.onStatusChange = null; this.status = { totalErrors: 0, totalWarnings: 0, linting: false, formatting: false }; this.diagnosticsByFile = new Map(); this.installedCache = new Map(); }
    isInstalled(projectRoot, tool) { return false; }
    getInstallGuide(tool) { return ''; }
    async lintFile(filePath, projectRoot) { return { diagnostics: [], errors: 0, warnings: 0 }; }
    async formatFile(filePath, projectRoot) { return { success: false, formatted: null, error: '' }; }
    async lintProject(projectRoot, onProgress) { return new Map(); }
    async fixAll(projectRoot, filePaths) { return []; }
    getFileSummary(filePath) { return { errors: 0, warnings: 0, total: 0 }; }
    getProjectSummary() { return { totalErrors: 0, totalWarnings: 0 }; }
    clearFile(filePath) { }
    clearAll() { }
    onDiagnostics;
    onStatusChange;
    status;
    diagnosticsByFile;
    installedCache;
}
exports.LintManager = LintManager;
exports.lintManager = new LintManager();
