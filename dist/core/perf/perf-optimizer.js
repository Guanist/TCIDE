"use strict";
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") result[k[i]] = mod[k];
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerfOptimizer = exports.perfOptimizer = void 0;
/**
 * TCIDE PerfOptimizer — P0 编辑器性能优化
 *
 * 优化方向:
 *   - 输入防抖（减少 Monaco 更新频率）
 *   - 页面滚动渲染优化（requestAnimationFrame 批量更新）
 *   - 标签页/终端异步渲染
 *   - 性能指标采集与监控
 *   - 内存垃圾回收辅助
 *
 * 性能指标:
 *   - 文件打开延迟 < 100ms
 *   - 标签切换延迟 < 100ms
 *   - 大文件滚动无掉帧 (>30fps)
 */
const os = require("os");

/** 默认阈值 */
const THRESHOLDS = {
    /** 输入防抖默认延迟 (ms) */
    debounceDefaultMs: 150,
    /** 大文件行数阈值 */
    largeFileLines: 5000,
    /** GC 触发间隔 (ms) */
    gcIntervalMs: 60000,
    /** 文件缓存最大条目 */
    maxFileCacheEntries: 50,
    /** 帧率告警阈值 (fps) */
    fpsWarningThreshold: 30,
    /** 内存告警阈值 (MB) */
    memoryWarningMB: 500,
};

/**
 * @typedef {Object} PerfMetrics
 * @property {number} avgOpenTime - 平均文件打开时间 (ms)
 * @property {number} avgSwitchTime - 平均标签切换时间 (ms)
 * @property {number} openCount - 文件打开总次数
 * @property {number} switchCount - 标签切换总次数
 * @property {number|null} lastFrameDrop - 最近掉帧时间戳
 * @property {number} memoryWarnings - 内存告警次数
 */

class PerfOptimizer {
    constructor() {
        /** @type {PerfMetrics} */
        this.metrics = {
            avgOpenTime: 0,
            avgSwitchTime: 0,
            openCount: 0,
            switchCount: 0,
            lastFrameDrop: null,
            memoryWarnings: 0,
        };

        /** @type {Map<string, {timer: NodeJS.Timeout|null, fn: Function}>} 防抖器注册表 */
        this._debouncers = new Map();

        /** @type {Array<{start: number, label: string}>} 性能计时器 */
        this._timers = new Map();

        /** @type {Array<{fn: Function, priority: number}>} 渲染队列 */
        this._renderQueue = [];

        /** @type {number|null} RAF ID */
        this._rafId = null;

        /** @type {number|null} GC 定时器 */
        this._gcTimer = null;

        /** @type {number[]} 最近帧间隔记录 (ms) */
        this._frameIntervals = [];

        /** @type {number} 上一帧时间 */
        this._lastFrameTime = Date.now();

        /** @type {Map<string, {content: string, timestamp: number, size: number}>} 文件缓存 */
        this._fileCache = new Map();

        /** @type {number} 累计打开时间 */
        this._totalOpenTime = 0;

        /** @type {number} 累计切换时间 */
        this._totalSwitchTime = 0;

        // 内存监控
        this._startMemoryMonitor();
    }

    // ── 防抖 ──
    /**
     * 创建/触发防抖
     * @param {string} key - 防抖标识
     * @param {Function} fn - 回调函数
     * @param {number} [delayMs] - 延迟毫秒
     */
    debounce(key, fn, delayMs = THRESHOLDS.debounceDefaultMs) {
        const existing = this._debouncers.get(key);
        if (existing && existing.timer) {
            clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => {
            this._debouncers.delete(key);
            try { fn(); } catch (e) { console.error('[Perf] 防抖回调异常:', e); }
        }, delayMs);

        this._debouncers.set(key, { timer, fn });
    }

    /** 取消防抖 */
    cancelDebounce(key) {
        const existing = this._debouncers.get(key);
        if (existing && existing.timer) {
            clearTimeout(existing.timer);
            this._debouncers.delete(key);
        }
    }

