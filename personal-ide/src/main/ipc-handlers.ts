/**
 * PersonalIDE - IPC Handlers
 */
import { ipcMain, dialog, safeStorage, BrowserWindow } from 'electron';
import { FileService } from './file-service';
import { ModelAdapter, ModelConfig } from '../core/model/adapter';
import { modelRegistry } from '../core/model/model-meta';
import { BuilderAgent } from '../core/agent/builder-agent';
import { CoderAgent } from '../core/agent/coder-agent';
import { saveSnapshot, getSnapshots, markSnapshotRestored, saveTaskSession, getTaskSession, clearTaskSession } from './db/sqlite';
import { TaskRunner } from '../core/task/task-runner';
import { configManager } from '../core/config/config-manager';
import { ProjectCompatManager } from '../core/compat/project-compat';
import { queryDb, runDb, insertUsage, queryUsage } from './db/sqlite';
import { getStore } from './store';

let currentAbortController: AbortController | null = null;
let currentProjectPath: string | null = null;
let projectRules: string = '';
const fileService = new FileService();

function getModelConfig(): ModelConfig {
  const store = getStore() as unknown as Record<string, unknown>;
  const saved = store['modelConfig'] as ModelConfig | undefined;
  if (saved) {
    // 解密存储的 API Key
    const config = { ...saved };
    if (config.apiKey && safeStorage.isEncryptionAvailable()) {
      try {
        config.apiKey = safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'));
      } catch {
        // 旧版明文 Key，保持原值
      }
    }
    return config;
  }
  return {
    provider: 'deepseek',
    model: 'deepseek-v4-pro',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    builderModel: 'deepseek-reasoner',
    coderModel: 'deepseek-v4-pro',
  };
}

/** 创建 Adapter 并注入用量记录回调（主进程直写 SQLite，不走 IPC） */
function createAdapterWithUsage(config: ModelConfig): ModelAdapter {
  const adapter = new ModelAdapter(config);
  adapter.onUsage = (rec) => {
    insertUsageRecord(rec);
  };
  return adapter;
}

/** 用量记录写入（主进程直接调 SQLite） */
function insertUsageRecord(rec: {
  timestamp: number; projectPath: string; projectName: string;
  model: string; provider: string; inputTokens: number;
  outputTokens: number; costRmb: number; durationMs: number;
  sessionId: string; taskId: string; role: string;
}): void {
  try {
    insertUsage({
      timestamp: rec.timestamp,
      projectPath: rec.projectPath,
      projectName: rec.projectName,
      model: rec.model,
      provider: rec.provider,
      inputTokens: rec.inputTokens,
      outputTokens: rec.outputTokens,
      costRmb: rec.costRmb,
      durationMs: rec.durationMs,
      sessionId: rec.sessionId,
      taskId: rec.taskId,
      role: rec.role,
    });
  } catch (err) {
    console.error('[IPC] 用量记录失败:', err);
  }
}

