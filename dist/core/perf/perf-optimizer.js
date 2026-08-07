"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.perfOptimizer = exports.PerfOptimizer = void 0;
class PerfOptimizer {
    metrics = [];
    timer = null;
    MAX_SAMPLES = 120; // 1 hour at 30s intervals
    OOM_THRESHOLD_RATIO = 0.85;
    start(intervalMs = 30000) {
        if (this.timer)
            return;
        this.timer = setInterval(() => this.collect(), intervalMs);
        this.collect(); // immediate first sample
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    collect() {
        const mem = process.memoryUsage?.() || { heapUsed: 0, heapTotal: 0 };
        const m = {
            timestamp: Date.now(),
            heapUsed: mem.heapUsed || 0,
            heapTotal: mem.heapTotal || 0,
            heapLimit: mem.heapTotal ? mem.heapTotal * 1.5 : 512 * 1024 * 1024,
            uptime: process.uptime?.() || 0,
            openFiles: 0,
            sessionCount: 0,
        };
        this.metrics.push(m);
        if (this.metrics.length > this.MAX_SAMPLES)
            this.metrics.shift();
    }
    /** Analyze recent memory trend */
    getTrend() {
        if (this.metrics.length < 3)
            return null;
        const recent = this.metrics.slice(-10);
        const current = recent[recent.length - 1];
        const oldest = recent[0];
        const timeSpanMin = (current.timestamp - oldest.timestamp) / 60000;
        const memDiff = current.heapUsed - oldest.heapUsed;
        const rateMBPerMin = timeSpanMin > 0 ? (memDiff / timeSpanMin / 1024 / 1024) : 0;
        let trend = 'stable';
        if (rateMBPerMin > 2)
            trend = 'increasing';
        else if (rateMBPerMin < -2)
            trend = 'decreasing';
        // Project OOM
        let projectedOOMin = null;
        if (trend === 'increasing' && current.heapLimit > 0) {
            const remaining = current.heapLimit - current.heapUsed;
            projectedOOMin = remaining / (rateMBPerMin * 1024 * 1024);
            projectedOOMin = Math.round(projectedOOMin);
        }
        let recommendation = 'Memory usage is stable.';
        if (trend === 'increasing' && projectedOOMin !== null) {
            if (projectedOOMin < 60) {
                recommendation = `Memory leak detected! ~${projectedOOMin} minutes until OOM. Close unused files/tabs and consider restarting.`;
            }
            else {
                recommendation = `Memory growing at ${rateMBPerMin.toFixed(1)} MB/min. Monitor usage, especially with large projects.`;
            }
        }
        else if (trend === 'decreasing') {
            recommendation = 'Memory usage decreasing — GC is working effectively.';
        }
        return { current, trend, rateMBPerMin, projectedOOMin, recommendation };
    }
    /** Get the latest metrics snapshot */
    getLatest() {
        return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
    }
    /** Get memory usage as a percentage of limit */
    getUsagePercent() {
        const latest = this.getLatest();
        if (!latest || latest.heapLimit === 0)
            return 0;
        return Math.round((latest.heapUsed / latest.heapLimit) * 100);
    }
    /** Check if memory is critically high */
    isCritical() {
        return this.getUsagePercent() > 80;
    }
    /** Suggest GC if available */
    suggestGC() {
        if (global.gc && this.isCritical()) {
            global.gc();
            return true;
        }
        return false;
    }
}
exports.PerfOptimizer = PerfOptimizer;
exports.perfOptimizer = new PerfOptimizer();
