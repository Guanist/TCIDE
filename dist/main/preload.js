"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * PersonalIDE - Preload Script
 * 在渲染进程和主进程之间建立安全的 IPC 桥梁
 * contextIsolation: true → 渲染进程只能通过暴露的 API 访问主进程
 */
const electron_1 = require("electron");
// ─────────────────────────────────────────
// 暴露给渲染进程的 API
// ─────────────────────────────────────────
const api = {
    // ── 文件操作 ──
    readFile: (filePath) => electron_1.ipcRenderer.invoke('file:read', filePath),
    writeFile: (filePath, content) => electron_1.ipcRenderer.invoke('file:write', filePath, content),
    deleteFile: (filePath) => electron_1.ipcRenderer.invoke('file:delete', filePath),
    renameFile: (oldPath, newPath) => electron_1.ipcRenderer.invoke('file:rename', oldPath, newPath),
    createDirectory: (dirPath) => electron_1.ipcRenderer.invoke('file:mkdir', dirPath),
    readDirectory: (dirPath) => electron_1.ipcRenderer.invoke('file:readDir', dirPath),
    watchProject: (projectPath, enable) => electron_1.ipcRenderer.invoke('file:watch', projectPath, enable),
    onFileChanged: (callback) => {
        electron_1.ipcRenderer.on('file:changed', (_e, projectPath) => callback(projectPath));
    },
    getFileStats: (filePath) => electron_1.ipcRenderer.invoke('file:stats', filePath),
    // ── 项目操作 ──
    openProject: () => electron_1.ipcRenderer.invoke('project:open'),
    openProjectPath: (projectPath) => electron_1.ipcRenderer.invoke('project:openPath', projectPath),
    getProjectPath: () => electron_1.ipcRenderer.invoke('project:getPath'),
    // ── AI / 模型 ──
    sendToAI: (messages, options) => electron_1.ipcRenderer.invoke('ai:send', messages, options),
    sendToAIStream: (messages, options) => electron_1.ipcRenderer.invoke('ai:send-stream', messages, options),
    abortAI: () => electron_1.ipcRenderer.send('ai:abort'),
    getModelConfig: () => electron_1.ipcRenderer.invoke('model:getConfig'),
    saveModelConfig: (config) => electron_1.ipcRenderer.invoke('model:saveConfig', config),
    testModelConnection: (params) => electron_1.ipcRenderer.invoke('model:testConnection', params),
    // ── 模型元数据 ──
    listModelMeta: (provider) => electron_1.ipcRenderer.invoke('model:listMeta', provider),
    getModelMeta: (provider, modelId) => electron_1.ipcRenderer.invoke('model:getMeta', provider, modelId),
    // ── Builder / Coder ──
    runBuilder: (requirement, projectContext) => electron_1.ipcRenderer.invoke('agent:builder', requirement, projectContext),
    runCoder: (task, projectRoot) => electron_1.ipcRenderer.invoke('agent:coder', task, projectRoot),
    // ── 任务运行器 ──
    runTaskLoop: (tasks, projectRoot) => electron_1.ipcRenderer.invoke('task:runLoop', tasks, projectRoot),
    abortTaskLoop: () => electron_1.ipcRenderer.send('task:abortLoop'),
    // ── 终端 ──
    execCommand: (command, cwd) => electron_1.ipcRenderer.invoke('terminal:exec', command, cwd),
    onTerminalOutput: (callback) => {
        const listener = (_event, data) => callback(data);
        electron_1.ipcRenderer.on('terminal:output', listener);
        return () => electron_1.ipcRenderer.removeListener('terminal:output', listener);
    },
    writeToTerminal: (text) => electron_1.ipcRenderer.invoke('terminal:write', text),
    // ── 数据库（项目记忆） ──
    dbQuery: (sql, params) => electron_1.ipcRenderer.invoke('db:query', sql, params),
    dbRun: (sql, params) => electron_1.ipcRenderer.invoke('db:run', sql, params),
    // ── Token 用量统计 ──
    recordUsage: (rec) => electron_1.ipcRenderer.invoke('usage:record', rec),
    getUsageToday: () => electron_1.ipcRenderer.invoke('usage:getToday'),
    getUsageTotal: () => electron_1.ipcRenderer.invoke('usage:getTotal'),
    getUsageByProject: () => electron_1.ipcRenderer.invoke('usage:getByProject'),
    getUsageByDate: (days) => electron_1.ipcRenderer.invoke('usage:getByDate', days || 30),
    // ── 余额不足警告（主进程 → 渲染进程） ──
    onBalanceWarning: (callback) => {
        const listener = (_event, detail) => callback(detail);
        electron_1.ipcRenderer.on('usage:balance-warning', listener);
        return () => electron_1.ipcRenderer.removeListener('usage:balance-warning', listener);
    },
    // ── 工程兼容 ──
    loadProjectCompat: (projectRoot) => electron_1.ipcRenderer.invoke('compat:load', projectRoot),
    saveProjectCompat: (projectRoot, data) => electron_1.ipcRenderer.invoke('compat:save', projectRoot, data),
    // ── 系统 ──
    getSettings: () => electron_1.ipcRenderer.invoke('settings:get'),
    saveSettings: (settings) => electron_1.ipcRenderer.invoke('settings:save', settings),
    showItemInFolder: (path) => electron_1.ipcRenderer.invoke('system:showInFolder', path),
    getClipboardText: () => electron_1.ipcRenderer.invoke('system:getClipboardText'),
    // ── 文件快照（.ide-snapshots） ──
    saveSnapshot: (projectPath, taskId, filePath, content) => electron_1.ipcRenderer.invoke('snapshot:save', projectPath, taskId, filePath, content),
    listSnapshots: (projectPath, filePath) => electron_1.ipcRenderer.invoke('snapshot:list', projectPath, filePath),
    restoreSnapshot: (id) => electron_1.ipcRenderer.invoke('snapshot:restore', id),
    // ── 任务会话（断点续做） ──
    saveTaskSession: (projectPath, tasksJson, currentIndex) => electron_1.ipcRenderer.invoke('taskSession:save', projectPath, tasksJson, currentIndex),
    getTaskSession: (projectPath) => electron_1.ipcRenderer.invoke('taskSession:get', projectPath),
    clearTaskSession: (projectPath) => electron_1.ipcRenderer.invoke('taskSession:clear', projectPath),
    // ── Git 集成 ──
    getGitBranch: (projectPath) => electron_1.ipcRenderer.invoke('git:getBranch', projectPath),
    // ── AI 行为规则（CLAUDE.md） ──
    getProjectRules: (projectPath) => electron_1.ipcRenderer.invoke('config:getRules', projectPath),
    setProjectRules: (rules) => electron_1.ipcRenderer.invoke('config:setRules', rules),
    // ── AI 实时代码补全 ──
    aiComplete: (context, language) => electron_1.ipcRenderer.invoke('ai:complete', context, language),
    getGitUser: (projectPath) => electron_1.ipcRenderer.invoke('git:getUser', projectPath),
    getGitStatus: (projectPath) => electron_1.ipcRenderer.invoke('git:status', projectPath),
    stageAll: (projectPath) => electron_1.ipcRenderer.invoke('git:stageAll', projectPath),
    commit: (projectPath, message) => electron_1.ipcRenderer.invoke('git:commit', projectPath, message),
    push: (projectPath) => electron_1.ipcRenderer.invoke('git:push', projectPath),
    getDiff: (filePath, projectPath) => electron_1.ipcRenderer.invoke('git:diff', filePath, projectPath),
    pull: (projectPath) => electron_1.ipcRenderer.invoke('git:pull', projectPath),
    getGitLog: (projectPath, count) => electron_1.ipcRenderer.invoke('git:log', projectPath, count || 10),
    // ── 架构分析 ──
    analyzeArchitecture: (projectPath) => electron_1.ipcRenderer.invoke('arch:analyze', projectPath),
    // ── Gradle 快捷操作 ──
    gradleExec: (projectPath, task) => electron_1.ipcRenderer.invoke('gradle:exec', projectPath, task),
    // ── 附件上传 ──
    openFileDialog: () => electron_1.ipcRenderer.invoke('dialog:openFiles'),
    readTextFile: (filePath) => electron_1.ipcRenderer.invoke('file:readText', filePath),
    readFileAsDataURL: (filePath) => electron_1.ipcRenderer.invoke('file:readAsDataURL', filePath),
    readDocxText: (filePath) => electron_1.ipcRenderer.invoke('file:readDocx', filePath),
    readHex: (filePath, maxBytes) => electron_1.ipcRenderer.invoke('file:readHex', filePath, maxBytes),
    readPdfBase64: (filePath) => electron_1.ipcRenderer.invoke('file:readPdfBase64', filePath),
    readPdfDataUrl: (filePath) => electron_1.ipcRenderer.invoke('file:readPdfDataUrl', filePath),
    // ── 文件/目录操作 ──
    createDir: (dirPath) => electron_1.ipcRenderer.invoke('file:mkdir', dirPath),
    createFile: (filePath, content) => electron_1.ipcRenderer.invoke('file:create', filePath, content),
    // ── 会话持久化 ──
    saveSession: (state) => electron_1.ipcRenderer.invoke('session:save', state),
    restoreSession: () => electron_1.ipcRenderer.invoke('session:restore'),
    // ── 系统操作 ──
    openExternal: (target) => electron_1.ipcRenderer.invoke('system:openExternal', target),
    openBrowser: (url) => electron_1.ipcRenderer.invoke('system:openBrowser', url),
    openTerminal: (cwd) => electron_1.ipcRenderer.invoke('system:openTerminal', cwd),
    openFolder: (folderPath) => electron_1.ipcRenderer.invoke('system:openFolder', folderPath),
    openSystemFile: (filePath) => electron_1.ipcRenderer.invoke('system:openFile', filePath),
    getProjectRoot: () => electron_1.ipcRenderer.invoke('project:getRoot'),
    // ── 配置导入/导出 ──
    exportConfig: () => electron_1.ipcRenderer.invoke('config:export'),
    importConfig: () => electron_1.ipcRenderer.invoke('config:import'),
    // ── 事件监听 ──
    on: (channel, callback) => {
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
            electron_1.ipcRenderer.on(channel, callback);
        }
    },
    off: (channel, callback) => {
        electron_1.ipcRenderer.removeListener(channel, callback);
    },
    // ── 安全存储 ──
    encrypt: (plainText) => electron_1.ipcRenderer.invoke('crypto:encrypt', plainText),
    decrypt: (encrypted) => electron_1.ipcRenderer.invoke('crypto:decrypt', encrypted),
    // ── 项目搜索 ──
    searchInProject: (projectPath, query) => electron_1.ipcRenderer.invoke('search:project', projectPath, query),
    // ── 最近项目 ──
    getRecentProjects: () => electron_1.ipcRenderer.invoke('project:getRecent'),
    addRecentProject: (projectPath) => electron_1.ipcRenderer.invoke('project:addRecent', projectPath),
};
electron_1.contextBridge.exposeInMainWorld('api', api);
