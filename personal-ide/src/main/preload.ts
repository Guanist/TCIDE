/**
 * PersonalIDE - Preload Script
 * 在渲染进程和主进程之间建立安全的 IPC 桥梁
 * contextIsolation: true → 渲染进程只能通过暴露的 API 访问主进程
 */
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// ─────────────────────────────────────────
// 类型定义（与主进程共享）
// ─────────────────────────────────────────
export interface ProjectFile {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: ProjectFile[];
}

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

export interface ModelConfig {
  provider: 'deepseek' | 'huoshan' | 'ollama' | 'custom' | string;
  model: string;
  baseUrl: string;
  apiKey: string;
  builderModel?: string;
  coderModel?: string;
  api?: 'openai-compatible' | 'ollama' | 'anthropic';
}

export interface TestConnectionParams {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

export interface Task {
  id: string;
  desc: string;
  dep: string[];
  files: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  retries: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

// ─────────────────────────────────────────
// 暴露给渲染进程的 API
// ─────────────────────────────────────────
const api = {
  // ── 文件操作 ──
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('file:read', filePath),

  writeFile: (filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('file:write', filePath, content),

  deleteFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('file:delete', filePath),

  renameFile: (oldPath: string, newPath: string): Promise<void> =>
    ipcRenderer.invoke('file:rename', oldPath, newPath),

  createDirectory: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('file:mkdir', dirPath),

  readDirectory: (dirPath: string): Promise<FileTreeNode[]> =>
    ipcRenderer.invoke('file:readDir', dirPath),

  getFileStats: (filePath: string): Promise<{ size: number; mtime: number; isDirectory: boolean }> =>
    ipcRenderer.invoke('file:stats', filePath),

  // ── 项目操作 ──
  openProject: (): Promise<string | null> =>
    ipcRenderer.invoke('project:open'),

  openProjectPath: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('project:openPath', projectPath),

  getProjectPath: (): Promise<string | null> =>
    ipcRenderer.invoke('project:getPath'),

  // ── AI / 模型 ──
  sendToAI: (messages: ChatMessage[], options?: { model?: string; stream?: boolean }): Promise<string> =>
    ipcRenderer.invoke('ai:send', messages, options),

  sendToAIStream: (messages: ChatMessage[], options?: { model?: string }): Promise<void> =>
    ipcRenderer.invoke('ai:send-stream', messages, options),

  abortAI: (): void =>
    ipcRenderer.send('ai:abort'),

  getModelConfig: (): Promise<ModelConfig | null> =>
    ipcRenderer.invoke('model:getConfig'),

  saveModelConfig: (config: ModelConfig): Promise<void> =>
    ipcRenderer.invoke('model:saveConfig', config),

  testModelConnection: (params: TestConnectionParams): Promise<TestConnectionResult> =>
    ipcRenderer.invoke('model:testConnection', params),

  // ── 模型元数据 ──
  listModelMeta: (provider?: string): Promise<Array<{
    id: string; provider: string; name: string;
    contextWindow: number; maxTokens: number; reasoning: boolean;
    cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
    capabilities: string[]; supportsStreaming: boolean;
  }>> =>
    ipcRenderer.invoke('model:listMeta', provider),

  getModelMeta: (provider: string, modelId: string): Promise<{
    id: string; provider: string; name: string;
    contextWindow: number; maxTokens: number; reasoning: boolean;
    cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
    capabilities: string[]; supportsStreaming: boolean;
  } | null> =>
    ipcRenderer.invoke('model:getMeta', provider, modelId),

  // ── Builder / Coder ──
  runBuilder: (requirement: string, projectContext: object): Promise<Task[]> =>
    ipcRenderer.invoke('agent:builder', requirement, projectContext),

  runCoder: (task: Task, projectRoot: string): Promise<{ success: boolean; output: string }> =>
    ipcRenderer.invoke('agent:coder', task, projectRoot),

  // ── 任务运行器 ──
  runTaskLoop: (tasks: Task[], projectRoot: string): Promise<{ success: boolean; results: object[] }> =>
    ipcRenderer.invoke('task:runLoop', tasks, projectRoot),

  abortTaskLoop: (): void =>
    ipcRenderer.send('task:abortLoop'),

  // ── 终端 ──
  execCommand: (command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> =>
    ipcRenderer.invoke('terminal:exec', command, cwd),

  // ── 数据库（项目记忆） ──
  dbQuery: (sql: string, params?: unknown[]): Promise<unknown[]> =>
    ipcRenderer.invoke('db:query', sql, params),

  dbRun: (sql: string, params?: unknown[]): Promise<void> =>
    ipcRenderer.invoke('db:run', sql, params),

  // ── Token 用量统计 ──
  recordUsage: (rec: {
    timestamp: number;
    projectPath: string;
    projectName: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costRmb: number;
    durationMs: number;
    sessionId: string;
    taskId: string;
    role: string;
  }): Promise<void> =>
    ipcRenderer.invoke('usage:record', rec),

  getUsageToday: (): Promise<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costRmb: number;
    durationMs: number;
    requestCount: number;
  }> =>
    ipcRenderer.invoke('usage:getToday'),

  getUsageTotal: (): Promise<{
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costRmb: number;
    durationMs: number;
    requestCount: number;
    firstSeen: string;
    lastSeen: string;
  }> =>
    ipcRenderer.invoke('usage:getTotal'),

  getUsageByProject: (): Promise<Array<{
    projectPath: string;
    projectName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costRmb: number;
    durationMs: number;
    requestCount: number;
    lastUsed: string;
  }>> =>
    ipcRenderer.invoke('usage:getByProject'),

  getUsageByDate: (days?: number): Promise<Array<{
    date: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costRmb: number;
    durationMs: number;
    requestCount: number;
  }>> =>
    ipcRenderer.invoke('usage:getByDate', days || 30),

  // ── 余额不足警告（主进程 → 渲染进程） ──
  onBalanceWarning: (callback: (detail: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, detail: string) => callback(detail);
    ipcRenderer.on('usage:balance-warning', listener);
    return () => ipcRenderer.removeListener('usage:balance-warning', listener);
  },

  // ── 工程兼容 ──
  loadProjectCompat: (projectRoot: string): Promise<object> =>
    ipcRenderer.invoke('compat:load', projectRoot),

  saveProjectCompat: (projectRoot: string, data: object): Promise<void> =>
    ipcRenderer.invoke('compat:save', projectRoot, data),

  // ── 系统 ──
  getSettings: (): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:get'),

  saveSettings: (settings: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('settings:save', settings),

  showItemInFolder: (path: string): Promise<void> =>
    ipcRenderer.invoke('system:showInFolder', path),

  getClipboardText: (): Promise<string> =>
    ipcRenderer.invoke('system:getClipboardText'),

  // ── 文件快照（.ide-snapshots） ──
  saveSnapshot: (projectPath: string, taskId: string, filePath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('snapshot:save', projectPath, taskId, filePath, content),

  listSnapshots: (projectPath: string, filePath: string): Promise<Array<{ id: number; taskId: string; content: string; timestamp: number }>> =>
    ipcRenderer.invoke('snapshot:list', projectPath, filePath),

  restoreSnapshot: (id: number): Promise<void> =>
    ipcRenderer.invoke('snapshot:restore', id),

  // ── 任务会话（断点续做） ──
  saveTaskSession: (projectPath: string, tasksJson: string, currentIndex: number): Promise<void> =>
    ipcRenderer.invoke('taskSession:save', projectPath, tasksJson, currentIndex),

  getTaskSession: (projectPath: string): Promise<{ tasksJson: string; currentIndex: number; updatedAt: number } | null> =>
    ipcRenderer.invoke('taskSession:get', projectPath),

  clearTaskSession: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('taskSession:clear', projectPath),

  // ── Git 集成 ──
  getGitBranch: (projectPath: string): Promise<{ branch: string | null; success: boolean }> =>
    ipcRenderer.invoke('git:getBranch', projectPath),

  // ── AI 行为规则（CLAUDE.md） ──
  getProjectRules: (projectPath: string): Promise<string> =>
    ipcRenderer.invoke('config:getRules', projectPath),

  setProjectRules: (rules: string): Promise<void> =>
    ipcRenderer.invoke('config:setRules', rules),

  // ── AI 实时代码补全 ──
  aiComplete: (context: string, language: string): Promise<string> =>
    ipcRenderer.invoke('ai:complete', context, language),

  getGitUser: (projectPath: string): Promise<{ name: string | null; email: string | null }> =>
    ipcRenderer.invoke('git:getUser', projectPath),

  // ── Gradle 快捷操作 ──
  gradleExec: (projectPath: string, task: string): Promise<{ output: string; exitCode: number }> =>
    ipcRenderer.invoke('gradle:exec', projectPath, task),

  // ── 附件上传 ──
  openFileDialog: (): Promise<Array<{ name: string; path: string; size: number; mtime: number }>> =>
    ipcRenderer.invoke('dialog:openFiles'),

  readTextFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('file:readText', filePath),

  // ── 事件监听 ──
  on: (channel: string, callback: (event: IpcRendererEvent, ...args: unknown[]) => void): void => {
    const validChannels = [
      'project-opened',
      'menu-action',
      'ai-stream-chunk',
      'ai-stream-end',
      'ai-stream-error',
      'task-progress',
      'task-complete',
      'memory-cleanup',
      'usage:balance-warning',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  off: (channel: string, callback: (event: IpcRendererEvent, ...args: unknown[]) => void): void => {
    ipcRenderer.removeListener(channel, callback);
  },

  // ── 安全存储 ──
  encrypt: (plainText: string): Promise<string> =>
    ipcRenderer.invoke('crypto:encrypt', plainText),

  decrypt: (encrypted: string): Promise<string> =>
    ipcRenderer.invoke('crypto:decrypt', encrypted),
};

contextBridge.exposeInMainWorld('api', api);

// 声明全局类型，供渲染进程 TypeScript 使用
declare global {
  interface Window {
    api: typeof api;
  }
}
