/**
 * TCIDE - AI 行为配置管理器
 * 
 * 扫描并合并多层 CLAUDE.md 规则文件，在每次 AI 请求前自动注入为系统提示词。
 * 
 * 扫描顺序（后面的覆盖前面的）：
 *   1. ~/.tcide/CLAUDE.md              （全局默认）
 *   2. {project}/CLAUDE.md              （项目共享）
 *   3. {project}/CLAUDE.local.md        （本地覆盖，不入 Git）
 *   4. {project}/.trae/RULES.md         （Trae 工程兼容）
 *   5. {project}/.qclaw/rules.md        （QClaw 工程兼容）
 *   6. {project}/.codebuddy/rules.md    （CodeBuddy 工程兼容）
 * 
 * 缓存策略：30s TTL + 文件 hash 检测，避免频繁磁盘 I/O
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

interface CacheEntry {
  rules: string;
  timestamp: number;
  /** 所有源文件的 hash 快照，用于检测变更 */
  sourceHashes: Map<string, string>;
}

/** 30 秒最小缓存时间，期间不检查文件变更 */
const CACHE_TTL_MS = 30_000;

/** 各扫描目标的相对路径 */
const SCAN_TARGETS: Array<{
  scope: 'global' | 'project' | 'compat';
  relativePath: string;
}> = [
  // 全局级（最低优先级）
  { scope: 'global', relativePath: '.tcide/CLAUDE.md' },
  // 项目级
  { scope: 'project', relativePath: 'CLAUDE.md' },
  // 本地级（最高优先级，不入 Git）
  { scope: 'project', relativePath: 'CLAUDE.local.md' },
  // 工程兼容层
  { scope: 'compat', relativePath: '.trae/RULES.md' },
  { scope: 'compat', relativePath: '.qclaw/rules.md' },
  { scope: 'compat', relativePath: '.codebuddy/rules.md' },
];

// ────────────────────────────────────────────────────────────
//  内置默认规则（Karpathy 原则，未配置时的兜底）
// ────────────────────────────────────────────────────────────
export const BUILTIN_RULES = `# TCIDE 默认编程规则（内置）

## 1. 思考优先
- 明确陈述所有假设，不确定时先提问，绝不猜测
- 有更简单的实现方案时，必须主动提出
- 遇到困惑就停下来，清晰说明哪里不清楚

## 2. 简单至上
- 用最少的代码解决问题，不做无根据的臆测
- 绝不添加超出需求的功能
- 不对只用一次的代码做抽象

## 3. 外科手术式修改
- 只改必须改的部分，只收拾自己弄乱的地方
- 绝不"顺手改进"相邻代码、注释或格式
- 严格遵循现有代码风格，保持一致性

## 4. 目标驱动
- 先定义清晰的成功标准，再开始编码
- 完成后自行验证是否达到目标
- 遇到阻碍时，主动调整方案并告知用户`;

function hashContent(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex');
}

export class ConfigManager {
  private cache: Map<string, CacheEntry> = new Map();

  /**
   * 获取项目的合并后 AI 规则
   * @param projectRoot 项目根目录绝对路径
   * @returns 合并后的规则文本，无文件时返回内置默认规则
   */
  getRules(projectRoot: string): string {
    const entry = this.cache.get(projectRoot);
    const now = Date.now();

    // 缓存有效期内直接返回
    if (entry && (now - entry.timestamp) < CACHE_TTL_MS) {
      return entry.rules;
    }

    // 期内快速检查：所有源文件 hash 未变则续期
    if (entry && this.sourceUnchanged(entry.sourceHashes, projectRoot)) {
      entry.timestamp = now;
      return entry.rules;
    }

    // 缓存过期或文件已变 → 重新扫描
    const { rules, hashes } = this.scanAndMerge(projectRoot);
    this.cache.set(projectRoot, { rules, timestamp: now, sourceHashes: hashes });
    return rules;
  }

  /** 清除指定项目的缓存 */
  invalidate(projectRoot: string): void {
    this.cache.delete(projectRoot);
  }

  /** 清除所有缓存 */
  invalidateAll(): void {
    this.cache.clear();
  }

  // ── 内部实现 ──────────────────────────────────────────────

  private scanAndMerge(projectRoot: string): { rules: string; hashes: Map<string, string> } {
    const globalDir = path.join(os.homedir(), '.tcide');
    const parts: string[] = [];
    const hashes = new Map<string, string>();

    for (const target of SCAN_TARGETS) {
      const fullPath = target.scope === 'global'
        ? path.join(os.homedir(), target.relativePath)
        : path.join(projectRoot, target.relativePath);

      if (target.scope === 'global' && !fs.existsSync(globalDir)) {
        continue; // 全局目录不存在，跳过
      }

      try {
        if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
          // size limit: 50KB per file
          const stat = fs.statSync(fullPath);
          if (stat.size > 50 * 1024) continue;

          const content = fs.readFileSync(fullPath, 'utf-8').trim();
          if (content.length > 0) {
            parts.push(content);
            hashes.set(fullPath, hashContent(content));
          }
        }
      } catch {
        // 权限不足等，静默跳过
      }
    }

    const merged = parts.length > 0
      ? parts.join('\n\n')
      : BUILTIN_RULES;

    return { rules: merged, hashes };
  }

  /** 快速检查：所有源文件 hash 是否未变 */
  private sourceUnchanged(hashes: Map<string, string>, projectRoot: string): boolean {
    for (const [filePath, oldHash] of hashes) {
      try {
        if (!fs.existsSync(filePath)) return false; // 文件被删
        const content = fs.readFileSync(filePath, 'utf-8').trim();
        if (hashContent(content) !== oldHash) return false;
      } catch {
        return false;
      }
    }
    return true;
  }
}

// 全局单例
export const configManager = new ConfigManager();