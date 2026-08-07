/**
 * TCIDE MCP Tools — 内置工具注册 & 执行
 *
 * 工具供 AI 助手通过 function calling 调用，
 * 在聊天中自动读写文件、搜索代码、执行 Git 操作等。
 */

import { execFileSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { isAllowedPath } from './file-service';

// ── 类型定义 ──

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  result: string;
  error?: string;
}

// ── 工具注册表 ──

const BUILTIN_TOOLS: ToolDef[] = [
  {
    name: 'read_file',
    description: '读取项目中的文件内容。仅限项目目录内的文件。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        start_line: { type: 'number', description: '起始行号（可选）' },
        end_line: { type: 'number', description: '结束行号（可选）' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: '写入或创建文件。会自动创建父目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '文件路径（相对于项目根目录）' },
        content: { type: 'string', description: '文件内容' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'list_files',
    description: '列出目录中的文件和子目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '目录路径（相对于项目根目录，默认项目根）' },
        depth: { type: 'number', description: '递归深度（1-3）' },
      },
    },
  },
  {
    name: 'search_code',
    description: '在项目中搜索代码（grep）。返回匹配的文件和行。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词或正则表达式' },
        file_pattern: { type: 'string', description: '文件名匹配模式，如 *.ts' },
        max_results: { type: 'number', description: '最大结果数（默认 20）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'run_command',
    description: '在终端中执行命令（仅限项目目录）。超时 15 秒。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的命令' },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_diagnostics',
    description: '获取当前文件的代码诊断信息（错误、警告）。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径（可选，默认当前打开文件）' },
      },
    },
  },
  {
    name: 'get_open_files',
    description: '获取当前在编辑器中打开的所有文件列表。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'git_status',
    description: '获取 Git 工作区状态（变更文件列表）。',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'git_diff',
    description: '获取文件的 Git 差异。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文件路径（相对于项目根）' },
      },
    },
  },
];

// ── 工具执行器 ──

/** 获取所有可用工具定义 */
export function listTools(): ToolDef[] {
  return BUILTIN_TOOLS;
}

/** 执行工具调用 */
export async function executeTool(call: ToolCall, projectPath: string, extraContext?: {
  openFiles?: Array<{ path: string; name: string; language: string }>;
}): Promise<ToolResult> {
  try {
    const result = await executeToolImpl(call, projectPath, extraContext);
    return { id: call.id, result: truncate(result, 8000) };
  } catch (err: any) {
    return { id: call.id, result: '', error: err.message };
  }
}

