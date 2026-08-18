/**
 * TCIDE MCP Tools — 内置工具注册 & 执行
 *
 * 工具供 AI 助手通过 function calling 调用，
 * 在聊天中自动读写文件、搜索代码、执行 Git 操作等。
 */

import { execSync } from 'child_process';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// ── 类型定义 ──

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

// 扩展工具定义：标记来源，便于路由
export interface McpToolDef extends ToolDef {
  _source: 'builtin' | 'mcp';
  _server?: string; // 外部 MCP server 名
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

// ── 外部 MCP Server 连接层 ──

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerConfig>;
}

interface McpClientState {
  name: string;
  config: McpServerConfig;
  proc: ChildProcess;
  projectPath: string;
  buffer: Buffer;
  nextId: number;
  ready: boolean;
  pending: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>;
  tools: McpToolDef[];
}

const mcpClients: Map<string, McpClientState> = new Map();

/** 解析一行 LSP/MCP 风格的 Content-Length 帧，返回完成的消息体数组
 * 注意：Content-Length 以 UTF-8 字节计，因此缓冲区必须用 Buffer 累积，不能用 string */
function parseFrames(state: McpClientState, chunk: Buffer): any[] {
  state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  const out: any[] = [];
  while (true) {
    const sep = state.buffer.indexOf('\r\n\r\n');
    if (sep === -1) break;
    const header = state.buffer.slice(0, sep).toString('utf-8');
    const m = header.match(/Content-Length:\s*(\d+)/i);
    if (!m) { state.buffer = state.buffer.slice(sep + 4); continue; }
    const len = parseInt(m[1], 10);
    const bodyStart = sep + 4;
    if (state.buffer.length < bodyStart + len) break;
    const body = state.buffer.slice(bodyStart, bodyStart + len).toString('utf-8');
    state.buffer = state.buffer.slice(bodyStart + len);
    try { out.push(JSON.parse(body)); } catch { /* 跳过坏帧 */ }
  }
  return out;
}

function sendRpc(state: McpClientState, method: string, params: unknown, isNotification = false): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = isNotification ? undefined : state.nextId++;
    if (id !== undefined) state.pending.set(id, { resolve, reject });
    const msg = JSON.stringify({ jsonrpc: '2.0', ...(id !== undefined ? { id } : {}), method, params });
    const payload = `Content-Length: ${Buffer.byteLength(msg, 'utf-8')}\r\n\r\n${msg}`;
    try { state.proc.stdin?.write(payload); } catch (e: any) {
      if (id !== undefined) { state.pending.delete(id); reject(e); }
    }
    if (isNotification) resolve(undefined);
    if (id !== undefined) {
      setTimeout(() => {
        if (state.pending.has(id)) { state.pending.delete(id); reject(new Error(`MCP ${method} 超时`)); }
      }, 30000);
    }
  });
}

/** 连接一个外部 MCP server（stdio transport） */
export async function connectMcpServer(name: string, config: McpServerConfig, projectPath: string): Promise<void> {
  if (mcpClients.has(name)) await disconnectMcpServer(name);
  const fullEnv = { ...process.env, ...(config.env || {}) };
  const proc = spawn(config.command, config.args || [], {
    cwd: projectPath,
    env: fullEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const state: McpClientState = {
    name, config, proc, projectPath,
    buffer: Buffer.alloc(0), nextId: 1, ready: false, pending: new Map(), tools: [],
  };
  mcpClients.set(name, state);

  proc.on('error', (err) => console.error(`[MCP:${name}] 进程错误:`, err.message));
  proc.on('exit', (code) => {
    console.log(`[MCP:${name}] 退出 code=${code}`);
    mcpClients.delete(name);
  });
  proc.stderr?.on('data', (d) => console.error(`[MCP:${name}:stderr]`, d.toString().trim()));
  proc.stdout?.on('data', (chunk: Buffer) => {
    const msgs = parseFrames(state, chunk);
    for (const msg of msgs) {
      if (msg.id !== undefined && msg.id !== null) {
        const p = state.pending.get(msg.id);
        if (p) { state.pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); }
      }
    }
  });

  await sendRpc(state, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    clientInfo: { name: 'TCIDE', version: '0.0.1' },
  });
  await sendRpc(state, 'notifications/initialized', {}, true);
  const listRes: any = await sendRpc(state, 'tools/list', {});
  state.tools = (listRes?.tools || []).map((t: any) => ({
    name: `${name}__${t.name}`,
    description: `[MCP:${name}] ${t.description || ''}`,
    parameters: t.inputSchema || { type: 'object', properties: {} },
    _source: 'mcp' as const,
    _server: name,
  }));
  state.ready = true;
  console.log(`[MCP:${name}] 已连接，提供 ${state.tools.length} 个工具`);
}

