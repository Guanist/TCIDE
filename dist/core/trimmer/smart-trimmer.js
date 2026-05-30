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
exports.SmartTrimmer = exports.smartTrimmer = void 0;
/**
 * TCIDE Smart Trimmer — P3 智能瘦身引擎
 *
 * 与基础 ContextTrimmer(P0)的区别:
 *   P0 Trimmer: 固定规则归档旧对话、去重
 *   P3 SmartTrimmer: 熵感知的动态预算分配, 多级压缩策略,
 *                      关键上下文保护, 自适应 token 分配
 *
 * 核心算法:
 *   Score(chunk) = relevance × recency × specificity / cost
 *   然后 greedy-knapsack 选出最优子集
 */
const fs = require("fs");
const path = require("path");

const COMPRESSION_LEVELS = {
    FULL: 0,      // Keep as-is
    SUMMARIZE: 1, // Compress to key points
    MINIMAL: 2,   // Keep only filename/symbol references
    DROP: 3,      // Remove entirely
};

class SmartTrimmer {
    constructor(config = {}) {
        this.config = {
            maxTokens: config.maxTokens || 50000,
            safetyMargin: config.safetyMargin || 0.15, // 15% buffer
            minChunkTokens: config.minChunkTokens || 50,
            recentWindow: config.recentWindow || 10, // last N messages always keep
            trimIntervalMs: config.trimIntervalMs || 300000,
            ...config,
        };

        this.projectRoot = null;
        this.projectEntropy = 50;
        this.chunkCache = new Map();
        this.archiveIndex = [];
        this.trimHistory = [];
        this.onTrim = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
        const trimDir = path.join(projectRoot, '.tcide', 'trimmer');
        if (!fs.existsSync(trimDir)) fs.mkdirSync(trimDir, { recursive: true });
        this._loadArchive();
    }

    /**
     * 自适应瘦身 — 输入消息列表，输出最优压缩后的消息列表
     * @param {Array<{role, content, timestamp?, filePath?, relevance?}>} messages
     * @param {object} context — { projectEntropy, openFiles, activeTasks, taskComplexity }
     * @returns {{ trimmed: Array, removed: Array, stats: {tokensBefore, tokensAfter, tokensSaved, compressionRatio} }}
     */
    trim(messages, context = {}) {
        const stats = {
            tokensBefore: this._estimateTotalTokens(messages),
            tokensAfter: 0,
            tokensSaved: 0,
            compressionRatio: 0,
        };

        // Adjust budget based on project entropy and task complexity
        const budget = this._calculateBudget(context);

        // Step 1: Score each chunk
        const scored = messages.map((msg, i) => ({
            ...msg,
            index: i,
            tokens: this._estimateTokens(msg.content || ''),
            score: this._scoreChunk(msg, i, messages.length, context),
            compression: null, // Set during budget allocation
        }));

        // Step 2: Sort by score (descending)
        scored.sort((a, b) => b.score - a.score);

        // Step 3: Greedy knapsack allocation
        const protectedIndices = this._getProtectedIndices(scored, messages.length);
        let budgetRemaining = budget;

        // Always protect recent + critical
        for (const idx of protectedIndices) {
            const chunk = scored.find(c => c.index === idx);
            if (chunk) {
                chunk.compression = COMPRESSION_LEVELS.FULL;
                budgetRemaining -= chunk.tokens;
            }
        }

        // Allocate remaining budget by score
        for (const chunk of scored) {
            if (chunk.compression !== null) continue; // Already allocated
            if (budgetRemaining <= 0) {
                chunk.compression = COMPRESSION_LEVELS.DROP;
                continue;
            }

            // Decide compression level based on remaining budget
            if (chunk.tokens <= budgetRemaining && chunk.score > 0.3) {
                chunk.compression = COMPRESSION_LEVELS.FULL;
                budgetRemaining -= chunk.tokens;
            } else if (chunk.tokens * 0.3 <= budgetRemaining && chunk.score > 0.15) {
                chunk.compression = COMPRESSION_LEVELS.SUMMARIZE;
                budgetRemaining -= Math.ceil(chunk.tokens * 0.3);
            } else if (chunk.score > 0.05) {
                chunk.compression = COMPRESSION_LEVELS.MINIMAL;
                budgetRemaining -= Math.ceil(chunk.tokens * 0.1);
            } else {
                chunk.compression = COMPRESSION_LEVELS.DROP;
            }
        }

        // Step 4: Apply compression & rebuild
        const trimmed = [];
        const removed = [];

        // Sort back to original order
        scored.sort((a, b) => a.index - b.index);

        for (const chunk of scored) {
            switch (chunk.compression) {
                case COMPRESSION_LEVELS.FULL:
                    trimmed.push({ role: chunk.role, content: chunk.content });
                    stats.tokensAfter += chunk.tokens;
                    break;
                case COMPRESSION_LEVELS.SUMMARIZE:
                    {
                        const summary = this._summarize(chunk.content, chunk.role);
                        trimmed.push({ role: chunk.role, content: summary });
                        stats.tokensAfter += this._estimateTokens(summary);
                        removed.push({ type: 'summarized', original: chunk.content.slice(0, 200), summary });
                    }
                    break;
                case COMPRESSION_LEVELS.MINIMAL:
                    {
                        const minimal = this._minimal(chunk);
                        if (minimal) {
                            trimmed.push({ role: chunk.role, content: minimal });
                            stats.tokensAfter += this._estimateTokens(minimal);
                        }
                        removed.push({ type: 'minimized', original: chunk.content.slice(0, 100), minimal });
                    }
                    break;
                case COMPRESSION_LEVELS.DROP:
                    removed.push({ type: 'dropped', original: chunk.content.slice(0, 100) });
                    break;
            }
        }

        stats.tokensSaved = stats.tokensBefore - stats.tokensAfter;
        stats.compressionRatio = stats.tokensBefore > 0 ? Math.round(stats.tokensSaved / stats.tokensBefore * 100) : 0;

        // Archive removed content
        if (removed.length > 0) {
            this._archive(removed);
        }

        // Record trim history
        this.trimHistory.push({
            timestamp: Date.now(),
            tokensBefore: stats.tokensBefore,
            tokensAfter: stats.tokensAfter,
            budget,
            entropy: this.projectEntropy,
        });

        this.onTrim?.({ stats, removed });
        return { trimmed, removed, stats };
    }

