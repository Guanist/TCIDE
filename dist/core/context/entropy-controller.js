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
exports.EntropyController = exports.entropyController = void 0;
/**
 * TCIDE Entropy Controller — P3 上下文熵控引擎
 *
 * 编排 P3 三件套:
 *   EntropyEvaluator (评估) → SmartTrimmer (瘦身) → EntropyController (控制)
 *
 * 核心机制:
 *   1. 上下文熵实时监控 — 滑动窗口熵值追踪
 *   2. 自适应Token预算 — 根据任务复杂度 + 项目熵动态调整
 *   3. Prompt压缩策略 — 多级压缩(无损→摘要→丢弃)
 *   4. 相关性衰减 — 旧消息指数衰减权重
 *   5. 注意力预算分配 — 类似"注意力机制"，给关键信息更多 token
 *
 * 决策循环:
 *   每N轮对话 → 评估当前上下文熵 → 如果超过阈值 → 触发SmartTrimmer
 *   → 如果仍超 → 更激进压缩 → 如果还不够 → 提示用户新开会话
 */
const ENTROPY_THRESHOLDS = {
    safe: 0.4,    // < 0.4: no action needed
    warn: 0.65,   // 0.4-0.65: gentle trim
    critical: 0.85, // 0.65-0.85: aggressive trim
    overflow: 1.0, // > 0.85: emergency + suggest new session
};

class EntropyController {
    constructor(config = {}) {
        this.config = {
            maxContextTokens: config.maxContextTokens || 50000,
            entropyCheckInterval: config.entropyCheckInterval || 5, // check every N turns
            decayRate: config.decayRate || 0.85, // exponential decay per turn
            minRelevance: config.minRelevance || 0.1,
            autoTrim: config.autoTrim !== false,
            ...config,
        };

        this.projectRoot = null;
        this.turnCount = 0;
        this.contextEntropy = 0;
        this.tokenUsage = 0;
        this.chunkRelevance = new Map(); // chunkId → relevance score
        this.entropyHistory = []; // [{turn, entropy, tokens, action}]
        this.attentionBudget = new Map(); // topic → token budget
        this.onAction = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
    }

    /**
     * 每轮对话调用 — 执行熵控循环
     * @param {object} state
     * @param {Array} state.messages — 当前上下文消息列表
     * @param {number} state.projectEntropy — 来自 EntropyEvaluator 的项目熵分
     * @param {Array} state.openFiles — 当前打开文件
     * @param {string} state.currentTask — 当前任务描述
     * @returns {{ shouldTrim: boolean, budget: number, entropy: number, action: string, stats: object }}
     */
    tick(state) {
        this.turnCount++;
        const { messages = [], projectEntropy = 50, openFiles = [], currentTask = '' } = state;

        // 1. 计算上下文熵
        const contextEntropy = this._computeContextEntropy(messages, projectEntropy);
        this.contextEntropy = contextEntropy;
        this.tokenUsage = this._estimateTotalTokens(messages);

        // 2. 计算自适应预算
        const budget = this._computeAdaptiveBudget(projectEntropy, currentTask);

        // 3. 决策
        let action = 'none';
        let shouldTrim = false;

        if (contextEntropy >= ENTROPY_THRESHOLDS.overflow) {
            action = 'emergency';
            shouldTrim = true;
        } else if (contextEntropy >= ENTROPY_THRESHOLDS.critical) {
            action = 'aggressive_trim';
            shouldTrim = true;
        } else if (contextEntropy >= ENTROPY_THRESHOLDS.warn) {
            action = 'gentle_trim';
            shouldTrim = this.tokenUsage > budget;
        } else if (this.tokenUsage > budget * 1.2) {
            action = 'budget_exceeded';
            shouldTrim = true;
        }

        // 4. 更新相关性衰减
        this._decayRelevance(messages);

        // 5. 分配注意力预算
        this._allocateAttentionBudget(messages, currentTask, openFiles);

        // 6. 记录历史
        this.entropyHistory.push({
            turn: this.turnCount,
            entropy: Math.round(contextEntropy * 100) / 100,
            tokens: this.tokenUsage,
            budget,
            action,
            timestamp: Date.now(),
        });

        // Keep history bounded
        if (this.entropyHistory.length > 200) {
            this.entropyHistory = this.entropyHistory.slice(-200);
        }

        this.onAction?.({ action, entropy: contextEntropy, tokens: this.tokenUsage, budget, shouldTrim });

        return {
            shouldTrim,
            budget,
            entropy: contextEntropy,
            action,
            stats: {
                turnCount: this.turnCount,
                tokenUsage: this.tokenUsage,
                budgetUtilization: Math.round(this.tokenUsage / Math.max(budget, 1) * 100),
                attentionBudget: Object.fromEntries(this.attentionBudget),
                recentEntropy: this.entropyHistory.slice(-5).map(h => ({ turn: h.turn, e: h.entropy, action: h.action })),
            },
        };
    }