/** 断开一个 MCP server */
export async function disconnectMcpServer(name: string): Promise<void> {
  const state = mcpClients.get(name);
  if (!state) return;
  try { await sendRpc(state, 'shutdown', {}, true); state.proc.stdin?.end(); } catch { /* ignore */ }
  try { state.proc.kill(); } catch { /* ignore */ }
  mcpClients.delete(name);
}

/** 断开全部 */
export function disconnectAllMcp(): void {
  for (const name of [...mcpClients.keys()]) {
    try { disconnectMcpServer(name); } catch { /* ignore */ }
  }
}

/** 列出所有已连外部 server 的工具（带来源标记） */
export function listExternalTools(): McpToolDef[] {
  const out: McpToolDef[] = [];
  for (const state of mcpClients.values()) out.push(...state.tools);
  return out;
}

/** 列出已配置的外部 server 名 */
export function listConnectedServers(): string[] {
  return [...mcpClients.keys()];
}

/** 调用外部 MCP 工具。call.name 形如 `${server}__${tool}` */
export async function callExternalTool(call: ToolCall): Promise<ToolResult> {
  const sepIdx = call.name.indexOf('__');
  if (sepIdx === -1) return { id: call.id, result: '', error: '非外部 MCP 工具' };
  const server = call.name.slice(0, sepIdx);
  const tool = call.name.slice(sepIdx + 2);
  const state = mcpClients.get(server);
  if (!state) return { id: call.id, result: '', error: `MCP server 未连接: ${server}` };
  try {
    const res: any = await sendRpc(state, 'tools/call', { name: tool, arguments: call.arguments || {} });
    const text = Array.isArray(res?.content)
      ? res.content.map((c: any) => c.text || c.resource?.text || JSON.stringify(c)).join('\n')
      : JSON.stringify(res);
    return { id: call.id, result: truncate(text, 8000) };
  } catch (err: any) {
    return { id: call.id, result: '', error: err.message };
  }
}

/** 从项目配置加载 MCP server 并连接 */
export async function loadMcpServers(projectPath: string): Promise<string[]> {
  let cfg: McpConfigFile = {};
  const candidates = [
    path.join(projectPath, '.tcide', 'mcp.json'),
    path.join(projectPath, 'mcp.json'),
    path.join(process.env.APPDATA || '', '虎猫 TCIDE', 'mcp.json'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) { cfg = JSON.parse(fs.readFileSync(c, 'utf-8')); break; } } catch { /* 跳过损坏 */ }
  }
  const servers = cfg.mcpServers || {};
  const connected: string[] = [];
  for (const [name, config] of Object.entries(servers)) {
    try { await connectMcpServer(name, config, projectPath); connected.push(name); }
    catch (e: any) { console.error(`[MCP] 连接 ${name} 失败:`, e.message); }
  }
  return connected;
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