    /**
     * 注册项目熵分（由 EntropyEvaluator 输出）
     */
    setProjectEntropy(entropy) {
        this.projectEntropy = entropy;
        // Auto-adjust trim interval: higher entropy = trim more often
        if (entropy > 70) this.config.trimIntervalMs = 120000;
        else if (entropy > 50) this.config.trimIntervalMs = 180000;
        else this.config.trimIntervalMs = 300000;
    }

    /**
     * 获取归档摘要
     */
    getArchiveSummary() {
        return {
            totalArchived: this.archiveIndex.length,
            lastTrim: this.trimHistory[this.trimHistory.length - 1] || null,
            averageSavings: this.trimHistory.length > 0
                ? Math.round(this.trimHistory.reduce((s, t) => s + t.compressionRatio, 0) / this.trimHistory.length)
                : 0,
        };
    }

    // ── Private: Scoring ──
    _scoreChunk(msg, index, total, context) {
        let score = 0.5; // base

        // Recency: newer messages score higher (sigmoid weighting)
        const recency = 1 / (1 + Math.exp(-(index - total * 0.7) / (total * 0.1)));
        score *= recency;

        // Relevance to active tasks
        if (context.activeTasks?.length) {
            for (const task of context.activeTasks) {
                if ((msg.content || '').toLowerCase().includes(task.toLowerCase())) {
                    score *= 2.0; // 2x boost for task-relevant content
                    break;
                }
            }
        }

        // Open file references
        if (context.openFiles?.length) {
            for (const file of context.openFiles) {
                const fileName = path.basename(file);
                if ((msg.content || '').includes(fileName)) {
                    score *= 1.5;
                    break;
                }
            }
        }

        // Specificity: longer + structured = more informative
        const content = msg.content || '';
        const hasCodeBlock = content.includes('```');
        const hasStructured = content.match(/^[#\-\*\d]+\.?\s/m);
        const specificity = Math.min(1, content.length / 500) * (hasCodeBlock ? 1.3 : 1) * (hasStructured ? 1.2 : 1);
        score *= specificity;

        // Entropy penalty: when project is chaotic, prefer shorter, focused messages
        if (this.projectEntropy > 60) {
            const brevityPenalty = Math.min(1, 200 / Math.max(content.length, 1));
            score *= (0.7 + brevityPenalty * 0.3);
        }

        return score;
    }

    // ── Private: Budget calculation ──
    _calculateBudget(context) {
        let budget = this.config.maxTokens * (1 - this.config.safetyMargin);

        // Larger budget for complex tasks
        if (context.taskComplexity === 'high') budget *= 1.3;
        else if (context.taskComplexity === 'low') budget *= 0.8;

        // Lower budget for high-entropy projects (more aggressive trimming)
        if (this.projectEntropy > 70) budget *= 0.7;
        else if (this.projectEntropy > 45) budget *= 0.85;

        return Math.floor(budget);
    }

    _getProtectedIndices(scored, total) {
        const indices = new Set();

        // Always keep last N messages
        for (let i = Math.max(0, total - this.config.recentWindow); i < total; i++) {
            indices.add(i);
        }

        // Always keep system messages
        for (const chunk of scored) {
            if (chunk.role === 'system') indices.add(chunk.index);
        }

        return indices;
    }

    // ── Private: Compression ──
    _summarize(content, role) {
        const clean = content.replace(/```[\s\S]*?```/g, '[code block]').replace(/\s+/g, ' ').trim();
        if (clean.length <= 200) return clean;

        // Extract first sentence + key points
        const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
        const first = sentences[0]?.trim().slice(0, 120) || clean.slice(0, 120);
        const keyPoints = sentences.slice(1).filter(s => s.match(/\b(error|fix|add|remove|update|change|refactor|implement|TODO|FIXME|import|require)\b/i)).slice(0, 2);

        return `[${role}] ${first}${keyPoints.length ? ' | ' + keyPoints.map(s => s.trim().slice(0, 60)).join('; ') : ''}`;
    }

    _minimal(chunk) {
        const content = chunk.content || '';
        // Extract file paths
        const fileMatch = content.match(/[^\s"']+\.(jsx?|tsx?|py|go|rs|java|kt|vue|css|html|json|md)/g);
        // Extract function names
        const funcMatch = content.match(/\b(function|const|class|interface|type|def|func)\s+(\w+)/g);

        const parts = [];
        if (fileMatch) parts.push(`files: ${fileMatch.slice(0, 3).join(', ')}`);
        if (funcMatch) parts.push(funcMatch.slice(0, 3).join(', '));

        return parts.length > 0 ? `[${chunk.role}] ${parts.join(' | ')}` : null;
    }

    // ── Private: Token estimation ──
    _estimateTokens(text) {
        if (!text) return 0;
        const cnChars = [...text].filter(c => /[\u4e00-\u9fff]/.test(c)).length;
        const enChars = text.length - cnChars;
        return Math.ceil(cnChars * 0.5 + enChars * 0.25);
    }

    _estimateTotalTokens(messages) {
        return messages.reduce((sum, m) => sum + this._estimateTokens(m.role + (m.content || '')), 0);
    }

    // ── Private: Archive ──
    _archive(removed) {
        const entry = {
            timestamp: Date.now(),
            count: removed.length,
            items: removed.slice(0, 20).map(r => ({
                type: r.type,
                preview: (r.original || r.summary || r.minimal || '').slice(0, 100),
            })),
        };
        this.archiveIndex.push(entry);
        if (this.archiveIndex.length > 1000) this.archiveIndex = this.archiveIndex.slice(-1000);
        this._saveArchive();
    }

    _saveArchive() {
        if (!this.projectRoot) return;
        try {
            fs.writeFileSync(
                path.join(this.projectRoot, '.tcide', 'trimmer', 'smart_archive.json'),
                JSON.stringify(this.archiveIndex.slice(-200), null, 0),
                'utf-8'
            );
        } catch {}
    }

    _loadArchive() {
        if (!this.projectRoot) return;
        try {
            const fp = path.join(this.projectRoot, '.tcide', 'trimmer', 'smart_archive.json');
            if (fs.existsSync(fp)) this.archiveIndex = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        } catch {}
    }
}

exports.SmartTrimmer = SmartTrimmer;
exports.smartTrimmer = new SmartTrimmer();
