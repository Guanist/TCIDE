'use strict';
/**
 * TCIDE DreamEngine — 自主做梦引擎
 *
 * 后台周期性地消化用户操作日志、代码记忆、对话历史，
 * 凝练成「专家记忆卡片」，实现持续进化的长期记忆系统。
 *
 * 梦周期循环:
 *   1. COLLECT — 从各数据源采集待处理数据
 *   2. PROCESS — 模式识别、主题聚类、关联推理
 *   3. SYNTHESIZE — 生成专家记忆（卡片形式）
 *   4. INTEGRATE — 喂入 ProjectMemory + VectorIndexer
 *
 * 触发条件:
 *   - 空闲超过 5 分钟
 *   - 手动触发 (/dream)
 *   - 定时触发 (每 2 小时)
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── 数据源 ──
const DreamCollector = {
    sourceDir: null,

    init(projectRoot) {
        this.sourceDir = path.join(projectRoot, '.tcide', 'dream');
        if (!fs.existsSync(this.sourceDir))
            fs.mkdirSync(this.sourceDir, { recursive: true });
    },

    /** 记录一次用户操作 */
    record(entry) {
        if (!this.sourceDir) return;
        const today = new Date().toISOString().slice(0, 10);
        const logFile = path.join(this.sourceDir, `ops-${today}.jsonl`);
        const line = JSON.stringify({
            ts: Date.now(),
            ...entry
        }) + '\n';
        fs.appendFileSync(logFile, line, 'utf-8');
    },

    /** 收集待处理的原始数据 */
    collect(options = {}) {
        if (!this.sourceDir) return [];
        const { days = 7, limit = 500 } = options;
        const files = fs.readdirSync(this.sourceDir)
            .filter(f => f.startsWith('ops-') && f.endsWith('.jsonl'))
            .sort()
            .slice(-days);

        const entries = [];
        for (const f of files) {
            try {
                const content = fs.readFileSync(path.join(this.sourceDir, f), 'utf-8');
                entries.push(...content.trim().split('\n').filter(Boolean).map(l => {
                    try { return JSON.parse(l); } catch { return null; }
                }).filter(Boolean));
            } catch { /* skip corrupted files */ }
        }
        return entries.slice(-limit);
    }
};

// ── 记忆卡类型 ──
const CARD_TYPES = {
    PATTERN: 'pattern',       // 代码模式
    LESSON: 'lesson',         // 经验教训
    STACK: 'stack',           // 技术栈片段
    WORKFLOW: 'workflow',     // 操作流程
    INSIGHT: 'insight',       // 洞察
    PREFERENCE: 'preference', // 用户偏好
};

class DreamEngine {
    constructor() {
        this.projectRoot = null;
        this.dreamDir = null;
        this.journalFile = null;
        this.isDreaming = false;
        this.lastDreamAt = 0;
        this.dreamCount = 0;
        this.onDreamComplete = null;
        this.onDreamProgress = null;
    }

    init(projectRoot) {
        this.projectRoot = projectRoot;
        this.dreamDir = path.join(projectRoot, '.tcide', 'dream');
        this.journalFile = path.join(this.dreamDir, 'dream-journal.json');
        this.memoryFile = path.join(this.dreamDir, 'expert-memory.json');
        if (!fs.existsSync(this.dreamDir))
            fs.mkdirSync(this.dreamDir, { recursive: true });
        if (!fs.existsSync(this.journalFile))
            fs.writeFileSync(this.journalFile, '[]', 'utf-8');
        if (!fs.existsSync(this.memoryFile))
            fs.writeFileSync(this.memoryFile, '[]', 'utf-8');
        DreamCollector.init(projectRoot);
    }