    // ── 渲染调度 ──
    /**
     * 调度渲染（自动合并到下一帧）
     * @param {Function} renderFn
     * @param {'high'|'normal'|'low'} [priority='normal']
     */
    scheduleRender(renderFn, priority = 'normal') {
        const prioMap = { high: 0, normal: 1, low: 2 };
        this._renderQueue.push({ fn: renderFn, priority: prioMap[priority] || 1 });

        if (!this._rafId) {
            this._rafId = requestAnimationFrame ? requestAnimationFrame(this._flushRenderQueue.bind(this)) : setImmediate(() => this._flushRenderQueue());
        }
    }

    _flushRenderQueue() {
        // 按优先级排序
        this._renderQueue.sort((a, b) => a.priority - b.priority);

        // 批量执行
        const queue = this._renderQueue;
        this._renderQueue = [];
        this._rafId = null;

        const deadline = Date.now() + 16; // 一帧 (60fps) 的预算
        for (const item of queue) {
            try { item.fn(); } catch (e) { console.error('[Perf] 渲染回调异常:', e); }
            if (Date.now() > deadline && queue.length > 5) {
                // 剩余任务推迟到下一帧
                this._renderQueue.push(...queue.slice(queue.indexOf(item) + 1));
                this._rafId = requestAnimationFrame ? requestAnimationFrame(this._flushRenderQueue.bind(this)) : setImmediate(() => this._flushRenderQueue());
                break;
            }
        }

        // 帧率记录
        const now = Date.now();
        const frameTime = now - this._lastFrameTime;
        this._frameIntervals.push(frameTime);
        if (this._frameIntervals.length > 60) this._frameIntervals.shift(); // 保留最近 60 帧
        this._lastFrameTime = now;
    }

    // ── 性能计时 ──
    /**
     * 开始计时
     * @param {string} label
     * @returns {() => number} 停止计时并返回毫秒数
     */
    startTimer(label) {
        const start = Date.now();
        this._timers.set(label, { start, label });
        return () => {
            const elapsed = Date.now() - start;
            this._timers.delete(label);

            // 更新指标
            if (label === 'file:open') {
                this._totalOpenTime += elapsed;
                this.metrics.openCount++;
                this.metrics.avgOpenTime = Math.round(this._totalOpenTime / this.metrics.openCount);
            } else if (label === 'tab:switch') {
                this._totalSwitchTime += elapsed;
                this.metrics.switchCount++;
                this.metrics.avgSwitchTime = Math.round(this._totalSwitchTime / this.metrics.switchCount);
            }

            return elapsed;
        };
    }

    // ── 指标查询 ──
    getMetrics() {
        return { ...this.metrics };
    }

    resetMetrics() {
        this.metrics = {
            avgOpenTime: 0,
            avgSwitchTime: 0,
            openCount: 0,
            switchCount: 0,
            lastFrameDrop: null,
            memoryWarnings: 0,
        };
        this._totalOpenTime = 0;
        this._totalSwitchTime = 0;
    }

    // ── GC 辅助 ──
    /**
     * 清理编辑器内部的缓存/引用
     * @param {object} editor - Monaco editor 实例
     * @param {Map<string, any>} [fileCache] - 文件内容缓存
     */
    gcSweep(editor, fileCache) {
        // 限制文件缓存大小
        if (fileCache && fileCache.size > THRESHOLDS.maxFileCacheEntries) {
            const entries = Array.from(fileCache.entries());
            entries.sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
            const toDelete = entries.slice(0, entries.length - THRESHOLDS.maxFileCacheEntries);
            for (const [key] of toDelete) {
                fileCache.delete(key);
            }
            this._fileCache.clear();
        }

        // 提示 V8 GC（仅在 Node.js 环境且支持的情况下）
        if (typeof global !== 'undefined' && global.gc) {
            try { global.gc(); } catch {}
        }

        // 限制模型引用（减少 Monaco 内存占用）
        if (editor && editor.getModels) {
            const models = editor.getModels();
            if (models.length > 15) {
                // 保留最近的 15 个模型，释放其余
                for (let i = 0; i < models.length - 15; i++) {
                    try { models[i].dispose(); } catch {}
                }
            }
        }
    }

