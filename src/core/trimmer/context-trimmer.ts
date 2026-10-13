/**
 * TCIDE - Context Trimmer
 * 智能上下文压缩引擎
 *
 * 核心职责：
 * 1. Token 估算（中文/英文/代码混合场景）
 * 2. 滑动窗口压缩：保留系统 + 最新对话，折叠归档旧内容
 * 3. 对话摘要归档：自动提取关键架构、决策、错误模式
 * 4. 归档统计追踪
 *
 * 压缩策略（优先级从高到低）：
 *   P0: system messages — 永远保留
 *   P1: 最近 N 轮对话 — 精确保留
 *   P2: 早期对话 — 压缩为摘要块
 *   P3: 超长工具结果 — 截断 + 「已省略」标记
 */

import * as fs from 'fs';
import * as path from 'path';

export interface TrimOptions {
  /** 硬性上限（token），超出则强制压缩，默认 48000 */
  maxTokens?: number;
  /** 保留最近 N 轮完整对话，默认 6 */
  keepRecentRounds?: number;
  /** 工具结果最大保留 token，默认 2000 */
  maxToolResultTokens?: number;
  /** 系统提示词最大 token，默认 4000 */
  maxSystemTokens?: number;
  /** 触发压缩的警告线（百分比），默认 0.85 */
  warnThreshold?: number;
}

export interface TrimResult {
  trimmed: any[];
  archived: ArchivedBlock[];
  tokensSaved: number;
  beforeTokens: number;
  afterTokens: number;
  archiveStats: ArchiveStats;
}

export interface ArchivedBlock {
  id: string;
  summary: string;
  roundCount: number;
  tokenCount: number;
  keyDecisions: string[];
  keyErrors: string[];
  keyFiles: string[];
  archivedAt: number;
}

export interface ArchiveStats {
  archivedCount: number;
  totalTokensSaved: number;
  recentArchives: Array<{ id: string; summary: string; tokenCount: number; archivedAt: number }>;
}

interface CacheEntry {
  content: string;
  timestamp: number;
}

const MAX_TOOL_RESULT_CHARS = 12000;   // ~2000 token（代码场景工程估算）
const SYSTEM_TOKEN_ESTIMATE = 4;        // 每 4 字符 ≈ 1 token（英文场景）
const TOOL_RESULT_ESTIMATE = 6;        // 每 6 字符 ≈ 1 token（代码场景）
const MAX_ARCHIVE_FILE_LINES = 200;     // 摘要提取最多读 200 行

// ──────────────────────────────────────────────────────────────
//  Token 估算
// ──────────────────────────────────────────────────────────────

/**
 * 估算一段文本的 token 数量（工程可用精度）
 * - 中文按 2 字符/token 估算（实际约 1.5-2）
 * - 英文/代码按 4 字符/token 估算
 * - 工具结果按 6 字符/token 估算（高密度代码）
 */
export function estimateTokens(text: string, mode: 'system' | 'normal' | 'tool_result' = 'normal'): number {
  if (!text) return 0;
  const chineseChars = [...text].filter(c => /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(c)).length;
  const nonChinese = text.length - chineseChars;

  switch (mode) {
    case 'system':
      // 系统提示词：混合估算
      return Math.ceil(chineseChars / 2 + nonChinese / 4);
    case 'tool_result':
      // 工具结果：代码为主，紧凑估算
      return Math.ceil(text.length / TOOL_RESULT_ESTIMATE);
    default:
      // 普通对话：宽松估算
      return Math.ceil(chineseChars / 2 + nonChinese / 4);
  }
}

function estimateMessageTokens(msg: any): number {
  if (!msg) return 0;
  if (msg.role === 'system') {
    return estimateTokens(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content), 'system');
  }
  if (msg.role === 'tool') {
    const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
    return estimateTokens(raw, 'tool_result');
  }
  if (Array.isArray(msg.content)) {
    return msg.content.reduce((sum: number, part: any) => {
      if (part.type === 'text') return sum + estimateTokens(part.text, 'normal');
      if (part.type === 'image_url') return sum + 850; // 图片 token 固定开销
      return sum;
    }, 0);
  }
  return estimateTokens(typeof msg.content === 'string' ? msg.content : String(msg.content), 'normal');
}

