/**
 * PerfOptimizer - memory and performance metrics collector.
 * Monitors heap usage, GC events, and provides optimization recommendations.
 */
export interface PerfMetrics {
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  heapLimit: number;
  uptime: number;
  openFiles: number;
  sessionCount: number;
}

export interface PerfTrend {
  current: PerfMetrics;
  trend: 'stable' | 'increasing' | 'decreasing';
  rateMBPerMin: number;
  projectedOOMin: number | null; // minutes until OOM, null if stable
  recommendation: string;
}

export class PerfOptimizer {
  private metrics: PerfMetrics[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly MAX_SAMPLES = 120; // 1 hour at 30s intervals
  private readonly OOM_THRESHOLD_RATIO = 0.85;

  start(intervalMs: number = 30000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.collect(), intervalMs);
    this.collect(); // immediate first sample
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private collect(): void {
    const mem = (process as any).memoryUsage?.() || { heapUsed: 0, heapTotal: 0 };
    const m: PerfMetrics = {
      timestamp: Date.now(),
      heapUsed: mem.heapUsed || 0,
      heapTotal: mem.heapTotal || 0,
      heapLimit: mem.heapTotal ? mem.heapTotal * 1.5 : 512 * 1024 * 1024,
      uptime: process.uptime?.() || 0,
      openFiles: 0,
      sessionCount: 0,
    };
    this.metrics.push(m);
    if (this.metrics.length > this.MAX_SAMPLES) this.metrics.shift();
  }

  /** Analyze recent memory trend */
  getTrend(): PerfTrend | null {
    if (this.metrics.length < 3) return null;

    const recent = this.metrics.slice(-10);
    const current = recent[recent.length - 1];
    const oldest = recent[0];

    const timeSpanMin = (current.timestamp - oldest.timestamp) / 60000;
    const memDiff = current.heapUsed - oldest.heapUsed;
    const rateMBPerMin = timeSpanMin > 0 ? (memDiff / timeSpanMin / 1024 / 1024) : 0;

    let trend: PerfTrend['trend'] = 'stable';
    if (rateMBPerMin > 2) trend = 'increasing';
    else if (rateMBPerMin < -2) trend = 'decreasing';

    // Project OOM
    let projectedOOMin: number | null = null;
    if (trend === 'increasing' && current.heapLimit > 0) {
      const remaining = current.heapLimit - current.heapUsed;
      projectedOOMin = remaining / (rateMBPerMin * 1024 * 1024);
      projectedOOMin = Math.round(projectedOOMin);
    }

    let recommendation = 'Memory usage is stable.';
    if (trend === 'increasing' && projectedOOMin !== null) {
      if (projectedOOMin < 60) {
        recommendation = `Memory leak detected! ~${projectedOOMin} minutes until OOM. Close unused files/tabs and consider restarting.`;
      } else {
        recommendation = `Memory growing at ${rateMBPerMin.toFixed(1)} MB/min. Monitor usage, especially with large projects.`;
      }
    } else if (trend === 'decreasing') {
      recommendation = 'Memory usage decreasing — GC is working effectively.';
    }

    return { current, trend, rateMBPerMin, projectedOOMin, recommendation };
  }

  /** Get the latest metrics snapshot */
  getLatest(): PerfMetrics | null {
    return this.metrics.length > 0 ? this.metrics[this.metrics.length - 1] : null;
  }

  /** Get memory usage as a percentage of limit */
  getUsagePercent(): number {
    const latest = this.getLatest();
    if (!latest || latest.heapLimit === 0) return 0;
    return Math.round((latest.heapUsed / latest.heapLimit) * 100);
  }

  /** Check if memory is critically high */
  isCritical(): boolean {
    return this.getUsagePercent() > 80;
  }

  /** Suggest GC if available */
  suggestGC(): boolean {
    if (global.gc && this.isCritical()) {
      global.gc();
      return true;
    }
    return false;
  }
}

export const perfOptimizer = new PerfOptimizer();
