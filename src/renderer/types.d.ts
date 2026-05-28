/**
 * TCIDE Renderer Type Declarations
 * 补充 window.api 等运行时类型的静态声明
 */

type ApiProtocol = 'openai-compatible' | 'ollama' | 'anthropic';

interface ModelMeta {
  id: string;
  provider: string;
  name: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  cost: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  capabilities: string[];
  supportsStreaming: boolean;
}

interface ModelConfig {
  provider: 'deepseek' | 'huoshan' | 'ollama' | 'custom' | string;
  model: string;
  baseUrl: string;
  apiKey: string;
  builderModel?: string;
  coderModel?: string;
  api?: ApiProtocol;
}

interface TestConnectionParams {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface TestConnectionResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

interface UsageRecord {
  timestamp: number;
  projectPath: string;
  projectName: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costRmb: number;
  durationMs: number;
  sessionId?: string;
  taskId?: string;
  role?: string;
}

// ── 用量统计返回类型（匹配 IPC handler 实际返回） ──
interface UsageToday {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costRmb: number;
  durationMs: number;
  requestCount: number;
}

interface UsageTotal {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costRmb: number;
  durationMs: number;
  requestCount: number;
  firstSeen: string;
  lastSeen: string;
}

interface UsageByProject {
  projectPath: string;
  projectName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costRmb: number;
  durationMs: number;
  requestCount: number;
  lastUsed: string;
}

interface UsageByDate {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costRmb: number;
  durationMs: number;
  requestCount: number;
}

interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: FileTreeNode[];
}

interface TcIdeApi {
  // ── 模型配置 ──
  getModelConfig(): Promise<ModelConfig | null>;
  saveModelConfig(config: ModelConfig): Promise<void>;
  testModelConnection(params: TestConnectionParams): Promise<TestConnectionResult>;

  // ── 模型元数据 ──
  listModelMeta(provider?: string): Promise<ModelMeta[]>;
  getModelMeta(provider: string, modelId: string): Promise<ModelMeta | null>;

  // ── 用量统计 ──
  recordUsage(record: UsageRecord): Promise<void>;
  getUsageToday(): Promise<UsageToday>;
  getUsageTotal(): Promise<UsageTotal>;
  getUsageByProject(): Promise<UsageByProject[]>;
  getUsageByDate(days?: number): Promise<UsageByDate[]>;

  // ── AI 对话 ──
  sendToAI(messages: Array<{ role: string; content: string }>, options?: { model?: string; stream?: boolean }): Promise<string>;
  sendToAIStream(messages: Array<{ role: string; content: string }>, options?: { model?: string }): Promise<void>;
  abortAI(): void;
  abortTask(): void;

  // ── Builder / Coder ──
  runBuilder(requirement: string, options?: { projectPath?: string }): Promise<Array<{ id: string; desc: string; dep: string[]; files: string[]; status: string; retries: number }>>;
  runCoder(task: Record<string, unknown>, projectRoot: string): Promise<{ success: boolean; output: string }>;

  // ── 文件操作 ──
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  deleteFile(filePath: string): Promise<void>;
  readDirectory(dirPath: string): Promise<FileTreeNode[]>;
  readDir(path: string): Promise<FileTreeNode[]>;

  // ── 项目 ──
  openProject(): Promise<string | null>;
  openProjectPath(projectPath: string): Promise<void>;
  getProjectPath(): Promise<string | null>;

  // ── 终端 ──
  execCommand(command: string, cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;

  // ── 文件快照 & 任务会话 ──
  saveSnapshot(projectPath: string, taskId: string, filePath: string, content: string): Promise<void>;
  listSnapshots(projectPath: string, filePath: string): Promise<Array<{ id: number; taskId: string; content: string; timestamp: number }>>;
  restoreSnapshot(id: number): Promise<void>;
  saveTaskSession(projectPath: string, tasksJson: string, currentIndex: number): Promise<void>;
  getTaskSession(projectPath: string): Promise<{ tasksJson: string; currentIndex: number; updatedAt: number } | null>;
  clearTaskSession(projectPath: string): Promise<void>;

  // ── Git ──
  getGitBranch(projectPath: string): Promise<{ branch: string | null; success: boolean }>;
  getGitUser(projectPath: string): Promise<{ name: string | null; email: string | null }>;

  // ── AI 行为规则 ──
  getProjectRules(projectPath: string): Promise<string>;
  setProjectRules(rules: string): Promise<void>;

  // ── AI 代码补全 ──
  aiComplete(context: string, language: string): Promise<string>;

  // ── Gradle ──
  gradleExec(projectPath: string, task: string): Promise<{ output: string; exitCode: number }>;

  // ── 附件上传 ──
  openFileDialog(): Promise<Array<{ name: string; path: string; size: number; mtime: number }>>;
  readTextFile(filePath: string): Promise<string>;
  readFileAsDataURL(filePath: string): Promise<string>;
  readDocxText(filePath: string): Promise<string>;
  readPdfDataUrl(filePath: string): Promise<string>;

  // ── 文件/目录操作 ──
  createDir(dirPath: string): Promise<void>;

  // ── 配置导入/导出 ──
  exportConfig(): Promise<{ success: boolean; path?: string }>;
  importConfig(): Promise<Record<string, unknown> | null>;

  // ── 工程兼容 ──
  loadProjectCompat(projectPath: string): Promise<Record<string, unknown>>;
  saveProjectCompat(projectPath: string, data: Record<string, unknown>): Promise<void>;

  // ── 设置 & 系统 ──
  getSettings(): Promise<Record<string, unknown>>;
  saveSettings(settings: Record<string, unknown>): Promise<void>;
  showItemInFolder(path: string): Promise<void>;
  getClipboardText(): Promise<string>;
  encrypt(plainText: string): Promise<string>;
  decrypt(encrypted: string): Promise<string>;

  // ── 项目搜索 ──
  searchInProject(projectPath: string, query: string): Promise<Array<{ file: string; line: number; text: string }>>;

  // ── 最近项目 ──
  getRecentProjects(): Promise<Array<{ path: string; name: string; lastOpened: number }>>;
  addRecentProject(projectPath: string): Promise<Array<{ path: string; name: string; lastOpened: number }>>;

  // ── 事件 ──
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  onBalanceWarning?(callback: (detail: string) => void): () => void;
}

declare interface Window {
  api: TcIdeApi;
}