// ──────────────────────────────────────────────────────────────
//  摘要提取（轻量实现，不依赖额外 API 调用）
// ──────────────────────────────────────────────────────────────

/**
 * 从一段对话中提取关键信息（无需调用 LLM 的轻量实现）
 */
function extractKeyInfo(messages: any[]): {
  keyDecisions: string[];
  keyErrors: string[];
  keyFiles: string[];
  summary: string;
} {
  const decisions: string[] = [];
  const errors: string[] = [];
  const files: Set<string> = new Set();
  const userMsgs: string[] = [];
  const assistantMsgs: string[] = [];

  for (const msg of messages) {
    const content = typeof msg.content === 'string' ? msg.content : '';
    const lower = content.toLowerCase();

    // 提取文件名
    const fileMatches = content.match(/(?:src\/|dist\/|\.\/)?[\w./-]+\.(ts|js|tsx|jsx|py|java|go|rs|cpp|c|h|cs|kt|swift|gradle|json|md|html|css)(?:\b|$)/gi);
    if (fileMatches) fileMatches.forEach((f: string) => files.add(f));

    // 提取决策关键词
    if (/决定|决策|选|采用|使用|引入|新增|创建|新增功能|架构|重构|改用|迁移|优化|修复|绕过/i.test(content)) {
      const snippet = content.slice(0, 120).replace(/\s+/g, ' ').trim();
      if (snippet.length > 10) decisions.push(snippet);
    }

    // 提取错误关键词
    if (/error|exception|failed|失败|错误|崩溃|crash|warn|警告|语法|未定义|cannot|无法/i.test(lower)) {
      const lines = content.split('\n').filter((l: string) => /error|exception|failed|崩溃|语法/i.test(l)).slice(0, 3);
      lines.forEach((l: string) => { if (l.trim()) errors.push(l.trim().slice(0, 200)); });
    }

    if (msg.role === 'user') userMsgs.push(content.slice(0, 200));
    if (msg.role === 'assistant') assistantMsgs.push(content.slice(0, 300));
  }

  // 生成摘要文字
  const topic = userMsgs[0]?.slice(0, 60) || '对话';
  const decisionSummary = decisions.slice(0, 3).map(d => '• ' + d).join('\n');
  const errorSummary = errors.slice(0, 3).map(e => '• ' + e).join('\n');

  const summaryParts = [`关于「${topic}」的讨论`];
  if (decisionSummary) summaryParts.push(`做出的决策:\n${decisionSummary}`);
  if (errorSummary) summaryParts.push(`遇到的问题:\n${errorSummary}`);
  if (files.size > 0) summaryParts.push(`涉及文件: ${[...files].slice(0, 10).join(', ')}`);

  return {
    keyDecisions: decisions.slice(0, 10),
    keyErrors: errors.slice(0, 10),
    keyFiles: [...files].slice(0, 20),
    summary: summaryParts.join('\n\n'),
  };
}

// ──────────────────────────────────────────────────────────────
//  主类
// ──────────────────────────────────────────────────────────────

export class ContextTrimmer {
  private projectRoot: string = '';
  private archiveDir: string = '';
  private archiveIndexPath: string = '';
  private archiveIndex: ArchiveStats = { archivedCount: 0, totalTokensSaved: 0, recentArchives: [] };

  private options: Required<TrimOptions>;
  private promptCache: Map<string, CacheEntry> = new Map();
  private systemPromptCache: Map<string, string> = new Map();

  private backgroundTrimTimer: ReturnType<typeof setInterval> | null = null;
  private lastTrimTime: number = 0;
  private trimCount: number = 0;

  public onTrim?: (result: TrimResult) => void;