    /**
     * 获取当前状态的 System Prompt 注入（供 AI 感知上下文压力）
     */
    getSystemPromptInjection() {
        if (this.contextEntropy < ENTROPY_THRESHOLDS.warn) return '';

        const pressureLevel = this.contextEntropy >= ENTROPY_THRESHOLDS.overflow ? 'CRITICAL' :
                             this.contextEntropy >= ENTROPY_THRESHOLDS.critical ? 'HIGH' : 'MODERATE';

        return [
            '',
            '【上下文压力监测】',
            `当前上下文压力: ${pressureLevel} (熵值: ${Math.round(this.contextEntropy * 100)}%)`,
            `Token 用量: ${this.tokenUsage}`,
            '',
            this.contextEntropy >= ENTROPY_THRESHOLDS.critical
                ? '注意: 上下文即将溢出。请精简回复，优先完成当前任务，避免引入新的上下文。'
                : '建议: 聚焦当前任务，压缩不必要的信息。',
            '【压力监测结束】',
            '',
        ].join('\n');
    }

    /**
     * 获取推荐的新对话预算
     */
    getSessionRecommendation() {
        return {
            shouldRestart: this.contextEntropy >= ENTROPY_THRESHOLDS.overflow,
            suggestedMaxMessages: this.contextEntropy >= ENTROPY_THRESHOLDS.critical ? 15 : 30,
            suggestedMaxTokens: this._computeAdaptiveBudget(50, 'normal'),
            keepTopics: [...this.attentionBudget.keys()].slice(0, 5),
        };
    }

    /**
     * 为 SmartTrimmer 提供修剪策略
     */
    getTrimmingStrategy() {
        if (this.contextEntropy >= ENTROPY_THRESHOLDS.overflow) {
            return { level: 'aggressive', keepSystem: true, keepLast: 5, maxTokens: 8000 };
        } else if (this.contextEntropy >= ENTROPY_THRESHOLDS.critical) {
            return { level: 'moderate', keepSystem: true, keepLast: 10, maxTokens: 15000 };
        } else {
            return { level: 'gentle', keepSystem: true, keepLast: 15, maxTokens: 25000 };
        }
    }

    // ── Private: Entropy computation ──
    _computeContextEntropy(messages, projectEntropy) {
        if (messages.length === 0) return 0;

        // Factor 1: Token density (tokens per message)
        const tokenDensity = this.tokenUsage / Math.max(messages.length, 1);
        const densityFactor = Math.min(1, tokenDensity / 500); // normalize around 500 tokens/msg

        // Factor 2: Topic diversity (message count × role variety)
        const roles = new Set(messages.map(m => m.role));
        const roleDiversity = roles.size / 4; // max 4 roles (system/user/assistant/tool)
        const messageVolume = Math.min(1, messages.length / 50);

        // Factor 3: Turn count (older conversations have more entropy)
        const turnPenalty = Math.min(1, this.turnCount / 30);

        // Factor 4: Project entropy contribution (external)
        const projectFactor = projectEntropy / 100;

        // Weighted combination
        const weights = { density: 0.25, diversity: 0.15, volume: 0.20, turn: 0.15, project: 0.25 };
        const entropy =
            densityFactor * weights.density +
            roleDiversity * weights.diversity +
            messageVolume * weights.volume +
            turnPenalty * weights.turn +
            projectFactor * weights.project;

        return Math.min(1, Math.round(entropy * 100) / 100);
    }