async function executeToolImpl(call: ToolCall, projectPath: string, extraContext?: any): Promise<string> {
  const args = call.arguments || {};

  if (!isAllowedPath(projectPath)) throw new Error('项目路径不在允许范围内');

  switch (call.name) {
    case 'read_file': {
      const filePath = path.resolve(projectPath, (args.path as string) || '');
      if (!isInside(projectPath, filePath)) throw new Error('路径必须在项目目录内');
      if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${args.path}`);
      let content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, ((args.start_line as number) || 1) - 1);
      const end = Math.min(lines.length, (args.end_line as number) || lines.length);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    }

    case 'write_file': {
      const filePath = path.resolve(projectPath, (args.path as string) || '');
      if (!isInside(projectPath, filePath)) throw new Error('路径必须在项目目录内');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, args.content as string, 'utf-8');
      return `文件已写入: ${args.path} (${(args.content as string).length} 字符)`;
    }

    case 'list_files': {
      const dirPath = path.resolve(projectPath, (args.path as string) || '.');
      const depth = Math.min(3, Math.max(1, (args.depth as number) || 1));
      if (!isInside(projectPath, dirPath)) throw new Error('路径必须在项目目录内');
      return listDir(dirPath, depth, projectPath);
    }

    case 'search_code': {
      const query = args.query as string;
      const filePattern = (args.file_pattern as string) || '*';
      const maxResults = Math.min(50, (args.max_results as number) || 20);
      return searchInProject(projectPath, query, filePattern, maxResults);
    }

    case 'run_command': {
      const cmd = (args.command as string) || '';
      // 安全策略：仅允许构建/测试类命令，且禁止 shell 元字符拼接
      const allowedPrefixes = [
        'npm run ', 'npm test', 'npm install', 'npm ci', 'npm exec', 'npx ',
        'yarn ', 'pnpm ', 'gradlew', 'gradle ', 'mvn ', 'make ', 'cmake ',
        'python ', 'python3 ', 'node ',
        'git status', 'git diff', 'git log', 'git branch', 'git fetch', 'git pull',
      ];
      const trimmed = cmd.trim();
      const allowed = allowedPrefixes.some(p => trimmed.startsWith(p));
      const hasMeta = /[&|;<>`$(){}[\]%!"]/.test(trimmed);
      if (!allowed || hasMeta) {
        return '命令被安全策略拦截：仅允许构建/测试类命令（npm/npx/yarn/pnpm/gradle/mvn/make/cmake/python/node/git 只读操作），且不允许 shell 元字符';
      }
      return new Promise<string>((resolve) => {
        const isWin = process.platform === 'win32';
        let proc: any;
        if (isWin) {
          // npm/npx/gradlew 等是 .cmd 包装器，需经 cmd.exe 执行（命令已过白名单+元字符过滤）
          proc = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', trimmed], { cwd: projectPath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        } else {
          const parts = trimmed.split(/\s+/);
          proc = spawn(parts[0], parts.slice(1), { cwd: projectPath, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        }
        let output = '';
        let stderr = '';
        proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
        proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
        const timer = setTimeout(() => { try { proc.kill(); } catch { /* ignore */ } }, 15000);
        proc.on('close', (code: number) => {
          clearTimeout(timer);
          const text = (output + (stderr ? '\n' + stderr : '')).slice(0, 4000);
          resolve(code === 0 ? text : `命令执行失败 (exit ${code}):\n${text}`.slice(0, 2000));
        });
        proc.on('error', (err: Error) => { clearTimeout(timer); resolve(`命令执行失败: ${err.message}`.slice(0, 2000)); });
      });
    }

    case 'get_diagnostics': {
      // 诊断信息由渲染进程提供，这里返回占位
      return extraContext ? JSON.stringify({ message: '诊断信息在编辑器中查看 (Ctrl+Shift+D)' }) : '{}';
    }

    case 'get_open_files': {
      if (extraContext?.openFiles) {
        return extraContext.openFiles.map((f: any) => `${f.name} (${f.language})`).join('\n');
      }
      return '无打开文件';
    }

    case 'git_status': {
      try {
        const output = execFileSync('git', ['status', '--short'], { cwd: projectPath, timeout: 5000, encoding: 'utf-8' });
        return output || '工作区干净';
      } catch (err: any) {
        return `Git 错误: ${err.message}`;
      }
    }

    case 'git_diff': {
      const filePath = (args.file_path as string) || '';
      if (filePath && !isInside(projectPath, path.resolve(projectPath, filePath))) {
        throw new Error('路径必须在项目目录内');
      }
      try {
        const output = filePath
          ? execFileSync('git', ['diff', 'HEAD', '--', filePath], { cwd: projectPath, timeout: 5000, encoding: 'utf-8' })
          : execFileSync('git', ['diff', 'HEAD'], { cwd: projectPath, timeout: 10000, encoding: 'utf-8' });
        return output || '无变更';
      } catch (err: any) {
        return `Git diff 错误: ${err.message}`;
      }
    }

    default:
      throw new Error(`未知工具: ${call.name}`);
  }
}

// ── 辅助函数 ──

/** 判断 target 是否位于 root 目录内（防前缀攻击：/project/evil） */
function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function listDir(dirPath: string, depth: number, projectRoot: string): string {
  if (depth < 1) return '';
  if (!fs.existsSync(dirPath)) return `目录不存在: ${path.relative(projectRoot, dirPath)}`;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const lines: string[] = [];
  const maxEntries = 100;

  for (let i = 0; i < Math.min(entries.length, maxEntries); i++) {
    const e = entries[i];
    const relPath = path.relative(projectRoot, path.join(dirPath, e.name));
    const prefix = e.isDirectory() ? '📁' : '📄';
    // 跳过 .git, node_modules, __pycache__
    if (['.git', 'node_modules', '__pycache__', '.venv', 'dist', '.next'].includes(e.name)) continue;
    lines.push(`${prefix} ${relPath}`);
    if (e.isDirectory() && depth > 1) {
      const sub = listDir(path.join(dirPath, e.name), depth - 1, projectRoot);
      if (sub) lines.push(sub);
    }
  }

  if (entries.length > maxEntries) lines.push(`... 还有 ${entries.length - maxEntries} 个条目`);
  return lines.join('\n');
}

function searchInProject(projectPath: string, query: string, filePattern: string, maxResults: number): string {
  // 纯 Node 递归扫描，避免 findstr/grep 命令注入
  const results: Array<{ file: string; line: number; text: string }> = [];
  const maxFileSize = 1 * 1024 * 1024; // 单文件上限 1MB
  const skipDirs = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'dist', '.next', '.idea', '.vscode', 'build', '.gradle', 'target']);
  const q = String(query || '').toLowerCase();
  if (!q) return '未找到匹配结果';

  function walk(dir: string): void {
    if (results.length >= maxResults) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= maxResults) return;
      if (skipDirs.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile()) {
        if (filePattern !== '*' && !wildcardMatch(filePattern, e.name)) continue;
        try {
          const stat = fs.statSync(full);
          if (stat.size > maxFileSize) continue;
          const lines = fs.readFileSync(full, 'utf-8').split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(q)) {
              results.push({ file: path.relative(projectPath, full), line: i + 1, text: lines[i].trim().slice(0, 120) });
              if (results.length >= maxResults) return;
            }
          }
        } catch {
          // 忽略无法读取的文件
        }
      }
    }
  }

  walk(projectPath);
  if (results.length === 0) return '未找到匹配结果';
  return results.map(r => `${r.file}:${r.line}: ${r.text}`).join('\n');
}

function wildcardMatch(pattern: string, name: string): boolean {
  let re = '';
  for (const ch of pattern) {
    if (ch === '*') re += '.*';
    else if (ch === '?') re += '.';
    else if ('\\^$.|+()[{'.includes(ch)) re += '\\' + ch;
    else re += ch;
  }
  return new RegExp('^' + re + '$', 'i').test(name);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... (截断, 共 ${text.length} 字符)`;
}