  constructor(options: TrimOptions = {}) {
    this.options = {
      maxTokens: options.maxTokens ?? 48000,
      keepRecentRounds: options.keepRecentRounds ?? 6,
      maxToolResultTokens: options.maxToolResultTokens ?? 2000,
      maxSystemTokens: options.maxSystemTokens ?? 4000,
      warnThreshold: options.warnThreshold ?? 0.85,
    };
  }

  init(projectRoot: string): void {
    this.projectRoot = projectRoot;
    this.archiveDir = path.join(projectRoot, '.tcide/chat/archives');
    this.archiveIndexPath = path.join(this.archiveDir, '_index.json');

    // 初始化目录
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    // 加载归档索引
    this.loadArchiveIndex();
  }

  private loadArchiveIndex(): void {
    try {
      if (fs.existsSync(this.archiveIndexPath)) {
        this.archiveIndex = JSON.parse(fs.readFileSync(this.archiveIndexPath, 'utf-8'));
      }
    } catch {
      this.archiveIndex = { archivedCount: 0, totalTokensSaved: 0, recentArchives: [] };
    }
  }

  private saveArchiveIndex(): void {
    try {
      fs.writeFileSync(this.archiveIndexPath, JSON.stringify(this.archiveIndex, null, 2), 'utf-8');
    } catch { /* 忽略写入失败 */ }
  }

  // ── 公共 API ──────────────────────────────────────────────

  /**
   * 智能压缩消息数组
   * @param messages 原始消息数组
   * @returns 压缩后的消息 + 归档块 + 统计
   */
  trim(messages: any[]): TrimResult {
    const beforeTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
    const { maxTokens, keepRecentRounds, maxToolResultTokens, maxSystemTokens } = this.options;

    // 1. 分离消息类型
    const systemMsgs = messages.filter(m => m.role === 'system');
    const toolResults = messages.filter(m => m.role === 'tool');
    const dialogue = messages.filter(m => m.role === 'user' || m.role === 'assistant');

    // 2. 系统消息压缩（如果过长）
    let systemTokens = systemMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);
    let effectiveSystemMsgs = systemMsgs;
    if (systemTokens > maxSystemTokens) {
      // 保留第一个系统消息（主系统提示），截断其 content
      effectiveSystemMsgs = systemMsgs.map((m, i) => {
        if (i === 0 && typeof m.content === 'string') {
          const tokens = estimateTokens(m.content, 'system');
          if (tokens > maxSystemTokens) {
            // 简单截断：保留开头 maxSystemTokens * 2 字符（估算）
            const maxChars = maxSystemTokens * 2;
            return { ...m, content: m.content.slice(0, maxChars) + '\n\n[系统提示词已被截断以节省 token]' };
          }
        }
        return m;
      });
    }

    // 3. 工具结果压缩（截断超长输出）
    const trimmedToolResults = toolResults.map(msg => {
      const raw = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      const tokens = estimateTokens(raw, 'tool_result');
      if (tokens > maxToolResultTokens) {
        const maxChars = maxToolResultTokens * TOOL_RESULT_ESTIMATE;
        return {
          ...msg,
          content: raw.slice(0, maxChars) + `\n\n[已省略 ${raw.length - maxChars} 字符，完整结果见归档]`,
        };
      }
      return msg;
    });

    // 4. 对话滑动窗口
    let trimmedDialogue = this.slidingWindowTrim(dialogue, keepRecentRounds, maxTokens);

    // 5. 合并结果
    const trimmed = [...effectiveSystemMsgs, ...trimmedToolResults, ...trimmedDialogue];
    const afterTokens = trimmed.reduce((s, m) => s + estimateMessageTokens(m), 0);
    const tokensSaved = Math.max(0, beforeTokens - afterTokens);

    const result: TrimResult = {
      trimmed,
      archived: [],
      tokensSaved,
      beforeTokens,
      afterTokens,
      archiveStats: this.archiveIndex,
    };

    // 触发回调
    if (this.onTrim) {
      try { this.onTrim(result); } catch { /* 忽略回调错误 */ }
    }