    _computeAdaptiveBudget(projectEntropy, taskComplexity) {
        let budget = this.config.maxContextTokens;

        // Reduce for high-entropy projects
        if (projectEntropy > 70) budget *= 0.6;
        else if (projectEntropy > 45) budget *= 0.8;

        // Increase for complex tasks
        if (taskComplexity === 'high') budget *= 1.2;
        else if (taskComplexity === 'low') budget *= 0.85;

        // Reduce as turns accumulate
        const turnFactor = Math.max(0.5, 1 - this.turnCount * 0.01);
        budget *= turnFactor;

        return Math.max(4000, Math.floor(budget)); // minimum 4K
    }

    // ── Private: Relevance decay ──
    _decayRelevance(messages) {
        // Apply exponential decay to all existing relevance scores
        for (const [id, score] of this.chunkRelevance) {
            this.chunkRelevance.set(id, score * this.config.decayRate);
            if (score < this.config.minRelevance) this.chunkRelevance.delete(id);
        }

        // Boost relevance of system messages and recent messages
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const id = `msg_${this.turnCount}_${i}`;
            let boost = 1.0;

            if (msg.role === 'system') boost = 2.0;
            if (i >= messages.length - 3) boost = 3.0; // last 3 messages
            if (i >= messages.length - 8) boost = 1.5; // last 8 messages

            this.chunkRelevance.set(id, boost);
        }
    }

    // ── Private: Attention budget ──
    _allocateAttentionBudget(messages, currentTask, openFiles) {
        const topics = this._extractTopics(messages, currentTask, openFiles);
        const totalBudget = this._computeAdaptiveBudget(50, 'normal');
        const topicCount = Math.max(topics.length, 1);

        // Equal baseline + boost for important topics
        const basePerTopic = totalBudget * 0.5 / topicCount;
        const boostPool = totalBudget * 0.5;

        for (const topic of topics) {
            let boost = 1.0;
            if (currentTask && topic.name.toLowerCase().includes(currentTask.toLowerCase())) boost = 3.0;
            if (openFiles.some(f => topic.name.includes(path.basename(f)))) boost = 2.5;
            if (topic.frequency > 3) boost *= 1.5;

            this.attentionBudget.set(topic.name, Math.floor(basePerTopic * boost));
        }

        // Normalize
        const sum = [...this.attentionBudget.values()].reduce((a, b) => a + b, 1);
        for (const [topic, budget] of this.attentionBudget) {
            this.attentionBudget.set(topic, Math.floor(budget / sum * totalBudget));
        }
    }

    _extractTopics(messages, currentTask, openFiles) {
        const topics = new Map();

        for (const msg of messages) {
            const content = (msg.content || '').toLowerCase();
            // Extract potential topics: tech terms, file refs, task-related words
            const words = content.match(/\b[a-zA-Z_]\w{2,}\b/g) || [];
            for (const word of words) {
                if (['the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are'].includes(word)) continue;
                if (!topics.has(word)) topics.set(word, { name: word, frequency: 0, lastSeen: 0 });
                topics.get(word).frequency++;
            }
        }

        // Add explicit topics
        if (currentTask) {
            topics.set('current_task', { name: currentTask, frequency: messages.length, lastSeen: messages.length });
        }

        if (openFiles?.length) {
            for (const f of openFiles.slice(0, 3)) {
                const name = path.basename(f);
                topics.set(`file:${name}`, { name: `file:${name}`, frequency: 5, lastSeen: messages.length });
            }
        }

        return [...topics.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 10);
    }

    // ── Private: Token estimation ──
    _estimateTokens(text) {
        if (!text) return 0;
        const cnChars = [...text].filter(c => /[\u4e00-\u9fff]/.test(c)).length;
        const enChars = text.length - cnChars;
        return Math.ceil(cnChars * 0.5 + enChars * 0.25);
    }

    _estimateTotalTokens(messages) {
        return messages.reduce((s, m) => s + this._estimateTokens(m.role + (m.content || '')), 0);
    }
}

exports.EntropyController = EntropyController;
exports.entropyController = new EntropyController();