    /** 触发一次做梦 */
    async dream(options = {}) {
        if (this.isDreaming) return { skipped: true, reason: 'already dreaming' };
        this.isDreaming = true;
        const start = Date.now();
        this.dreamCount++;
        const journalEntry = {
            dreamId: `dream-${start.toString(36)}`,
            startedAt: new Date(start).toISOString(),
            phases: [],
            artifacts: [],
            stats: { inputCount: 0, cardsCreated: 0, durationMs: 0 },
        };

        try {
            // Phase 1: Collect
            this._progress(journalEntry, 'collect', 'start');
            const rawEntries = DreamCollector.collect({ days: 7, limit: 500 });
            journalEntry.stats.inputCount = rawEntries.length;
            this._progress(journalEntry, 'collect', 'done', { count: rawEntries.length });

            // Phase 2: Process & Analyze
            this._progress(journalEntry, 'process', 'start');
            const clusters = this._clusterAndAnalyze(rawEntries);
            this._progress(journalEntry, 'process', 'done', { clusters: clusters.length });

            // Phase 3: Synthesize
            this._progress(journalEntry, 'synthesize', 'start');
            const cards = this._synthesizeCards(clusters);
            journalEntry.stats.cardsCreated = cards.length;
            journalEntry.artifacts = cards;
            this._progress(journalEntry, 'synthesize', 'done', { cards: cards.length });

            // Phase 4: Integrate
            this._progress(journalEntry, 'integrate', 'start');
            this._integrateToMemory(cards);
            this._progress(journalEntry, 'integrate', 'done');
        } catch (err) {
            journalEntry.error = err.message;
        }

        journalEntry.stats.durationMs = Date.now() - start;
        journalEntry.completedAt = new Date().toISOString();
        this.isDreaming = false;
        this.lastDreamAt = start;
        this._saveJournalEntry(journalEntry);

        if (this.onDreamComplete) this.onDreamComplete(journalEntry);
        return journalEntry;
    }