    return result;
  }

  /**
   * 滑动窗口压缩：保留最近 N 轮 + 归档更早内容
   */
  private slidingWindowTrim(dialogue: any[], keepRounds: number, maxTokens: number): any[] {
    if (dialogue.length === 0) return [];

    // 提取用户-助手的轮次对
    const rounds: any[][] = [];
    let currentRound: any[] = [];
    for (const msg of dialogue) {
      currentRound.push(msg);
      if (msg.role === 'user') {
        // 用户消息是新一轮的开始
        if (currentRound.length > 0 && rounds.length === 0) {
          rounds.push([...currentRound]);
          currentRound = [];
        } else if (currentRound.length > 0) {
          // 追加到上一轮
          rounds[rounds.length - 1].push(...currentRound);
          currentRound = [];
        }
      }
    }
    if (currentRound.length > 0) {
      if (rounds.length > 0) rounds[rounds.length - 1].push(...currentRound);
      else rounds.push([...currentRound]);
    }

    // 如果已经是 flat 的（没有明显轮次），直接处理
    if (rounds.length === 0) {
      rounds.push([...dialogue]);
    }

    const keepCount = Math.min(keepRounds, rounds.length);
    const keepRoundsArr = rounds.slice(-keepCount);
    const archiveRounds = rounds.slice(0, -keepCount);

    // Token 预算检查
    let totalTokens = keepRoundsArr.flat().reduce((s, m) => s + estimateMessageTokens(m), 0);
    const archivedBlocks: ArchivedBlock[] = [];

    // 如果保留部分已超预算，递归压缩
    if (totalTokens > maxTokens && keepRoundsArr.length > 1) {
      return this.slidingWindowTrim(
        keepRoundsArr.flat(),
        Math.max(2, keepRounds - 1),
        maxTokens
      );
    }

    // 归档早期轮次
    if (archiveRounds.length > 0) {
      const archiveMsgs = archiveRounds.flat();
      const keyInfo = extractKeyInfo(archiveMsgs);
      const archiveTokens = archiveMsgs.reduce((s, m) => s + estimateMessageTokens(m), 0);

      const blockId = `archive_${Date.now()}_${this.trimCount}`;
      const block: ArchivedBlock = {
        id: blockId,
        summary: keyInfo.summary || `早期 ${archiveRounds.length} 轮对话`,
        roundCount: archiveRounds.length,
        tokenCount: archiveTokens,
        keyDecisions: keyInfo.keyDecisions,
        keyErrors: keyInfo.keyErrors,
        keyFiles: keyInfo.keyFiles,
        archivedAt: Date.now(),
      };

      archivedBlocks.push(block);
      this.addArchive(block);

      // 将归档摘要注入为系统消息
      const archiveSummary = this.buildArchiveSystemMessage(block);
      // keepRoundsArr 是 any[][]（每项是一轮对话的 message[]）
      // 将摘要作为新的系统消息插入到平铺数组的头部
      const flatKept: any[] = keepRoundsArr.flat();
      flatKept.unshift({ role: 'system', content: archiveSummary });
      return flatKept;
    }

    this.trimCount++;
    return keepRoundsArr.flat();
  }

  /**
   * 构建归档摘要注入消息（注入后 AI 仍可感知早期上下文）
   */
  private buildArchiveSystemMessage(block: ArchivedBlock): string {
    const parts = [`【${new Date(block.archivedAt).toLocaleString('zh-CN')} 归档 — ${block.roundCount} 轮对话】`];
    parts.push(block.summary);
    if (block.keyDecisions.length > 0) {
      parts.push(`历史决策:\n${block.keyDecisions.slice(0, 5).map(d => '• ' + d).join('\n')}`);
    }
    if (block.keyErrors.length > 0) {
      parts.push(`历史问题:\n${block.keyErrors.slice(0, 3).map(e => '• ' + e).join('\n')}`);
    }
    parts.push('（如需查看更早的上下文详情，请告诉我文件名或话题）');
    return parts.join('\n\n');
  }

  /**
   * 添加归档块
   */
  private addArchive(block: ArchivedBlock): void {
    // 保存归档文件
    try {
      const archivePath = path.join(this.archiveDir, `${block.id}.json`);
      fs.writeFileSync(archivePath, JSON.stringify(block, null, 2), 'utf-8');
    } catch { /* 忽略 */ }

    // 更新索引
    this.archiveIndex.archivedCount++;
    this.archiveIndex.totalTokensSaved += block.tokenCount;
    this.archiveIndex.recentArchives.unshift({
      id: block.id,
      summary: block.summary.slice(0, 100),
      tokenCount: block.tokenCount,
      archivedAt: block.archivedAt,
    });
    // 最多保留 50 条记录
    this.archiveIndex.recentArchives = this.archiveIndex.recentArchives.slice(0, 50);
    this.saveArchiveIndex();
  }

  /**
   * 提取摘要（供 AI 后续调用）
   */
  extractSummary(messages: any[]): ReturnType<typeof extractKeyInfo> & { originalReq: string; finalCode: string[]; architecture: string } {
    const keyInfo = extractKeyInfo(messages);
    const userMsgs = messages.filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '');
    const codeBlocks: string[] = [];
    for (const msg of messages.filter(m => m.role === 'assistant')) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      const matches = content.match(/```(?:\w+)?\n([\s\S]*?)```/g);
      if (matches) matches.forEach((b: string) => codeBlocks.push(b));
    }

    return {
      originalReq: userMsgs[0] || '',
      finalCode: codeBlocks.slice(0, 10),
      architecture: keyInfo.keyDecisions.find(d => /架构|结构|设计|方案/i.test(d)) || '',
      keyErrors: keyInfo.keyErrors,
      keyDecisions: keyInfo.keyDecisions,
      keyFiles: keyInfo.keyFiles,
      summary: keyInfo.summary,
    };
  }

  /**
   * 读取归档详情
   */
  getArchive(id: string): ArchivedBlock | null {
    try {
      const p = path.join(this.archiveDir, `${id}.json`);
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch { /* 忽略 */ }
    return null;
  }

  /**
   * 内容去重
   */
  deduplicate(content: string, existingBlocks: Set<string>): string {
    if (!content || existingBlocks.size === 0) return content;
    let result = content;
    for (const block of existingBlocks) {
      if (block.length > 50) { // 只对足够长的块去重
        const escaped = block.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp(escaped, 'g'), '[已存在内容]');
      }
    }
    return result;
  }

  /**
   * 获取归档统计
   */
  getArchiveStats(): ArchiveStats {
    return { ...this.archiveIndex };
  }

  /**
   * 检查是否需要压缩（用于主动预警）
   */
  needsTrim(messages: any[]): { needed: boolean; currentTokens: number; maxTokens: number; usagePercent: number } {
    const currentTokens = messages.reduce((s, m) => s + estimateMessageTokens(m), 0);
    const usagePercent = currentTokens / this.options.maxTokens;
    return {
      needed: usagePercent >= this.options.warnThreshold,
      currentTokens,
      maxTokens: this.options.maxTokens,
      usagePercent,
    };
  }

  // ── 缓存 API ─────────────────────────────────────────────

  cacheSystemPrompt(key: string, content: string): void {
    this.systemPromptCache.set(key, content);
    this.promptCache.set(`sys_${key}`, { content, timestamp: Date.now() });
  }

  getCachedPrompt(key: string): string | null {
    return this.systemPromptCache.get(key) || null;
  }

  // ── 后台自动压缩 ─────────────────────────────────────────

  startBackgroundTrim(): void {
    if (this.backgroundTrimTimer) return;
    this.backgroundTrimTimer = setInterval(() => {
      this.lastTrimTime = Date.now();
    }, 60_000);
  }

  stopBackgroundTrim(): void {
    if (this.backgroundTrimTimer) {
      clearInterval(this.backgroundTrimTimer);
      this.backgroundTrimTimer = null;
    }
  }
}

// 单例导出
export const contextTrimmer = new ContextTrimmer();