export function setupIpcHandlers(): void {
  // 文件操作
  ipcMain.handle('file:read', async (_e, filePath: string) => fileService.read(filePath));
  ipcMain.handle('file:write', async (_e, filePath: string, content: string) => fileService.write(filePath, content));
  ipcMain.handle('file:delete', async (_e, filePath: string) => fileService.delete(filePath));
  ipcMain.handle('file:rename', async (_e, oldPath: string, newPath: string) => fileService.rename(oldPath, newPath));
  ipcMain.handle('file:mkdir', async (_e, dirPath: string) => fileService.mkdir(dirPath));
  ipcMain.handle('file:readDir', async (_e, dirPath: string) => fileService.readDir(dirPath));
  ipcMain.handle('file:stats', async (_e, filePath: string) => fileService.stats(filePath));

  // 项目
  ipcMain.handle('project:open', async (event) => {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender)!, {
      properties: ['openDirectory'],
      title: '选择项目目录',
    });
    if (!result.canceled && result.filePaths[0]) {
      currentProjectPath = result.filePaths[0];
      return currentProjectPath;
    }
    return null;
  });

  ipcMain.handle('project:openPath', async (_e, projectPath: string) => {
    const fs = await import('fs');
    if (fs.existsSync(projectPath)) { currentProjectPath = projectPath; return; }
    throw new Error(`项目路径不存在: ${projectPath}`);
  });

  ipcMain.handle('project:getPath', async () => currentProjectPath);

  // AI 发送（非流式）
  ipcMain.handle('ai:send', async (_e, messages, options) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    return adapter.send(messages as Array<{ role: string; content: string }>, { ...options, stream: false });
  });

  // AI 发送（流式）
  ipcMain.handle('ai:send-stream', async (event, messages, options) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    currentAbortController = new AbortController();
    const window = BrowserWindow.fromWebContents(event.sender)!;
    try {
      await adapter.send(messages as Array<{ role: string; content: string }>, {
        ...options,
        stream: true,
        onChunk: (chunk: string) => { if (!window.isDestroyed()) window.webContents.send('ai-stream-chunk', chunk); },
        signal: currentAbortController.signal,
      });
      if (!window.isDestroyed()) window.webContents.send('ai-stream-end', '');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!window.isDestroyed()) window.webContents.send('ai-stream-error', msg);
    }
  });

  ipcMain.on('ai:abort', () => { currentAbortController?.abort(); });

  // 模型配置
  ipcMain.handle('model:getConfig', async () => getModelConfig());

  ipcMain.handle('model:saveConfig', async (_e, config: ModelConfig) => {
    const store = getStore() as unknown as Record<string, unknown>;
    // 🔐 加密存储 API Key（safeStorage 不可用时保持明文）
    const toSave = { ...config };
    if (toSave.apiKey && safeStorage.isEncryptionAvailable()) {
      toSave.apiKey = safeStorage.encryptString(toSave.apiKey).toString('base64');
    }
    store['modelConfig'] = toSave;
  });

  ipcMain.handle('model:testConnection', async (_e, params: { provider: string; baseUrl: string; apiKey: string; model: string }) => {
    const config: ModelConfig = {
      provider: params.provider as ModelConfig['provider'],
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
    };
    const adapter = new ModelAdapter(config);
    return adapter.testConnection();
  });

  // 模型元数据查询
  ipcMain.handle('model:listMeta', async (_e, provider?: string) => {
    if (provider && provider !== 'all') {
      return modelRegistry.listByProvider(provider);
    }
    return modelRegistry.listAll();
  });

  ipcMain.handle('model:getMeta', async (_e, provider: string, modelId: string) => {
    return modelRegistry.lookup(provider, modelId) ?? modelRegistry.lookupById(modelId);
  });

  // Builder
  ipcMain.handle('agent:builder', async (_e, requirement: string, projectContext: object) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    const builder = new BuilderAgent(adapter);
    return builder.run(requirement, projectContext);
  });

  // Coder
  ipcMain.handle('agent:coder', async (_e, task, projectRoot: string) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    const coder = new CoderAgent(adapter, fileService);
    return coder.run(task as Parameters<typeof coder.run>[0], projectRoot);
  });

  // TaskRunner
  ipcMain.handle('task:runLoop', async (event, tasks, projectRoot: string) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    const runner = new TaskRunner(adapter, fileService, (progress) => {
      const window = BrowserWindow.fromWebContents(event.sender)!;
      if (!window.isDestroyed()) window.webContents.send('task-progress', progress);
    });
    return runner.run(tasks as Parameters<typeof runner.run>[0], projectRoot);
  });

  // 终端命令
  ipcMain.handle('terminal:exec', async (_e, command: string, cwd: string) => {
    if (/rm\s+-rf\s+[\/\*]/.test(command)) throw new Error('危险命令已拒绝');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
      return { stdout, stderr, exitCode: 0 };
    } catch (err: unknown) {
      const error = err as { stdout?: string; stderr?: string; code?: number };
      return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.code || 1 };
    }
  });

  // 数据库
  ipcMain.handle('db:query', async (_e, sql: string, params?: unknown[]) => {
    if (/\b(DROP|ALTER|CREATE|INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bSELECT\b/i.test(sql)) throw new Error('仅支持查询操作');
    return queryDb(sql, params);
  });
  ipcMain.handle('db:run', async (_e, sql: string, params?: unknown[]) => {
    if (/\bDROP\s+TABLE\b/i.test(sql)) throw new Error('禁止删除表');
    return runDb(sql, params);
  });

  // 工程兼容
  ipcMain.handle('compat:load', async (_e, projectRoot: string) => {
    const compat = new ProjectCompatManager(projectRoot);
    return compat.load();
  });
  ipcMain.handle('compat:save', async (_e, projectRoot: string, data: object) => {
    const compat = new ProjectCompatManager(projectRoot);
    return compat.save(data);
  });

  // 系统设置
  ipcMain.handle('settings:get', async () => {
    const store = getStore() as unknown as Record<string, unknown>;
    return store['settings'] ?? {};
  });
  ipcMain.handle('settings:save', async (_e, settings: Record<string, unknown>) => {
    const store = getStore() as unknown as Record<string, unknown>;
    store['settings'] = settings;
  });
  ipcMain.handle('system:showInFolder', async (_e, filePath: string) => { const { shell } = await import('electron'); shell.showItemInFolder(filePath); });
  ipcMain.handle('system:getClipboardText', async () => { const { clipboard } = await import('electron'); return clipboard.readText(); });

  // 安全存储
  ipcMain.handle('crypto:encrypt', async (_e, plainText: string) => {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(plainText).toString('base64');
    }
    return plainText;
  });
  ipcMain.handle('crypto:decrypt', async (_e, encrypted: string) => {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return encrypted;
  });

  // ────────────────────────────────────────
  // Token 用量统计
  // ────────────────────────────────────────

  // 写入用量记录（由渲染进程 invoke 调用）
  ipcMain.handle('usage:record', async (_e, rec: {
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
  }) => {
    insertUsageRecord(rec);
  });

  // 写入用量记录（由 adapter 渲染进程 send 降级调用）
  ipcMain.on('record-usage', (_e, rec: {
    timestamp: number; projectPath: string; projectName: string;
    model: string; provider: string; inputTokens: number;
    outputTokens: number; costRmb: number; durationMs: number;
    sessionId: string; taskId: string; role: string;
  }) => {
    insertUsageRecord(rec);
  });

  // 查询今日用量
  ipcMain.handle('usage:getToday', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const rows = queryUsage(
      `SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur, COUNT(*) AS cnt
       FROM token_usage WHERE date(timestamp / 1000, 'unixepoch') = ?`,
      [today]
    );
    const r = rows[0] as Record<string, number | string | null> || {};
    const input = Number(r.input ?? 0);
    const output = Number(r.output ?? 0);
    const cost = Number(r.cost ?? 0);
    const dur = Number(r.dur ?? 0);
    const cnt = Number(r.cnt ?? 0);
    return {
      date: today,
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      costRmb: +(cost.toFixed(4)),
      durationMs: dur,
      requestCount: cnt,
    };
  });

  // 查询历史总用量
  ipcMain.handle('usage:getTotal', async () => {
    const rows = queryUsage(
      `SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur, COUNT(*) AS cnt,
              MIN(date(timestamp / 1000, 'unixepoch')) AS first_date,
              MAX(date(timestamp / 1000, 'unixepoch')) AS last_date
       FROM token_usage`
    );
    const r = rows[0] as Record<string, number | string | null> || {};
    const input = Number(r.input ?? 0);
    const output = Number(r.output ?? 0);
    const cost = Number(r.cost ?? 0);
    const dur = Number(r.dur ?? 0);
    const cnt = Number(r.cnt ?? 0);
    return {
      inputTokens: input,
      outputTokens: output,
      totalTokens: input + output,
      costRmb: +(cost.toFixed(4)),
      durationMs: dur,
      requestCount: cnt,
      firstSeen: (r.first_date as string) || '-',
      lastSeen: (r.last_date as string) || '-',
    };
  });

  // 按项目汇总
  ipcMain.handle('usage:getByProject', async () => {
    const rows = queryUsage(
      `SELECT project_path, project_name,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur,
              COUNT(*) AS cnt,
              MAX(date(timestamp / 1000, 'unixepoch')) AS last_used
       FROM token_usage WHERE project_path != ''
       GROUP BY project_path ORDER BY last_used DESC`
    );
    return (rows as Array<Record<string, number | string | null>>).map(r => {
      const input = Number(r.input ?? 0);
      const output = Number(r.output ?? 0);
      const cost = Number(r.cost ?? 0);
      const dur = Number(r.dur ?? 0);
      const cnt = Number(r.cnt ?? 0);
      return {
        projectPath: (r.project_path as string) || '',
        projectName: (r.project_name as string) || '',
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        costRmb: +(cost.toFixed(4)),
        durationMs: dur,
        requestCount: cnt,
        lastUsed: (r.last_used as string) || '',
      };
    });
  });

  // 按日期汇总（最近 N 天）
  ipcMain.handle('usage:getByDate', async (_e, days: number = 30) => {
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const rows = queryUsage(
      `SELECT date(timestamp / 1000, 'unixepoch') AS day,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur,
              COUNT(*) AS cnt
       FROM token_usage WHERE day >= ?
       GROUP BY day ORDER BY day ASC`,
      [since]
    );
    return (rows as Array<Record<string, number | string | null>>).map(r => {
      const input = Number(r.input ?? 0);
      const output = Number(r.output ?? 0);
      const cost = Number(r.cost ?? 0);
      const dur = Number(r.dur ?? 0);
      const cnt = Number(r.cnt ?? 0);
      return {
        date: (r.day as string) || '',
        inputTokens: input,
        outputTokens: output,
        totalTokens: input + output,
        costRmb: +(cost.toFixed(4)),
        durationMs: dur,
        requestCount: cnt,
      };
    });
  });

  // 余额不足警告（由渲染进程调用，转发给所有窗口）
  ipcMain.on('usage:balance-warning', (_e, detail: string) => {
    const wins = BrowserWindow.getAllWindows();
    for (const win of wins) {
      if (!win.isDestroyed()) {
        win.webContents.send('usage:balance-warning', detail);
      }
    }
  });

  // 文件快照 & 任务会话 & Git 集成
  setupSnapshotIpc();
}