    // ── Phase 2: 聚类分析 ──
    _clusterAndAnalyze(entries) {
        const clusters = [];

        // 按操作类型分组
        const byType = {};
        entries.forEach(e => {
            const t = e.type || 'unknown';
            if (!byType[t]) byType[t] = [];
            byType[t].push(e);
        });

        // 代码编辑聚类
        const codeEdits = entries.filter(e => e.type === 'code-edit' || e.type === 'refactor');
        if (codeEdits.length > 3) {
            clusters.push({
                topic: '代码编辑模式',
                category: CARD_TYPES.PATTERN,
                entries: codeEdits.length,
                summary: this._summarizeCodePatterns(codeEdits),
            });
        }

        // 文件操作聚类
        const fileOps = entries.filter(e => e.type === 'file-open' || e.type === 'file-close' || e.type === 'file-create');
        if (fileOps.length > 5) {
            const fileNames = fileOps.map(e => e.file || e.path || '').filter(Boolean);
            const extCounts = {};
            fileNames.forEach(f => {
                const ext = path.extname(f).toLowerCase();
                extCounts[ext] = (extCounts[ext] || 0) + 1;
            });
            const topExts = Object.entries(extCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
            clusters.push({
                topic: '文件操作习惯',
                category: CARD_TYPES.PREFERENCE,
                entries: fileOps.length,
                summary: `最常操作的文件类型: ${topExts.map(([e, c]) => `${e}(${c}次)`).join(', ')}`,
            });
        }

        // 对话聚类
        const chats = entries.filter(e => e.type === 'chat-message');
        if (chats.length > 3) {
            const keywords = this._extractKeywords(chats.map(e => e.content || '').join(' '));
            clusters.push({
                topic: '对话主题',
                category: CARD_TYPES.INSIGHT,
                entries: chats.length,
                summary: `近期对话关键词: ${keywords.slice(0, 10).join(', ')}`,
            });
        }

        // Git 提交聚类
        const gitEntries = entries.filter(e => e.type === 'git-commit');
        if (gitEntries.length > 1) {
            clusters.push({
                topic: '版本变更趋势',
                category: CARD_TYPES.WORKFLOW,
                entries: gitEntries.length,
                summary: `${gitEntries.length} 次提交，最近: ${(gitEntries.pop()?.message || '').slice(0, 50)}`,
            });
        }

        // 错误聚类
        const errors = entries.filter(e => e.type === 'error' || e.type === 'fix');
        if (errors.length > 1) {
            const errorMsgs = errors.map(e => e.message || e.error || '').filter(Boolean);
            clusters.push({
                topic: '常见问题与修复',
                category: CARD_TYPES.LESSON,
                entries: errors.length,
                summary: errorMsgs.slice(-3).join('; '),
            });
        }

        return clusters;
    }

    // ── Phase 3: 生成专家记忆卡 ──
    _synthesizeCards(clusters) {
        const cards = [];
        const timestamp = new Date().toISOString();

        // 读取已有记忆以去重
        let existing = [];
        try { existing = JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8')); } catch {}

        for (const cluster of clusters) {
            // 简单去重：检查相似主题是否已存在
            const dup = existing.find(e =>
                e.topic === cluster.topic &&
                Date.now() - new Date(e.createdAt).getTime() < 7 * 24 * 3600000
            );
            if (dup) continue; // 7天内不重复生成同一主题

            const card = {
                id: `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                type: cluster.category,
                topic: cluster.topic,
                summary: cluster.summary,
                source: `dream-${this.dreamCount}`,
                evidence: cluster.entries,
                confidence: Math.min(0.9, 0.3 + cluster.entries * 0.05), // 条目越多越可信
                createdAt: timestamp,
                tags: this._generateTags(cluster),
            };
            cards.push(card);
        }

        // 合并并保存
        existing.push(...cards);
        // 只保留最近200条
        const trimmed = existing.slice(-200);
        fs.writeFileSync(this.memoryFile, JSON.stringify(trimmed, null, 2), 'utf-8');

        return cards;
    }

    // ── Phase 4: 集成到其他模块 ──
    _integrateToMemory(cards) {
        // 喂入 ProjectMemory（如果可用）
        try {
            const mem = require('../memory/project-memory').projectMemory;
            if (mem && mem.projectRoot === this.projectRoot) {
                cards.forEach(card => {
                    mem.recordRefactor?.(
                        'dream-insight',
                        `[${card.type}] ${card.topic}`,
                        '',
                        JSON.stringify(card.summary),
                        ''
                    );
                });
            }
        } catch { /* ProjectMemory 不可用 */ }

        // 喂入 VectorIndexer（如果可用）
        try {
            const idx = require('../indexer/vector-indexer').vectorIndexer;
            if (idx && idx.indexDocument) {
                cards.forEach(card => {
                    idx.indexDocument?.(card.id, `${card.topic}: ${card.summary}`, {
                        type: card.type,
                        tags: card.tags,
                    });
                });
            }
        } catch { /* VectorIndexer 不可用 */ }
    }

    // ── 关键词提取 (简易) ──
    _extractKeywords(text) {
        const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也',
            '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'
        ]);
        const words = text.toLowerCase()
            .replace(/[^\w\u4e00-\u9fff]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.has(w));

        const freq = {};
        words.forEach(w => { freq[w] = (freq[w] || 0) + 1; });
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([w]) => w);
    }

    // ── 代码模式总结 ──
    _summarizeCodePatterns(edits) {
        const files = []; const langs = {};
        edits.forEach(e => {
            if (e.file) files.push(e.file);
            if (e.language) langs[e.language] = (langs[e.language] || 0) + 1;
        });
        const topLang = Object.entries(langs).sort((a, b) => b[1] - a[1])[0];
        return `在 ${edits.length} 次编辑中，主要在 ${topLang ? topLang[0] : '未知'} 文件中工作`;
    }

    _generateTags(cluster) {
        const tags = [cluster.category];
        const keywords = this._extractKeywords(cluster.summary);
        return [...tags, ...keywords.slice(0, 5)];
    }

    // ── 进度回调 ──
    _progress(entry, phase, status, data = {}) {
        entry.phases.push({ phase, status, ts: Date.now(), ...data });
        if (this.onDreamProgress) {
            this.onDreamProgress({ dreamId: entry.dreamId, phase, status, ...data });
        }
    }

    // ── 保存梦境日志 ──
    _saveJournalEntry(entry) {
        try {
            let journal = JSON.parse(fs.readFileSync(this.journalFile, 'utf-8'));
            journal.unshift(entry);
            if (journal.length > 100) journal = journal.slice(0, 100);
            fs.writeFileSync(this.journalFile, JSON.stringify(journal, null, 2), 'utf-8');
        } catch { /* skip */ }
    }

    // ── 获取梦境日志 ──
    getJournal(limit = 20) {
        try { return JSON.parse(fs.readFileSync(this.journalFile, 'utf-8')).slice(0, limit); } catch { return []; }
    }

    // ── 获取专家记忆 ──
    getExpertMemory(type = null) {
        try {
            const all = JSON.parse(fs.readFileSync(this.memoryFile, 'utf-8'));
            return type ? all.filter(c => c.type === type) : all;
        } catch { return []; }
    }

    // ── 获取上一次梦境的时间 ──
    getLastDreamTime() { return this.lastDreamAt; }

    /** 检查是否应该触发做梦 (空闲 > 5分钟) */
    shouldDream() {
        if (this.isDreaming) return false;
        if (this.dreamCount === 0) return true; // 首次总是触发
        const elapsed = Date.now() - this.lastDreamAt;
        return elapsed > 5 * 60 * 1000; // 5分钟
    }
}

// ── 单例 ──
const dreamEngine = new DreamEngine();
exports.DreamEngine = DreamEngine;
exports.DreamCollector = DreamCollector;
exports.dreamEngine = dreamEngine;
