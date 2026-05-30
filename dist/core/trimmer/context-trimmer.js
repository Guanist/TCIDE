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
exports.ContextTrimmer = exports.contextTrimmer = void 0;
/**
 * TCIDE Context Trimmer — P0 会话上下文自动瘦身
 *
 * 清理规则:
 *   - 已完成任务对话自动归档并移出活跃上下文
 *   - 历史报错日志移出活跃上下文（保留摘要）
 *   - 临时测试代码自动归档
 *   - 系统固定 Prompt 全局缓存，不重复计入 Token
 *   - 自动去重重复代码块、冗余对话
 *
 * 保留内容:
 *   - 原始需求描述
 *   - 最终生效代码
 *   - 核心架构说明
 *   - 关键报错根因
 *
 * 运行规则: 后台静默执行，不打断编辑与对话流程。
 */
const path = require("path");
const fs = require("fs");

/** 默认配置 */
const DEFAULT_CONFIG = {
    /** 触发瘦身的对话轮数阈值 */
    maxRounds: 10,
    /** 单条消息最大字符数（超出部分截断为摘要） */
    maxMessageChars: 8000,
    /** 最大活跃代码块数（重复块去重） */
    maxCodeBlocks: 20,
    /** 后台瘦身间隔（毫秒） */
    trimIntervalMs: 30000,
    /** 系统 Prompt 缓存 TTL（毫秒） */
    promptCacheTTL: 3600000,
};

/**
 * @typedef {Object} TrimResult
 * @property {object[]} trimmed - 瘦身后的消息列表
 * @property {object[]} archived - 被归档的消息
 * @property {number} tokensSaved - 节省的 Token 估计值
 */

/**
 * @typedef {Object} ArchiveSummary
 * @property {string} originalReq - 原始需求摘要
 * @property {string[]} finalCode - 最终代码片段
 * @property {string} architecture - 核心架构说明
 * @property {string[]} keyErrors - 关键错误根因
 * @property {object[]} decisions - 重要决策记录
 */

class ContextTrimmer {
    constructor(config = {}) {
        this.options = { ...DEFAULT_CONFIG, ...config };
        /** @type {string|null} */
        this.projectRoot = null;

        /** @type {Map<string, {content: string, cachedAt: number}>} System Prompt 缓存 */
        this._promptCache = new Map();

        /** @type {Array<{id: string, messages: object[], summary: string, archivedAt: number}>} 归档历史 */
        this._archives = [];

        /** @type {number} 总节省 Token 估算 */
        this._totalTokensSaved = 0;

        /** @type {number|null} 后台定时器 */
        this._trimTimer = null;

        /** @type {(trimResult: TrimResult) => void|null} 瘦身回调 */
        this.onTrim = null;

        // 已见过的代码块指纹（用于去重）
        this._codeFingerprints = new Map();
    }

    // ── 初始化 ──
    init(projectRoot) {
        this.projectRoot = projectRoot;
        this._loadArchives();
        this._codeFingerprints.clear();
        this._totalTokensSaved = this._calculateStoredTokens();
    }

    // ── 后台瘦身 ──
    startBackgroundTrim() {
        if (this._trimTimer) return;
        this._trimTimer = setInterval(() => {
            // 静默执行：仅在归档数据有变化时写盘
            if (this._archives.length > 0) {
                this._saveArchives();
            }
            // 清理过期 Prompt 缓存
            this._evictExpiredPrompts();
        }, this.options.trimIntervalMs);
    }

    stopBackgroundTrim() {
        if (this._trimTimer) {
            clearInterval(this._trimTimer);
            this._trimTimer = null;
        }
        this._saveArchives();
    }

    // ── System Prompt 缓存 ──
    /**
     * 缓存系统 Prompt 模板
     * @param {string} key - 缓存键（如 'default', 'node-project', 'python-project'）
     * @param {string} content - Prompt 内容
     */
    cacheSystemPrompt(key, content) {
        this._promptCache.set(key, {
            content,
            cachedAt: Date.now(),
        });

        // 持久化到磁盘
        if (this.projectRoot) {
            const cacheDir = path.join(this.projectRoot, '.tcide', 'cache');
            try {
                if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
                fs.writeFileSync(path.join(cacheDir, `prompt-${key}.txt`), content, 'utf-8');
            } catch {}
        }
    }

    getCachedPrompt(key) {
        const entry = this._promptCache.get(key);
        if (entry && Date.now() - entry.cachedAt < this.options.promptCacheTTL) {
            return entry.content;
        }

        // 尝试从磁盘加载
        if (this.projectRoot) {
            const cacheFile = path.join(this.projectRoot, '.tcide', 'cache', `prompt-${key}.txt`);
            try {
                if (fs.existsSync(cacheFile)) {
                    const content = fs.readFileSync(cacheFile, 'utf-8');
                    this._promptCache.set(key, { content, cachedAt: Date.now() });
                    return content;
                }
            } catch {}
        }

        return null;
    }

