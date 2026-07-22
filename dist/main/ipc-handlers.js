"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
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
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupIpcHandlers = setupIpcHandlers;
exports.setupSnapshotIpc = setupSnapshotIpc;
/**
 * PersonalIDE - IPC Handlers
 */
const electron_1 = require("electron");
const file_service_1 = require("./file-service");
const adapter_1 = require("../core/model/adapter");
const model_meta_1 = require("../core/model/model-meta");
const builder_agent_1 = require("../core/agent/builder-agent");
const coder_agent_1 = require("../core/agent/coder-agent");
const sqlite_1 = require("./db/sqlite");
const task_runner_1 = require("../core/task/task-runner");
const config_manager_1 = require("../core/config/config-manager");
const project_compat_1 = require("../core/compat/project-compat");
const sqlite_2 = require("./db/sqlite");
const store_1 = require("./store");
const store = (0, store_1.getStore)();
const zlib = __importStar(require("zlib"));
const path = __importStar(require("path"));
const lsp_manager_1 = require("./lsp-manager");
const mcp_tools_1 = require("./mcp-tools");
let currentAbortController = null;
let currentProjectPath = null;
let projectRules = '';
const fileService = new file_service_1.FileService();
function getModelConfig() {
    const saved = (0, store_1.getStore)().get('modelConfig');
    if (saved) {
        // 解密存储的 API Key
        const config = { ...saved };
        if (config.apiKey && electron_1.safeStorage.isEncryptionAvailable()) {
            try {
                config.apiKey = electron_1.safeStorage.decryptString(Buffer.from(config.apiKey, 'base64'));
            }
            catch {
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
function createAdapterWithUsage(config) {
    const adapter = new adapter_1.ModelAdapter(config);
    adapter.onUsage = (rec) => {
        insertUsageRecord(rec);
    };
    return adapter;
}
/** 用量记录写入（主进程直接调 SQLite） */
function insertUsageRecord(rec) {
    try {
        (0, sqlite_2.insertUsage)({
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
    }
    catch (err) {
        console.error('[IPC] 用量记录失败:', err);
    }
}
function setupIpcHandlers() {
    // 文件操作
    electron_1.ipcMain.handle('file:read', async (_e, filePath) => fileService.read(filePath));
    electron_1.ipcMain.handle('file:write', async (_e, filePath, content) => fileService.write(filePath, content));
    electron_1.ipcMain.handle('file:delete', async (_e, filePath) => fileService.delete(filePath));
    electron_1.ipcMain.handle('file:rename', async (_e, oldPath, newPath) => fileService.rename(oldPath, newPath));
    electron_1.ipcMain.handle('file:mkdir', async (_e, dirPath) => fileService.mkdir(dirPath));
    electron_1.ipcMain.handle('file:readDir', async (_e, dirPath) => fileService.readDir(dirPath));
    // ── 文件监听（通知渲染进程刷新文件树）──
    let fileWatchers = new Map();
    electron_1.ipcMain.handle('file:watch', async (_e, projectPath, enable) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!enable) {
            const w = fileWatchers.get(projectPath);
            if (w) {
                w.close();
                fileWatchers.delete(projectPath);
            }
            return { watching: false };
        }
        // 关闭旧监听
        const old = fileWatchers.get(projectPath);
        if (old)
            old.close();
        // 启动新监听（递归监听 + 去抖）
        let timer = null;
        try {
            const watcher = fs.watch(projectPath, { recursive: true }, (_event, _filename) => {
                if (timer)
                    return;
                timer = setTimeout(() => {
                    timer = null;
                    const win = electron_1.BrowserWindow.getAllWindows()[0];
                    if (win && !win.isDestroyed()) {
                        win.webContents.send('file:changed', projectPath);
                    }
                }, 500);
            });
            fileWatchers.set(projectPath, watcher);
            return { watching: true };
        }
        catch {
            return { watching: false };
        }
    });
    electron_1.ipcMain.handle('file:stats', async (_e, filePath) => fileService.stats(filePath));
    // 项目
    electron_1.ipcMain.handle('project:open', async (event) => {
        const result = await electron_1.dialog.showOpenDialog(electron_1.BrowserWindow.fromWebContents(event.sender), {
            properties: ['openDirectory'],
            title: '选择项目目录',
        });
        if (!result.canceled && result.filePaths[0]) {
            currentProjectPath = result.filePaths[0];
            return currentProjectPath;
        }
        return null;
    });
    electron_1.ipcMain.handle('project:openPath', async (_e, projectPath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (fs.existsSync(projectPath)) {
            currentProjectPath = projectPath;
            return;
        }
        throw new Error(`项目路径不存在: ${projectPath}`);
    });
    electron_1.ipcMain.handle('project:getPath', async () => currentProjectPath);
    // AI 发送（非流式）
    electron_1.ipcMain.handle('ai:send', async (_e, messages, options) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        adapter.setSystemRules(projectRules);
        return adapter.send(messages, { ...options, stream: false });
    });
    // AI 发送（流式）
    electron_1.ipcMain.handle('ai:send-stream', async (event, messages, options) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        adapter.setSystemRules(projectRules);
        currentAbortController = new AbortController();
        const window = electron_1.BrowserWindow.fromWebContents(event.sender);
        try {
            await adapter.send(messages, {
                ...options,
                stream: true,
                onChunk: (chunk) => { if (!window.isDestroyed())
                    window.webContents.send('ai-stream-chunk', chunk); },
                signal: currentAbortController.signal,
            });
            if (!window.isDestroyed())
                window.webContents.send('ai-stream-end', '');
        }
        catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (!window.isDestroyed())
                window.webContents.send('ai-stream-error', msg);
        }
    });
    electron_1.ipcMain.on('ai:abort', () => { currentAbortController?.abort(); });
    // 模型配置
    electron_1.ipcMain.handle('model:getConfig', async () => getModelConfig());
    electron_1.ipcMain.handle('model:saveConfig', async (_e, config) => {
        const store = (0, store_1.getStore)();
        // 🔐 加密存储 API Key（safeStorage 不可用时保持明文）
        const toSave = { ...config };
        if (toSave.apiKey && electron_1.safeStorage.isEncryptionAvailable()) {
            toSave.apiKey = electron_1.safeStorage.encryptString(toSave.apiKey).toString('base64');
        }
        store.set('modelConfig', toSave);
    });
    electron_1.ipcMain.handle('model:testConnection', async (_e, params) => {
        const config = {
            provider: params.provider,
            baseUrl: params.baseUrl,
            apiKey: params.apiKey,
            model: params.model,
        };
        const adapter = new adapter_1.ModelAdapter(config);
        return adapter.testConnection();
    });
    // 模型元数据查询
    electron_1.ipcMain.handle('model:listMeta', async (_e, provider) => {
        if (provider && provider !== 'all') {
            return model_meta_1.modelRegistry.listByProvider(provider);
        }
        return model_meta_1.modelRegistry.listAll();
    });
    electron_1.ipcMain.handle('model:getMeta', async (_e, provider, modelId) => {
        return model_meta_1.modelRegistry.lookup(provider, modelId) ?? model_meta_1.modelRegistry.lookupById(modelId);
    });
    // Builder
    electron_1.ipcMain.handle('agent:builder', async (_e, requirement, projectContext) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        adapter.setSystemRules(projectRules);
        const builder = new builder_agent_1.BuilderAgent(adapter);
        return builder.run(requirement, projectContext);
    });
    // Coder
    electron_1.ipcMain.handle('agent:coder', async (_e, task, projectRoot) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        adapter.setSystemRules(projectRules);
        const coder = new coder_agent_1.CoderAgent(adapter, fileService);
        return coder.run(task, projectRoot);
    });
    // TaskRunner
    electron_1.ipcMain.handle('task:runLoop', async (event, tasks, projectRoot) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        adapter.setSystemRules(projectRules);
        const runner = new task_runner_1.TaskRunner(adapter, fileService, (progress) => {
            const window = electron_1.BrowserWindow.fromWebContents(event.sender);
            if (!window.isDestroyed())
                window.webContents.send('task-progress', progress);
        });
        return runner.run(tasks, projectRoot);
    });
    // 终端命令
    electron_1.ipcMain.handle('terminal:exec', async (_e, command, cwd) => {
        if (/rm\s+-rf\s+[\/\*]/.test(command))
            throw new Error('危险命令已拒绝');
        const { exec } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const { promisify } = await Promise.resolve().then(() => __importStar(require('util')));
        const execAsync = promisify(exec);
        try {
            const { stdout, stderr } = await execAsync(command, { cwd, timeout: 120000, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
            return { stdout, stderr, exitCode: 0 };
        }
        catch (err) {
            const error = err;
            return { stdout: error.stdout || '', stderr: error.stderr || '', exitCode: error.code || 1 };
        }
    });
    // 数据库
    electron_1.ipcMain.handle('db:query', async (_e, sql, params) => {
        if (/\b(DROP|ALTER|CREATE|INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bSELECT\b/i.test(sql))
            throw new Error('仅支持查询操作');
        return (0, sqlite_2.queryDb)(sql, params);
    });
    electron_1.ipcMain.handle('db:run', async (_e, sql, params) => {
        if (/\bDROP\s+TABLE\b/i.test(sql))
            throw new Error('禁止删除表');
        return (0, sqlite_2.runDb)(sql, params);
    });
    // 工程兼容
    electron_1.ipcMain.handle('compat:load', async (_e, projectRoot) => {
        const compat = new project_compat_1.ProjectCompatManager(projectRoot);
        return compat.load();
    });
    electron_1.ipcMain.handle('compat:save', async (_e, projectRoot, data) => {
        const compat = new project_compat_1.ProjectCompatManager(projectRoot);
        return compat.save(data);
    });
    // 系统设置
    electron_1.ipcMain.handle('settings:get', async () => {
        return (0, store_1.getStore)().get('settings') ?? {};
    });
    electron_1.ipcMain.handle('settings:save', async (_e, settings) => {
        (0, store_1.getStore)().set('settings', settings);
    });
    electron_1.ipcMain.handle('system:showInFolder', async (_e, filePath) => { const { shell } = await Promise.resolve().then(() => __importStar(require('electron'))); shell.showItemInFolder(filePath); });
    electron_1.ipcMain.handle('system:getClipboardText', async () => { const { clipboard } = await Promise.resolve().then(() => __importStar(require('electron'))); return clipboard.readText(); });
    // 安全存储
    electron_1.ipcMain.handle('crypto:encrypt', async (_e, plainText) => {
        if (electron_1.safeStorage.isEncryptionAvailable()) {
            return electron_1.safeStorage.encryptString(plainText).toString('base64');
        }
        return plainText;
    });
    electron_1.ipcMain.handle('crypto:decrypt', async (_e, encrypted) => {
        if (electron_1.safeStorage.isEncryptionAvailable()) {
            return electron_1.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
        }
        return encrypted;
    });
    // ────────────────────────────────────────
    // Token 用量统计
    // ────────────────────────────────────────
    // 写入用量记录（由渲染进程 invoke 调用）
    electron_1.ipcMain.handle('usage:record', async (_e, rec) => {
        insertUsageRecord(rec);
    });
    // 写入用量记录（由 adapter 渲染进程 send 降级调用）
    electron_1.ipcMain.on('record-usage', (_e, rec) => {
        insertUsageRecord(rec);
    });
    // 查询今日用量
    electron_1.ipcMain.handle('usage:getToday', async () => {
        const today = new Date().toISOString().slice(0, 10);
        const rows = (0, sqlite_2.queryUsage)(`SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur, COUNT(*) AS cnt
       FROM token_usage WHERE date(timestamp / 1000, 'unixepoch') = ?`, [today]);
        const r = rows[0] || {};
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
    electron_1.ipcMain.handle('usage:getTotal', async () => {
        const rows = (0, sqlite_2.queryUsage)(`SELECT SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur, COUNT(*) AS cnt,
              MIN(date(timestamp / 1000, 'unixepoch')) AS first_date,
              MAX(date(timestamp / 1000, 'unixepoch')) AS last_date
       FROM token_usage`);
        const r = rows[0] || {};
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
            firstSeen: r.first_date || '-',
            lastSeen: r.last_date || '-',
        };
    });
    // 按项目汇总
    electron_1.ipcMain.handle('usage:getByProject', async () => {
        const rows = (0, sqlite_2.queryUsage)(`SELECT project_path, project_name,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur,
              COUNT(*) AS cnt,
              MAX(date(timestamp / 1000, 'unixepoch')) AS last_used
       FROM token_usage WHERE project_path != ''
       GROUP BY project_path ORDER BY last_used DESC`);
        return rows.map(r => {
            const input = Number(r.input ?? 0);
            const output = Number(r.output ?? 0);
            const cost = Number(r.cost ?? 0);
            const dur = Number(r.dur ?? 0);
            const cnt = Number(r.cnt ?? 0);
            return {
                projectPath: r.project_path || '',
                projectName: r.project_name || '',
                inputTokens: input,
                outputTokens: output,
                totalTokens: input + output,
                costRmb: +(cost.toFixed(4)),
                durationMs: dur,
                requestCount: cnt,
                lastUsed: r.last_used || '',
            };
        });
    });
    // 按日期汇总（最近 N 天）
    electron_1.ipcMain.handle('usage:getByDate', async (_e, days = 30) => {
        const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
        const rows = (0, sqlite_2.queryUsage)(`SELECT date(timestamp / 1000, 'unixepoch') AS day,
              SUM(input_tokens) AS input, SUM(output_tokens) AS output,
              SUM(cost_rmb) AS cost, SUM(duration_ms) AS dur,
              COUNT(*) AS cnt
       FROM token_usage WHERE day >= ?
       GROUP BY day ORDER BY day ASC`, [since]);
        return rows.map(r => {
            const input = Number(r.input ?? 0);
            const output = Number(r.output ?? 0);
            const cost = Number(r.cost ?? 0);
            const dur = Number(r.dur ?? 0);
            const cnt = Number(r.cnt ?? 0);
            return {
                date: r.day || '',
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
    electron_1.ipcMain.on('usage:balance-warning', (_e, detail) => {
        const wins = electron_1.BrowserWindow.getAllWindows();
        for (const win of wins) {
            if (!win.isDestroyed()) {
                win.webContents.send('usage:balance-warning', detail);
            }
        }
    });
    // ── 会话持久化 ──
    electron_1.ipcMain.handle('session:save', async (_e, sessionState) => {
        (0, store_1.getStore)().set('sessionState', { ...sessionState, timestamp: Date.now() });
    });
    electron_1.ipcMain.handle('session:restore', async () => {
        return (0, store_1.getStore)().get('sessionState') || null;
    });
    // ── 文件创建 ──
    electron_1.ipcMain.handle('file:create', async (_e, filePath, content) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const pathMod = await Promise.resolve().then(() => __importStar(require('path')));
        const dir = pathMod.dirname(filePath);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, content || '', 'utf-8');
    });
    // ── 系统：打开外部应用/文件 ──
    electron_1.ipcMain.handle('system:openExternal', async (_e, target) => {
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openPath(target);
    });
    // ── 系统：在浏览器中打开 URL ──
    electron_1.ipcMain.handle('system:openBrowser', async (_e, url) => {
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openExternal(url.startsWith('http') ? url : `https://${url}`);
    });
    // ── 系统：打开终端 ──
    electron_1.ipcMain.handle('system:openTerminal', async (_e, cwd) => {
        const { spawn } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const targetDir = cwd || currentProjectPath || process.cwd();
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', 'cmd', '/k', `cd /d "${targetDir}"`], { shell: true, detached: true, stdio: 'ignore' }).unref();
        }
        else if (process.platform === 'darwin') {
            spawn('open', ['-a', 'Terminal', targetDir], { detached: true, stdio: 'ignore' }).unref();
        }
        else {
            spawn('x-terminal-emulator', [], { cwd: targetDir, detached: true, stdio: 'ignore' }).unref();
        }
    });
    // ── 系统：在文件管理器中打开 ──
    electron_1.ipcMain.handle('system:openFolder', async (_e, folderPath) => {
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        const target = folderPath || currentProjectPath;
        if (target)
            await shell.openPath(target);
    });
    // ── 系统：用默认程序打开文件 ──
    electron_1.ipcMain.handle('system:openFile', async (_e, filePath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!fs.existsSync(filePath))
            throw new Error(`文件不存在: ${filePath}`);
        const { shell } = await Promise.resolve().then(() => __importStar(require('electron')));
        await shell.openPath(filePath);
    });
    // ── 项目：获取目录结构（用于文件树创建）──
    electron_1.ipcMain.handle('project:getRoot', async () => currentProjectPath);
    // 文件快照 & 任务会话 & Git 集成
    setupSnapshotIpc();
}
// ─────────────────────────────────────────
// 文件快照 & 任务会话
// ─────────────────────────────────────────
function setupSnapshotIpc() {
    electron_1.ipcMain.handle('snapshot:save', async (_e, projectPath, taskId, filePath, content) => {
        (0, sqlite_1.saveSnapshot)(projectPath, taskId, filePath, content);
    });
    electron_1.ipcMain.handle('snapshot:list', async (_e, projectPath, filePath) => {
        return (0, sqlite_1.getSnapshots)(projectPath, filePath);
    });
    electron_1.ipcMain.handle('snapshot:restore', async (_e, id) => {
        const rows = (0, sqlite_1.getSnapshots)('', ''); // Marker only
        (0, sqlite_1.markSnapshotRestored)(id);
    });
    electron_1.ipcMain.handle('taskSession:save', async (_e, projectPath, tasksJson, currentIndex) => {
        (0, sqlite_1.saveTaskSession)(projectPath, tasksJson, currentIndex);
    });
    electron_1.ipcMain.handle('taskSession:get', async (_e, projectPath) => {
        return (0, sqlite_1.getTaskSession)(projectPath);
    });
    electron_1.ipcMain.handle('taskSession:clear', async (_e, projectPath) => {
        (0, sqlite_1.clearTaskSession)(projectPath);
    });
    // ── Git 分支查询 ──
    electron_1.ipcMain.handle('git:getBranch', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, timeout: 3000 })
                .toString().trim();
            return { branch, success: true };
        }
        catch {
            return { branch: null, success: false };
        }
    });
    // ── Gradle 快捷操作 ──
    electron_1.ipcMain.handle('gradle:exec', async (_e, projectPath, task) => {
        const { spawn } = require('child_process');
        const gradlew = process.platform === 'win32'
            ? require('path').join(projectPath, 'gradlew.bat')
            : require('path').join(projectPath, 'gradlew');
        return new Promise((resolve) => {
            const proc = spawn(gradlew, [task], { cwd: projectPath, shell: true });
            let output = '';
            proc.stdout?.on('data', (d) => { output += d.toString(); });
            proc.stderr?.on('data', (d) => { output += d.toString(); });
            proc.on('close', (code) => resolve({ output, exitCode: code }));
            proc.on('error', (err) => resolve({ output: err.message, exitCode: -1 }));
        });
    });
    // ── Git 用户身份 ──
    electron_1.ipcMain.handle('git:getUser', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const name = execSync('git config user.name', { cwd: projectPath, timeout: 2000 }).toString().trim();
            const email = execSync('git config user.email', { cwd: projectPath, timeout: 2000 }).toString().trim();
            return { name, email };
        }
        catch {
            return { name: null, email: null };
        }
    });
    // ── Git 状态 ──
    electron_1.ipcMain.handle('git:status', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const output = execSync('git status --porcelain -b', { cwd: projectPath, timeout: 5000 }).toString();
            const lines = output.split('\n').filter(Boolean);
            const branchLine = lines[0];
            const branch = branchLine.startsWith('## ') ? branchLine.slice(3).split('...')[0] : 'unknown';
            const files = lines.slice(1).map((l) => ({
                status: l.slice(0, 2).trim(),
                path: l.slice(3).trim(),
            }));
            const ahead = branchLine.match(/\[ahead (\d+)\]/)?.[1] || '0';
            const behind = branchLine.match(/\[behind (\d+)\]/)?.[1] || '0';
            return { success: true, branch, files, ahead: parseInt(ahead), behind: parseInt(behind), dirty: files.length > 0 };
        }
        catch {
            return { success: false, branch: '', files: [], ahead: 0, behind: 0, dirty: false };
        }
    });
    // ── Git Stage All ──
    electron_1.ipcMain.handle('git:stageAll', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            execSync('git add -A', { cwd: projectPath, timeout: 10000 });
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Git Commit ──
    electron_1.ipcMain.handle('git:commit', async (_e, projectPath, message) => {
        try {
            const { execSync } = require('child_process');
            const safeMsg = message.replace(/"/g, '\\"');
            const output = execSync(`git commit -m "${safeMsg}"`, { cwd: projectPath, timeout: 10000 }).toString().trim();
            return { success: true, output };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Git Push ──
    electron_1.ipcMain.handle('git:push', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath, timeout: 3000 }).toString().trim();
            const output = execSync(`git push origin ${branch}`, { cwd: projectPath, timeout: 30000 }).toString().trim();
            return { success: true, output };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Git 分支列表 ──
    electron_1.ipcMain.handle('git:listBranches', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const output = execSync('git branch -a --sort=-committerdate', { cwd: projectPath, timeout: 5000 }).toString();
            const current = output.match(/\*\s+(\S+)/)?.[1] || '';
            const branches = [];
            for (const line of output.split('\n')) {
                const name = line.replace(/^[* ]\s*/, '').trim();
                if (!name || name.startsWith('remotes/'))
                    continue;
                const isCurrent = line.startsWith('*');
                branches.push({ name, current: isCurrent, remote: false });
            }
            return { success: true, branches, currentBranch: current };
        }
        catch (err) {
            return { success: false, branches: [], currentBranch: '', error: err.message };
        }
    });
    // ── Git 切换分支 ──
    electron_1.ipcMain.handle('git:checkout', async (_e, branch, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const output = execSync(`git checkout "${branch}"`, { cwd: projectPath, timeout: 10000 }).toString().trim();
            return { success: true, output };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Git Diff（返回文件改动行号）──
    electron_1.ipcMain.handle('git:diff', async (_e, filePath, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const relative = path.relative(projectPath, filePath).replace(/\\/g, '/');
            const output = execSync(`git diff -U0 HEAD -- "${relative}"`, { cwd: projectPath, timeout: 5000 }).toString();
            // 解析 unified diff 获取改动行号
            const added = [];
            const removed = [];
            const modified = [];
            for (const line of output.split('\n')) {
                if (line.startsWith('@@')) {
                    const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
                    if (m) {
                        const newStart = parseInt(m[3]);
                        const newCount = m[4] ? parseInt(m[4]) : 1;
                        for (let i = 0; i < newCount; i++)
                            modified.push(newStart + i);
                    }
                }
                else if (line.startsWith('+') && !line.startsWith('+++')) {
                    const prev = added[added.length - 1] || modified[modified.length - 1] || 0;
                    added.push(prev + 1);
                }
                else if (line.startsWith('-') && !line.startsWith('---')) {
                    const prev = removed[removed.length - 1] || (modified[modified.length - 1] || 0) - 1;
                    removed.push(prev + 1);
                }
            }
            return { success: true, added, removed, modified };
        }
        catch {
            return { success: false, added: [], removed: [], modified: [] };
        }
    });
    // ── Git Pull ──
    electron_1.ipcMain.handle('git:pull', async (_e, projectPath) => {
        try {
            const { execSync } = require('child_process');
            const output = execSync('git pull', { cwd: projectPath, timeout: 30000 }).toString().trim();
            return { success: true, output };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // ── Git Log ──
    electron_1.ipcMain.handle('git:log', async (_e, projectPath, count = 10) => {
        try {
            const { execSync } = require('child_process');
            const output = execSync(`git log --oneline -${count}`, { cwd: projectPath, timeout: 5000 }).toString().trim();
            const commits = output.split('\n').filter(Boolean).map((l) => {
                const [hash, ...msg] = l.split(' ');
                return { hash, message: msg.join(' ') };
            });
            return { success: true, commits };
        }
        catch {
            return { success: false, commits: [] };
        }
    });
    // ── AI 行为规则（CLAUDE.md） ──
    electron_1.ipcMain.handle('config:getRules', async (_e, projectPath) => {
        return config_manager_1.configManager.getRules(projectPath);
    });
    electron_1.ipcMain.handle('config:setRules', async (_e, rules) => {
        projectRules = rules || '';
    });
    // ── 架构分析 ──
    electron_1.ipcMain.handle('arch:analyze', async (_e, projectPath) => {
        const { ArchitectureAnalyzer } = await Promise.resolve().then(() => __importStar(require('../core/arch/arch-analyzer')));
        const analyzer = new ArchitectureAnalyzer(projectPath);
        return analyzer.analyze();
    });
    // ── AI 实时代码补全 ──
    electron_1.ipcMain.handle('ai:complete', async (_e, context, language) => {
        const config = getModelConfig();
        const adapter = createAdapterWithUsage(config);
        try {
            const result = await adapter.send([
                { role: 'system', content: 'You are a code completion engine. Output ONLY the completion text. No markdown, no explanation, no backticks. Just the natural continuation of the code.' },
                { role: 'user', content: `Complete this ${language} code:\n\n${context}` }
            ], { temperature: 0.1, maxTokens: 64 });
            return result.trim();
        }
        catch {
            return '';
        }
    });
    // ── 文件对话框（附件上传）──
    electron_1.ipcMain.handle('dialog:openFiles', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: '所有支持的文件', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'txt', 'js', 'ts', 'tsx', 'jsx', 'json', 'xml', 'html', 'css', 'md', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'gradle', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'sh', 'bat', 'cmd', 'sql', 'log', 'csv'] },
                { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] },
                { name: '文本/代码', extensions: ['txt', 'js', 'ts', 'tsx', 'jsx', 'json', 'xml', 'html', 'css', 'md', 'py', 'go', 'rs', 'java', 'kt', 'kts', 'gradle', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'sh', 'bat', 'cmd', 'sql', 'log', 'csv'] },
            ],
        });
        if (result.canceled)
            return [];
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        return result.filePaths.map(fp => {
            const stat = fs.statSync(fp);
            return { name: path.basename(fp), path: fp, size: stat.size, mtime: stat.mtimeMs };
        });
    });
    // ── 读取文本文件 ──
    electron_1.ipcMain.handle('file:readText', async (_e, filePath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!fs.existsSync(filePath))
            throw new Error('文件不存在');
        const stat = fs.statSync(filePath);
        if (stat.size > 10 * 1024 * 1024)
            throw new Error('文件过大');
        return fs.readFileSync(filePath, 'utf-8');
    });
    // ── 读取文件为 base64 data URL（图片/附件预览） ──
    electron_1.ipcMain.handle('file:readAsDataURL', async (_e, filePath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const pathMod = await Promise.resolve().then(() => __importStar(require('path')));
        if (!fs.existsSync(filePath))
            throw new Error('文件不存在');
        const stat = fs.statSync(filePath);
        if (stat.size > 50 * 1024 * 1024)
            throw new Error('文件过大（最大 50MB）');
        const buffer = fs.readFileSync(filePath);
        const ext = pathMod.extname(filePath).toLowerCase();
        const mimeMap = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
            '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
            '.pdf': 'application/pdf',
            '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
            '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
            '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
            '.aac': 'audio/aac', '.m4a': 'audio/mp4',
        };
        const mime = mimeMap[ext] || 'application/octet-stream';
        return `data:${mime};base64,${buffer.toString('base64')}`;
    });
    // ── 提取 DOCX/文本文件内容 ──
    electron_1.ipcMain.handle('file:readDocx', async (_e, filePath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const zlib = await Promise.resolve().then(() => __importStar(require('zlib')));
        if (!fs.existsSync(filePath))
            throw new Error('文件不存在');
        const buf = fs.readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        // .doc 文件：旧格式 OLE 二进制，尝试提取可读文本
        if (ext === '.doc' && (buf[0] !== 0x50 || buf[1] !== 0x4B)) {
            return extractTextFromBinary(buf, filePath);
        }
        // 检测 Office 临时文件（~$ 前缀）
        const baseName = path.basename(filePath);
        if (baseName.startsWith('~$')) {
            const realName = baseName.slice(2);
            return `[Office 临时锁定文件]
文件: ${baseName}

这是 Microsoft Office 的临时锁定文件。当 Word/Excel 打开文档时自动生成，关闭文档后自动删除。

请打开真正的文档文件: ${realName}

文件大小: ${(buf.length / 1024).toFixed(1)} KB`;
        }
        // 检查是否为 ZIP/DOCX
        if (buf[0] !== 0x50 || buf[1] !== 0x4B) {
            return `[无法解析] ${baseName}

该文件不是有效的 DOCX/ZIP 格式（文件头不是 PK）。可能原因：
• 文件已损坏
• 这是旧版 .doc 格式（请用 Word 另存为 .docx）
• 文件正在被其他程序占用尚未写完

文件大小: ${(buf.length / 1024).toFixed(1)} KB`;
        }
        // 稳健 ZIP 解析：找到中央目录获取所有文件条目
        let xmlText = '';
        const entries = parseZipEntries(buf);
        if (entries.length === 0) {
            return `[无法解析] ZIP 文件没有可用条目\n大小: ${(buf.length / 1024).toFixed(1)} KB`;
        }
        for (const entry of entries) {
            if (entry.name === 'word/document.xml') {
                try {
                    xmlText = entry.decompress(buf);
                    break;
                }
                catch (e) {
                    console.warn('[DOCX] document.xml decompress failed:', e);
                }
            }
        }
        if (xmlText) {
            const text = extractTextFromDocxXml(xmlText);
            if (text.trim())
                return text;
        }
        // 降级：扫描全部 XML 提取文本
        for (const entry of entries) {
            if (entry.name.endsWith('.xml')) {
                try {
                    xmlText += entry.decompress(buf) + '\n';
                }
                catch { /* skip */ }
                if (xmlText.length > 500000)
                    break;
            }
        }
        if (xmlText) {
            const textOnly = xmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            return textOnly.slice(0, 50000) || '（无法提取文档内容）';
        }
        return '（无法提取文档内容）';
    });
    // ── 读取二进制文件为 hex dump ──
    electron_1.ipcMain.handle('file:readHex', async (_e, filePath, maxBytes = 16384) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!fs.existsSync(filePath))
            throw new Error('文件不存在');
        const stat = fs.statSync(filePath);
        if (stat.size > 100 * 1024 * 1024)
            throw new Error('文件过大（最大 100MB）');
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(Math.min(stat.size, maxBytes));
        fs.readSync(fd, buf, 0, buf.length, 0);
        fs.closeSync(fd);
        // 生成 hex dump
        let hex = '';
        for (let i = 0; i < buf.length; i += 16) {
            const chunk = buf.slice(i, Math.min(i + 16, buf.length));
            const offset = i.toString(16).padStart(8, '0');
            const hexPart = Array.from(chunk).map(b => b.toString(16).padStart(2, '0')).join(' ');
            const asciiPart = Array.from(chunk).map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
            hex += `${offset}  ${hexPart.padEnd(48)} ${asciiPart}\n`;
        }
        return {
            hex: hex,
            size: stat.size,
            truncated: stat.size > maxBytes,
            maxBytes: maxBytes,
        };
    });
    // ── 读取 PDF 为 base64（渲染进程创建 Blob URL）──
    electron_1.ipcMain.handle('file:readPdfBase64', async (_e, filePath) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        if (!fs.existsSync(filePath))
            throw new Error('文件不存在');
        const stat = fs.statSync(filePath);
        if (stat.size > 50 * 1024 * 1024)
            throw new Error('PDF 文件过大（最大 50MB）');
        const buffer = fs.readFileSync(filePath);
        return { base64: buffer.toString('base64'), name: path.basename(filePath) };
    });
    // ── 配置导入/导出 ──
    electron_1.ipcMain.handle('config:export', async () => {
        const result = await electron_1.dialog.showSaveDialog({
            title: '导出配置',
            defaultPath: 'tcide-config.json',
            filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (result.canceled || !result.filePath)
            return { success: false };
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const config = getModelConfig();
        // 不导出敏感 API Key
        const safeConfig = { ...config, apiKey: '' };
        fs.writeFileSync(result.filePath, JSON.stringify(safeConfig, null, 2), 'utf-8');
        return { success: true, path: result.filePath };
    });
    electron_1.ipcMain.handle('config:import', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            title: '导入配置',
            filters: [{ name: 'JSON', extensions: ['json'] }],
            properties: ['openFile'],
        });
        if (result.canceled || result.filePaths.length === 0)
            return null;
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const content = fs.readFileSync(result.filePaths[0], 'utf-8');
        return JSON.parse(content);
    });
    // ── 项目搜索 ──
    electron_1.ipcMain.handle('search:project', async (_e, projectPath, query) => {
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const results = [];
        const searchDir = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'build' || entry.name === 'dist' || entry.name === '.git')
                        continue;
                    if (entry.isDirectory()) {
                        if (results.length < 200)
                            searchDir(fullPath);
                    }
                    else if (entry.isFile()) {
                        if (results.length >= 200)
                            return;
                        try {
                            const stat = fs.statSync(fullPath);
                            if (stat.size > 500 * 1024)
                                return; // 跳过 > 500KB 文件
                            const content = fs.readFileSync(fullPath, 'utf-8');
                            const lines = content.split('\n');
                            for (let i = 0; i < lines.length; i++) {
                                if (lines[i].toLowerCase().includes(query.toLowerCase())) {
                                    results.push({ file: fullPath, line: i + 1, text: lines[i].trim() });
                                    if (results.length >= 200)
                                        return;
                                }
                            }
                        }
                        catch { /* 跳过无法读取的文件 */ }
                    }
                }
            }
            catch { /* 跳过无法访问的目录 */ }
        };
        searchDir(projectPath);
        return results;
    });
    // ── 最近项目 ──
    electron_1.ipcMain.handle('project:getRecent', async () => {
        return (0, store_1.getStore)().get('recentProjects') || [];
    });
    electron_1.ipcMain.handle('project:addRecent', async (_e, projectPath) => {
        const pathModule = await Promise.resolve().then(() => __importStar(require('path')));
        const store = (0, store_1.getStore)();
        const recent = store.get('recentProjects') || [];
        const existing = recent.findIndex(r => r.path === projectPath);
        const entry = { path: projectPath, name: pathModule.basename(projectPath), lastOpened: Date.now() };
        if (existing >= 0) {
            recent.splice(existing, 1);
        }
        recent.unshift(entry);
        if (recent.length > 20)
            recent.length = 20;
        store.set('recentProjects', recent);
        return recent;
    });
}
// ─────────────────────────────────────────
// DOCX / ZIP / DOC 解析辅助
// ─────────────────────────────────────────
function extractTextFromBinary(buf, filePath) {
    // .doc (OLE binary) → 提取可读文本段
    let text = '';
    let current = '';
    for (let i = 0; i < buf.length && text.length < 100000; i++) {
        const b = buf[i];
        // ASCII 可打印字符 + 常见中文 Unicode（UTF-8 序列检测）
        if ((b >= 32 && b <= 126) || b === 0x0A || b === 0x0D || b === 0x09) {
            current += String.fromCharCode(b);
        }
        else {
            if (current.length > 3) {
                text += current + '\n';
            }
            current = '';
        }
    }
    if (current.length > 3)
        text += current;
    const cleaned = text.replace(/[^\x20-\x7E\u4e00-\u9fff\u3000-\u303f\uFF00-\uFFEF\n\r\t]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (cleaned.length > 100) {
        return `[旧格式 .doc 文本提取]\n文件: ${path.basename(filePath)}\n大小: ${(buf.length / 1024).toFixed(1)} KB\n\n${cleaned.slice(0, 50000)}`;
    }
    return `[旧格式 .doc]\n文件: ${path.basename(filePath)}\n大小: ${(buf.length / 1024).toFixed(1)} KB\n\n此文件为旧版 Word 格式（OLE 二进制），仅支持有限文本提取。建议用 Word 另存为 .docx 格式以获得完整支持。`;
}
function parseZipEntries(buf) {
    const entries = [];
    // 从末尾查找中央目录
    let eocdOffset = buf.length - 22;
    while (eocdOffset >= 0) {
        if (buf[eocdOffset] === 0x50 && buf[eocdOffset + 1] === 0x4B &&
            buf[eocdOffset + 2] === 0x05 && buf[eocdOffset + 3] === 0x06) {
            const cdOffset = buf.readUInt32LE(eocdOffset + 16);
            let offset = cdOffset;
            while (offset < eocdOffset) {
                if (buf[offset] !== 0x50 || buf[offset + 1] !== 0x4B ||
                    buf[offset + 2] !== 0x01 || buf[offset + 3] !== 0x02)
                    break;
                const compMethod = buf.readUInt16LE(offset + 10);
                const compSize = buf.readUInt32LE(offset + 20);
                const uncompSize = buf.readUInt32LE(offset + 24);
                const nameLen = buf.readUInt16LE(offset + 28);
                const extraLen = buf.readUInt16LE(offset + 30);
                const commentLen = buf.readUInt16LE(offset + 32);
                const localOffset = buf.readUInt32LE(offset + 42);
                const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen);
                entries.push({
                    name,
                    compMethod,
                    compSize,
                    uncompSize,
                    localOffset,
                    decompress: (b) => {
                        const localNameLen = b.readUInt16LE(localOffset + 26);
                        const localExtraLen = b.readUInt16LE(localOffset + 28);
                        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
                        const compressed = b.slice(dataStart, dataStart + compSize);
                        if (compMethod === 0) {
                            return compressed.toString('utf8');
                        }
                        else if (compMethod === 8) {
                            try {
                                return zlib.inflateRawSync(compressed).toString('utf8');
                            }
                            catch {
                                try {
                                    return zlib.inflateSync(compressed).toString('utf8');
                                }
                                catch {
                                    return compressed.toString('utf8');
                                }
                            }
                        }
                        return compressed.toString('utf8');
                    },
                });
                offset += 46 + nameLen + extraLen + commentLen;
            }
            break;
        }
        eocdOffset--;
    }
    return entries;
}
function extractTextFromDocxXml(xml) {
    // 按段落分割
    const paragraphs = xml.split(/<w:p[\s>]/);
    const lines = [];
    let inTable = false;
    for (const p of paragraphs) {
        // 跳过空段落和修订标记
        if (!p.includes('<w:t'))
            continue;
        // 检测表格
        if (p.includes('<w:tbl>')) {
            inTable = true;
            continue;
        }
        if (p.includes('</w:tbl>')) {
            inTable = false;
            continue;
        }
        // 提取所有文本运行
        const runs = p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        if (!runs)
            continue;
        const text = runs.map(r => r.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, '')).join('');
        if (!text.trim())
            continue;
        // 标题检测
        if (p.includes('<w:pStyle w:val="Heading1"') || p.includes('<w:pStyle w:val="1"')) {
            lines.push(`\n# ${text.trim()}`);
        }
        else if (p.includes('<w:pStyle w:val="Heading2"') || p.includes('<w:pStyle w:val="2"')) {
            lines.push(`\n## ${text.trim()}`);
        }
        else if (p.includes('<w:pStyle w:val="Heading3"') || p.includes('<w:pStyle w:val="3"')) {
            lines.push(`\n### ${text.trim()}`);
        }
        else if (p.includes('<w:numPr>')) {
            // 列表项
            lines.push(`- ${text.trim()}`);
        }
        else if (inTable) {
            lines.push(`| ${text.trim()} |`);
        }
        else {
            lines.push(text.trim());
        }
    }
    return lines.join('\n\n').replace(/\n{3,}/g, '\n\n') || '（文档为空）';
}
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LSP 语言服务器 IPC 处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 启动语言服务器
electron_1.ipcMain.handle('lsp:start', async (_e, language, projectPath) => {
    try {
        await lsp_manager_1.lspManager.startServer(language, projectPath);
        return { success: true };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// 停止语言服务器
electron_1.ipcMain.handle('lsp:stop', async (_e, language, projectPath) => {
    await lsp_manager_1.lspManager.stopServer(language, projectPath);
    return { success: true };
});
// 检查服务器状态
electron_1.ipcMain.handle('lsp:status', async (_e, language, projectPath) => {
    return lsp_manager_1.lspManager.getStatus(language, projectPath);
});
// 发送 LSP 请求
electron_1.ipcMain.handle('lsp:request', async (_e, language, method, params, projectPath) => {
    try {
        const result = await lsp_manager_1.lspManager.sendLspRequest(language, method, params, projectPath);
        return { success: true, result };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// 发送 LSP 通知
electron_1.ipcMain.handle('lsp:notify', async (_e, language, method, params, projectPath) => {
    lsp_manager_1.lspManager.sendLspNotification(language, method, params, projectPath);
    return { success: true };
});
// 检查语言服务器是否可用 (系统中有无安装)
electron_1.ipcMain.handle('lsp:available', async (_e, language) => {
    return lsp_manager_1.lspManager.isAvailable(language);
});
// 获取安装指引
electron_1.ipcMain.handle('lsp:installGuide', async (_e, language) => {
    return lsp_manager_1.lspManager.getInstallGuide(language);
});
// 设置LSP消息回调 — 将服务器消息转发给渲染进程
let lspMessageCallback = null;
lsp_manager_1.lspManager.onServerMessage = (language, message) => {
    if (lspMessageCallback) {
        // 通过 webContents.send 发送到渲染进程
        const win = electron_1.BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
            win.webContents.send('lsp:message', { language, message });
        }
    }
};
// 应用退出时清理所有服务器
process.on('before-quit', () => {
    lsp_manager_1.lspManager.shutdownAll();
});
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MCP 工具 IPC 处理
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
electron_1.ipcMain.handle('mcp:listTools', async () => {
    return (0, mcp_tools_1.listTools)();
});
electron_1.ipcMain.handle('mcp:callTool', async (_e, call, projectPath, extraContext) => {
    return (0, mcp_tools_1.executeTool)(call, projectPath, extraContext);
});
// ── AI Chat with Tools (function calling) ──
electron_1.ipcMain.handle('ai:send-with-tools', async (event, messages, options) => {
    const config = getModelConfig();
    const adapter = createAdapterWithUsage(config);
    adapter.setSystemRules(projectRules);
    const win = electron_1.BrowserWindow.fromWebContents(event.sender);
    // 自主 Agent 循环：最多 8 轮工具调用（Claude Code 默认是 5-7）
    const MAX_TOOL_ROUNDS = 8;
    // 单个工具结果最大 token（~3000 token ≈ 8000 字符代码）
    const MAX_TOOL_RESULT_CHARS = 8000;
    // Add tools to the request
    const tools = (0, mcp_tools_1.listTools)().map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    let conversation = [...messages];
    // 通知渲染进程：自主循环开始
    if (!win.isDestroyed()) {
        win.webContents.send('ai-stream-chunk', JSON.stringify({ type: 'agent_loop_start', maxRounds: MAX_TOOL_ROUNDS }));
    }
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        // 通知渲染进程当前轮次
        if (!win.isDestroyed()) {
            win.webContents.send('ai-stream-chunk', JSON.stringify({ type: 'agent_round', round: round + 1, maxRounds: MAX_TOOL_ROUNDS }));
        }
        // Build request body
        const body = JSON.stringify({
            model: options?.model || config.model || 'deepseek-v4-pro',
            messages: conversation.filter(m => m.role !== 'system'),
            tools,
            tool_choice: 'auto',
            stream: false,
        });
        const response = await fetch(`${(config.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, '')}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
            body,
        });
        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            throw new Error(`AI API error (${response.status}): ${errText.slice(0, 200)}`);
        }
        const json = await response.json();
        const choice = json.choices?.[0];
        if (!choice || !choice.message)
            throw new Error('No response from AI');
        const msg = choice.message;
        // Check for tool_calls
        if (msg.tool_calls && msg.tool_calls.length > 0) {
            // Add assistant message with tool_calls to conversation
            conversation.push({ role: 'assistant', content: msg.content || '', tool_calls: msg.tool_calls });
            // Execute each tool call
            for (const tc of msg.tool_calls) {
                const toolCall = {
                    id: tc.id,
                    name: tc.function.name,
                    arguments: JSON.parse(tc.function.arguments || '{}'),
                };
                // Notify renderer: tool call start
                if (!win.isDestroyed()) {
                    win.webContents.send('ai-stream-chunk', JSON.stringify({
                        type: 'tool_call',
                        name: toolCall.name,
                        args: toolCall.arguments,
                        id: toolCall.id,
                        round: round + 1,
                    }));
                }
                // Execute tool
                const result = await (0, mcp_tools_1.executeTool)(toolCall, currentProjectPath || process.cwd());
                // Truncate result to avoid token overflow, but keep enough context
                const truncatedResult = result.result.length > MAX_TOOL_RESULT_CHARS
                    ? result.result.slice(0, MAX_TOOL_RESULT_CHARS) + '\n\n[输出已截断以节省 token，如需查看完整结果请单独调用工具]'
                    : result.result;
                // Notify renderer: tool result
                if (!win.isDestroyed()) {
                    win.webContents.send('ai-stream-chunk', JSON.stringify({
                        type: 'tool_result',
                        id: toolCall.id,
                        name: toolCall.name,
                        result: truncatedResult,
                        error: result.error,
                        wasTruncated: result.result.length > MAX_TOOL_RESULT_CHARS,
                        round: round + 1,
                    }));
                }
                // Add tool result to conversation
                conversation.push({
                    role: 'tool',
                    tool_call_id: tc.id,
                    name: tc.function.name,
                    content: result.error || truncatedResult,
                });
            }
            continue; // Another round to get final response
        }
        // Final response (no more tool calls)
        const finalContent = msg.content || '';
        if (!win.isDestroyed()) {
            // 先发送结束信号，再发送内容（渲染进程可区分）
            win.webContents.send('ai-stream-chunk', JSON.stringify({ type: 'agent_loop_end', rounds: round + 1 }));
            win.webContents.send('ai-stream-chunk', finalContent);
            win.webContents.send('ai-stream-end', '');
        }
        return finalContent;
    }
    // Max rounds reached
    const warning = '[⚠️ 工具调用已达到最大轮数（8轮），请检查是否存在循环调用问题]\n';
    if (!win.isDestroyed()) {
        win.webContents.send('ai-stream-chunk', warning);
        win.webContents.send('ai-stream-end', '');
    }
    throw new Error('AI 工具调用超过最大轮数（8轮），可能存在循环');
});
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Git Blame
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
electron_1.ipcMain.handle('git:blame', async (_e, filePath, projectPath) => {
    try {
        const { execSync } = require('child_process');
        const result = execSync(`git blame --date=short -l "${filePath}"`, {
            cwd: projectPath,
            timeout: 10000,
            encoding: 'utf-8',
        });
        // Parse: ^abc1234 (Author Name 2024-01-15 42) code
        const lines = result.split('\n').filter((l) => l.trim());
        const blames = [];
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^([0-9a-f^]+)\s+\(([^)]+)\s+(\d{4}-\d{2}-\d{2})\s+(\d+)\)\s*(.*)$/);
            if (m) {
                blames.push({ hash: m[1], author: m[2].trim(), date: m[3], line: i + 1, code: m[5] });
            }
        }
        return { success: true, blames };
    }
    catch (err) {
        return { success: false, error: err.message };
    }
});
// ── API 配置管理 ──
electron_1.ipcMain.handle('apiConfigs:get', async () => {
    return {
        configs: store.get('apiConfigs', []),
        activeId: store.get('activeApiConfigId', ''),
    };
});
electron_1.ipcMain.handle('apiConfigs:save', async (_e, data) => {
    store.set('apiConfigs', data.configs);
    store.set('activeApiConfigId', data.activeId);
    return { success: true };
});