/** 获取所有可用工具定义（内置 + 已连外部 MCP） */
export function listTools(): McpToolDef[] {
  const builtin: McpToolDef[] = BUILTIN_TOOLS.map((t) => ({ ...t, _source: 'builtin' as const }));
  return [...builtin, ...listExternalTools()];
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

  switch (call.name) {
    case 'read_file': {
      const filePath = path.resolve(projectPath, (args.path as string) || '');
      if (!filePath.startsWith(projectPath)) throw new Error('路径必须在项目目录内');
      if (!fs.existsSync(filePath)) throw new Error(`文件不存在: ${args.path}`);
      let content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      const start = Math.max(0, ((args.start_line as number) || 1) - 1);
      const end = Math.min(lines.length, (args.end_line as number) || lines.length);
      return lines.slice(start, end).map((l, i) => `${start + i + 1}: ${l}`).join('\n');
    }

    case 'write_file': {
      const filePath = path.resolve(projectPath, (args.path as string) || '');
      if (!filePath.startsWith(projectPath)) throw new Error('路径必须在项目目录内');
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, args.content as string, 'utf-8');
      return `文件已写入: ${args.path} (${(args.content as string).length} 字符)`;
    }

    case 'list_files': {
      const dirPath = path.resolve(projectPath, (args.path as string) || '.');
      const depth = Math.min(3, Math.max(1, (args.depth as number) || 1));
      if (!dirPath.startsWith(projectPath)) throw new Error('路径必须在项目目录内');
      return listDir(dirPath, depth, projectPath);
    }

    case 'search_code': {
      const query = args.query as string;
      const filePattern = (args.file_pattern as string) || '*';
      const maxResults = Math.min(50, (args.max_results as number) || 20);
      return searchInProject(projectPath, query, filePattern, maxResults);
    }

    case 'run_command': {
      const cmd = args.command as string;
      try {
        const output = execSync(cmd, { cwd: projectPath, timeout: 15000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return output.slice(0, 4000);
      } catch (err: any) {
        return `命令执行失败 (exit ${err.status}):\n${err.stderr || err.message}`.slice(0, 2000);
      }
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
        const output = execSync('git status --short', { cwd: projectPath, timeout: 5000, encoding: 'utf-8' });
        return output || '工作区干净';
      } catch (err: any) {
        return `Git 错误: ${err.message}`;
      }
    }

    case 'git_diff': {
      const filePath = (args.file_path as string) || '';
      try {
        const output = filePath
          ? execSync(`git diff HEAD -- "${filePath}"`, { cwd: projectPath, timeout: 5000, encoding: 'utf-8' })
          : execSync('git diff HEAD', { cwd: projectPath, timeout: 10000, encoding: 'utf-8' });
        return output || '无变更';
      } catch (err: any) {
        return `Git diff 错误: ${err.message}`;
      }
    }

    default:
      // 路由到外部 MCP server
      if (call.name.includes('__')) {
        const ext = await callExternalTool(call);
        if (ext.error) throw new Error(ext.error);
        return ext.result;
      }
      throw new Error(`未知工具: ${call.name}`);
  }
}

// ── 辅助函数 ──

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
  // 使用 git grep 或 findstr
  try {
    const isWin = process.platform === 'win32';
    let cmd: string;
    if (isWin) {
      const escapedQuery = query.replace(/"/g, '\\"');
      cmd = `findstr /s /i /n /c:"${escapedQuery}" "${filePattern}" 2>nul`;
    } else {
      const escapedQuery = query.replace(/'/g, "'\\''");
      cmd = `grep -rn --include="${filePattern}" "${escapedQuery}" . 2>/dev/null`;
    }

    const output = execSync(cmd, { cwd: projectPath, timeout: 8000, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    const lines = output.split('\n').filter(l => l.trim());
    const result = lines.slice(0, maxResults).join('\n');
    return result || '未找到匹配结果';
  } catch (err: any) {
    if (err.status === 1) return '未找到匹配结果'; // grep returns 1 when no matches
    return `搜索失败: ${err.message}`;
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... (截断, 共 ${text.length} 字符)`;
}
