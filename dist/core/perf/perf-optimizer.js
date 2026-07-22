"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perfOptimizer = exports.PerfOptimizer = void 0;
class PerfOptimizer {
    constructor() { this.metrics = { avgOpenTime: 0, avgSwitchTime: 0, openCount: 0, switchCount: 0, lastFrameDrop: null, memoryWarnings: 0 }; }
    debounce(key, fn, delayMs) { }
    cancelDebounce(key) { }
    scheduleRender(renderFn, priority) { }
    startTimer(label) { return () => 0; }
    getMetrics() { return { ...this.metrics }; }
    resetMetrics() { }
    gcSweep(editor, fileCache) { }
    optimizeScroll(editor) { }
    setupInputDebounce(editor) { }
    batchUpdate(updateFn) { }
    metrics;
}
exports.PerfOptimizer = PerfOptimizer;
exports.perfOptimizer = new PerfOptimizer();