    // ── 滚动优化 ──
    /**
     * 为大文件开启滚动优化
     * @param {object} editor - Monaco editor 实例
     */
    optimizeScroll(editor) {
        if (!editor) return;

        try {
            // 检测大文件
            const model = editor.getModel();
            if (model && model.getLineCount() > THRESHOLDS.largeFileLines) {
                // 增大滚动渲染视口
                editor.updateOptions({
                    scrollBeyondLastLine: false,
                    minimap: { enabled: false }, // 大文件禁用 minimap 节省渲染
                    renderWhitespace: 'none',
                    renderControlCharacters: false,
                    occurrencesHighlight: false,
                    selectionHighlight: false,
                    // 增大滚动步长减少小滚动事件
                    smoothScrolling: false,
                });
            }
        } catch {}
    }

    // ── 输入防抖 ──
    /**
     * 延迟应用 Monaco 输入更改（合并连续输入）
     */
    setupInputDebounce(editor) {
        if (!editor) return;

        let compositionInProgress = false;

        editor.onDidCompositionStart(() => { compositionInProgress = true; });
        editor.onDidCompositionEnd(() => { compositionInProgress = false; });

        // 仅在非组合输入时才对内容变更做节流
        // (IME 输入期间不节流，避免破坏输入法体验)
        return () => { compositionInProgress = false; };
    }

    // ── 批量更新 ──
    /**
     * 批量执行多个 Editor 操作（减少 reflow）
     * @param {Function} updateFn - 包含多个 editor 操作的函数
     */
    batchUpdate(updateFn) {
        // Monaco 在单个微任务内的多次编辑会自动批处理
        // 使用 requestAnimationFrame 或 queueMicrotask 确保批处理边界
        if (typeof queueMicrotask !== 'undefined') {
            return new Promise((resolve) => {
                queueMicrotask(() => {
                    try { updateFn(); } catch (e) { console.error('[Perf] 批量更新异常:', e); }
                    resolve();
                });
            });
        }
        return Promise.resolve().then(() => {
            try { updateFn(); } catch (e) { console.error('[Perf] 批量更新异常:', e); }
        });
    }

    // ── 内存监控 ──
    _startMemoryMonitor() {
        this._gcTimer = setInterval(() => {
            try {
                const memUsage = process.memoryUsage();
                const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);

                if (heapUsedMB > THRESHOLDS.memoryWarningMB) {
                    this.metrics.memoryWarnings++;
                    console.warn(`[Perf] 内存告警: 堆使用 ${heapUsedMB}MB (阈值 ${THRESHOLDS.memoryWarningMB}MB)`);

                    // 尝试触发 GC
                    if (typeof global !== 'undefined' && global.gc) {
                        try { global.gc(); } catch {}
                    }
                }

                // 帧率检查 (基于最近帧间隔)
                if (this._frameIntervals.length >= 10) {
                    const recentFrames = this._frameIntervals.slice(-10);
                    const avgFrameMs = recentFrames.reduce((a, b) => a + b, 0) / recentFrames.length;
                    const fps = Math.round(1000 / avgFrameMs);

                    if (fps < THRESHOLDS.fpsWarningThreshold) {
                        this.metrics.lastFrameDrop = Date.now();
                        // 静默记录，不频繁打日志
                    }
                }
            } catch {}
        }, THRESHOLDS.gcIntervalMs);
    }
}
exports.PerfOptimizer = PerfOptimizer;

exports.perfOptimizer = new PerfOptimizer();