    // ── 核心瘦身逻辑 ──
    /**
     * 对消息列表执行上下文瘦身
     * @param {Array<{role: string, content: string, id?: string, timestamp?: number}>} messages
     * @returns {TrimResult}
     */
    trim(messages) {
        if (!messages || messages.length <= this.options.maxRounds) {
            return { trimmed: [...messages], archived: [], tokensSaved: 0 };
        }

        const trimmed = [];
        const archived = [];
        let tokensSaved = 0;
        let consecutiveTaskMessages = 0;
        let taskMarker = false;

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);

            // 1. 检测任务完成标记
            if (_isTaskComplete(msg)) {
                taskMarker = true;
                consecutiveTaskMessages = 0;
            }
            if (_isTaskStart(msg)) {
                taskMarker = false;
                consecutiveTaskMessages = 0;
            }

            // 2. 错误日志：归档并摘要
            if (_isErrorLog(content)) {
                if (consecutiveTaskMessages > 50) {
                    archived.push(_summarizeError(msg));
                    tokensSaved += _estimateTokens(content);
                    continue;
                }
            }

            // 3. 代码块去重
            const codeBlocks = _extractCodeBlocks(content);
            if (codeBlocks.length > 0 && this._isDuplicateCode(codeBlocks)) {
                // 重复代码块截断
                const deduped = this._deduplicateContent(content);
                tokensSaved += _estimateTokens(content) - _estimateTokens(deduped);
                trimmed.push({ ...msg, content: deduped });
                continue;
            }
            // 注册新的代码指纹
            for (const block of codeBlocks) {
                const fp = _codeFingerprint(block);
                this._codeFingerprints.set(fp, (this._codeFingerprints.get(fp) || 0) + 1);
            }

            // 4. 超长消息截断
            if (content.length > this.options.maxMessageChars) {
                const truncated = this._truncateMessage(content);
                tokensSaved += _estimateTokens(content) - _estimateTokens(truncated);
                trimmed.push({ ...msg, content: truncated });
                continue;
            }

            // 5. 已完成任务归档
            if (taskMarker) {
                consecutiveTaskMessages++;
                if (consecutiveTaskMessages > 20) {
                    archived.push(_summarizeTask(msg));
                    tokensSaved += _estimateTokens(content);
                    continue;
                }
            }

            trimmed.push(msg);
        }

        // 持久化归档
        if (archived.length > 0) {
            this._archives.push({
                id: `archive_${Date.now()}`,
                messages: archived,
                summary: `归档 ${archived.length} 条消息`,
                archivedAt: Date.now(),
            });
        }

        this._totalTokensSaved += tokensSaved;

        const result = { trimmed, archived, tokensSaved };
        if (this.onTrim) {
            try { this.onTrim(result); } catch {}
        }
        return result;
    }

    /**
     * 从对话中提取关键摘要
     * @returns {ArchiveSummary}
     */
    extractSummary(messages) {
        const summary = {
            originalReq: '',
            finalCode: [],
            architecture: '',
            keyErrors: [],
            decisions: [],
        };

        for (const msg of messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';

            // 提取原始需求（首个 user 消息）
            if (!summary.originalReq && msg.role === 'user' && content.length > 20) {
                summary.originalReq = content.substring(0, 500);
            }

            // 提取最终代码（最后几条 assistant 消息中的代码块）
            const codeBlocks = _extractCodeBlocks(content);
            for (const block of codeBlocks) {
                if (block.length > 30 && !summary.finalCode.includes(block)) {
                    summary.finalCode.push(block.substring(0, 300));
                }
            }

            // 提取错误
            if (content.includes('Error') || content.includes('错误') || content.includes('failed')) {
                const errorLine = content.split('\n').find(l => l.includes('Error') || l.includes('错误'));
                if (errorLine && summary.keyErrors.length < 10) {
                    summary.keyErrors.push(errorLine.substring(0, 200));
                }
            }

            // 提取架构说明
            if (content.includes('架构') || content.includes('architecture') || content.includes('设计')) {
                if (!summary.architecture) summary.architecture = content.substring(0, 500);
            }
        }

        return summary;
    }

    /**
     * 去重：移除与已有块重复的内容
     */
    deduplicate(content, existingBlocks) {
        if (!existingBlocks || existingBlocks.length === 0) return content;

        const codeBlocks = _extractCodeBlocks(content);
        if (codeBlocks.length === 0) return content;

        let deduped = content;
        for (const block of codeBlocks) {
            const fp = _codeFingerprint(block);
            for (const existing of existingBlocks) {
                if (_codeFingerprint(existing) === fp) {
                    deduped = deduped.replace(block, `/* [已省略重复代码块: ${block.substring(0, 40).replace(/\n/g, ' ')}...] */`);
                    break;
                }
            }
        }

        return deduped;
    }

    // ── 查询 ──
    getArchiveStats() {
        return {
            archivedCount: this._archives.reduce((sum, a) => sum + a.messages.length, 0),
            totalTokensSaved: this._totalTokensSaved,
            recentArchives: this._archives.slice(-5).map(a => ({
                id: a.id,
                summary: a.summary,
                messageCount: a.messages.length,
                archivedAt: a.archivedAt,
            })),
        };
    }

    // ── 内部方法 ──
    _truncateMessage(content) {
        // 保留开头和结尾，中间截断
        const head = content.substring(0, this.options.maxMessageChars / 2);
        const tail = content.substring(content.length - this.options.maxMessageChars / 4);
        return head + '\n\n/* ... 中间内容已截断 (' + (content.length - head.length - tail.length) + ' 字符) ... */\n\n' + tail;
    }

    _isDuplicateCode(blocks) {
        for (const block of blocks) {
            const fp = _codeFingerprint(block);
            if (this._codeFingerprints.has(fp)) return true;
        }
        return false;
    }

    _deduplicateContent(content) {
        const codeBlocks = _extractCodeBlocks(content);
        let modified = content;
        for (const block of codeBlocks) {
            const fp = _codeFingerprint(block);
            if (this._codeFingerprints.has(fp)) {
                modified = modified.replace(block,
                    `/* [重复代码块已省略 — 首次出现于此前对话] */`);
            }
        }
        return modified;
    }

    _evictExpiredPrompts() {
        const now = Date.now();
        for (const [key, entry] of this._promptCache) {
            if (now - entry.cachedAt > this.options.promptCacheTTL) {
                this._promptCache.delete(key);
            }
        }
    }

    _loadArchives() {
        if (!this.projectRoot) return;
        const archiveFile = path.join(this.projectRoot, '.tcide', 'context-archives.json');
        try {
            if (fs.existsSync(archiveFile)) {
                this._archives = JSON.parse(fs.readFileSync(archiveFile, 'utf-8'));
            }
        } catch {}
    }

    _saveArchives() {
        if (!this.projectRoot) return;
        const tcideDir = path.join(this.projectRoot, '.tcide');
        try {
            if (!fs.existsSync(tcideDir)) fs.mkdirSync(tcideDir, { recursive: true });
            // 保留最近 50 条归档
            const toSave = this._archives.slice(-50);
            fs.writeFileSync(path.join(tcideDir, 'context-archives.json'), JSON.stringify(toSave, null, 2), 'utf-8');
        } catch {}
    }

    _calculateStoredTokens() {
        let tokens = 0;
        for (const archive of this._archives) {
            for (const msg of archive.messages) {
                const content = typeof msg.content === 'string' ? msg.content : '';
                tokens += _estimateTokens(content);
            }
        }
        return tokens;
    }
}
exports.ContextTrimmer = ContextTrimmer;