// ─────────────────────────────────────────
// 文件快照 & 任务会话
// ─────────────────────────────────────────

export function setupSnapshotIpc(): void {
  ipcMain.handle('snapshot:save', async (_e, projectPath: string, taskId: string, filePath: string, content: string) => {
    saveSnapshot(projectPath, taskId, filePath, content);
  });

  ipcMain.handle('snapshot:list', async (_e, projectPath: string, filePath: string) => {
    return getSnapshots(projectPath, filePath);
  });

  ipcMain.handle('snapshot:restore', async (_e, id: number) => {
    const rows = getSnapshots('', ''); // Marker only
    markSnapshotRestored(id);
  });

  ipcMain.handle('taskSession:save', async (_e, projectPath: string, tasksJson: string, currentIndex: number) => {
    saveTaskSession(projectPath, tasksJson, currentIndex);
  });

  ipcMain.handle('taskSession:get', async (_e, projectPath: string) => {
    return getTaskSession(projectPath);
  });

  ipcMain.handle('taskSession:clear', async (_e, projectPath: string) => {
    clearTaskSession(projectPath);
  });

  // ── Git 分支查询 ──
  ipcMain.handle('git:getBranch', async (_e, projectPath: string) => {
    try {
      const { execSync } = require('child_process');
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, timeout: 3000 })
        .toString().trim();
      return { branch, success: true };
    } catch {
      return { branch: null, success: false };
    }
  });

  // ── Gradle 快捷操作 ──
  ipcMain.handle('gradle:exec', async (_e, projectPath: string, task: string) => {
    const { spawn } = require('child_process');
    const gradlew = process.platform === 'win32'
      ? require('path').join(projectPath, 'gradlew.bat')
      : require('path').join(projectPath, 'gradlew');
    return new Promise((resolve) => {
      const proc = spawn(gradlew, [task], { cwd: projectPath, shell: true });
      let output = '';
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
      proc.on('close', (code: number) => resolve({ output, exitCode: code }));
      proc.on('error', (err: Error) => resolve({ output: err.message, exitCode: -1 }));
    });
  });

  // ── Git 用户身份 ──
  ipcMain.handle('git:getUser', async (_e, projectPath: string) => {
    try {
      const { execSync } = require('child_process');
      const name = execSync('git config user.name', { cwd: projectPath, timeout: 2000 }).toString().trim();
      const email = execSync('git config user.email', { cwd: projectPath, timeout: 2000 }).toString().trim();
      return { name, email };
    } catch {
      return { name: null, email: null };
    }
  });

  // ── AI 行为规则（CLAUDE.md） ──
  ipcMain.handle('config:getRules', async (_e, projectPath: string) => {
    return configManager.getRules(projectPath);
  });

  ipcMain.handle('config:setRules', async (_e, rules: string) => {
    projectRules = rules || '';
  });

  // ── AI 实时代码补全 ──
  ipcMain.handle('ai:complete', async (_e, context: string, language: string) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    try {
      const result = await adapter.send([
        { role: 'system', content: 'You are a code completion engine. Output ONLY the completion text. No markdown, no explanation, no backticks. Just the natural continuation of the code.' },
        { role: 'user', content: `Complete this ${language} code:\n\n${context}` }
      ], { temperature: 0.1, maxTokens: 64 });
      return result.trim();
    } catch {
      return '';
    }
  });

  // ── 文件对话框（附件上传）──
  ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '所有支持的文件', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg','txt','js','ts','tsx','jsx','json','xml','html','css','md','py','go','rs','java','kt','kts','gradle','yaml','yml','toml','ini','cfg','sh','bat','cmd','sql','log','csv'] },
        { name: '图片', extensions: ['png','jpg','jpeg','gif','webp','bmp','svg'] },
        { name: '文本/代码', extensions: ['txt','js','ts','tsx','jsx','json','xml','html','css','md','py','go','rs','java','kt','kts','gradle','yaml','yml','toml','ini','cfg','sh','bat','cmd','sql','log','csv'] },
      ],
    });
    if (result.canceled) return [];
    const fs = await import('fs');
    const path = await import('path');
    return result.filePaths.map(fp => {
      const stat = fs.statSync(fp);
      return { name: path.basename(fp), path: fp, size: stat.size, mtime: stat.mtimeMs };
    });
  });

  // ── 读取文本文件 ──
  ipcMain.handle('file:readText', async (_e, filePath: string) => {
    const fs = await import('fs');
    if (!fs.existsSync(filePath)) throw new Error('文件不存在');
    const stat = fs.statSync(filePath);
    if (stat.size > 10 * 1024 * 1024) throw new Error('文件过大');
    return fs.readFileSync(filePath, 'utf-8');
  });
}
