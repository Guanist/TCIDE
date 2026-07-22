"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.autoHealManager = exports.AutoHealManager = void 0;
class AutoHealManager {
    constructor() { this.retryCounts = new Map(); this.onProgress = null; this.onComplete = null; this.isRunning = false; this.abortController = null; }
    parseErrors(output, projectRoot) { return []; }
    async autoHeal(errors, projectRoot, aiFixFn, buildCmd) { return { fixed: 0, failed: 0, results: [] }; }
    abort() { }
    retryCounts;
    onProgress;
    onComplete;
    isRunning;
    abortController;
}
exports.AutoHealManager = AutoHealManager;
exports.autoHealManager = new AutoHealManager();