// ── 辅助函数 ──

/** 估算 Token 数量（粗略：中文 1 字 ≈ 1.5 token，英文 1 词 ≈ 1.3 token） */
function _estimateTokens(text) {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
    const words = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, '').split(/\s+/).filter(Boolean).length;
    return Math.ceil(chineseChars * 1.5 + words * 1.3);
}

function _isTaskComplete(msg) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return /任务完[成毕]|done|finished|completed|已[完完]成|✅|🎉|all tests pass/i.test(content.substring(0, 200));
}

function _isTaskStart(msg) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return /开始|start|新任务|需求|requirement|帮我|请/i.test(content.substring(0, 100));
}

function _isErrorLog(content) {
    if (!content || content.length < 100) return false;
    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length === 0) return false;
    const errorLines = lines.filter(l =>
        /(error|exception|traceback|stack trace|fatal|panic|segmentation fault|at .+:\d+:\d+)/i.test(l)
    );
    return errorLines.length / lines.length > 0.3 || errorLines.length > 5;
}

function _extractCodeBlocks(content) {
    const blocks = [];
    const regex = /```[\w]*\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
        blocks.push(match[1].trim());
    }
    return blocks;
}

/** 代码块指纹（忽略空白差异） */
function _codeFingerprint(code) {
    const normalized = code.replace(/\s+/g, ' ').replace(/\/\/.*$/gm, '').trim();
    // 简单哈希
    let hash = 0;
    for (let i = 0; i < Math.min(normalized.length, 500); i++) {
        const char = normalized.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
    }
    return String(hash);
}

function _summarizeError(msg) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const lines = content.split('\n');
    const keyLines = lines.filter(l =>
        /error|exception|failed|cause/i.test(l) && !l.includes('at ')
    ).slice(0, 3);
    return {
        ...msg,
        role: 'system',
        content: `[已归档错误摘要] ${keyLines.join(' | ').substring(0, 300)}`,
        _archived: true,
        _originalLength: content.length,
    };
}

function _summarizeTask(msg) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    return {
        ...msg,
        role: 'system',
        content: `[已归档历史任务消息: ${content.substring(0, 150).replace(/\n/g, ' ')}...]`,
        _archived: true,
        _originalLength: content.length,
    };
}

exports.contextTrimmer = new ContextTrimmer();
