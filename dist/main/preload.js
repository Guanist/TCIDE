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
    getApiConfigs: () => electron_1.ipcRenderer.invoke('apiConfigs:get'),
    saveApiConfigs: (data) => electron_1.ipcRenderer.invoke('apiConfigs:save', data),
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
            'debug:event',
            'lint:diagnostics',
            'lint:projectProgress',
            'runner:log',
            'runner:step',
            'entropy:progress',
            'orchestrator:phase',
            'orchestrator:taskProgress',
            'warehouse:progress',
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
    // ── LSP 语言服务 ──
    lspStart: (language, projectPath) => electron_1.ipcRenderer.invoke('lsp:start', language, projectPath),
    lspStop: (language, projectPath) => electron_1.ipcRenderer.invoke('lsp:stop', language, projectPath),
    lspStatus: (language, projectPath) => electron_1.ipcRenderer.invoke('lsp:status', language, projectPath),
    lspRequest: (language, method, params, projectPath) => electron_1.ipcRenderer.invoke('lsp:request', language, method, params, projectPath),
    lspNotify: (language, method, params, projectPath) => electron_1.ipcRenderer.invoke('lsp:notify', language, method, params, projectPath),
    lspAvailable: (language) => electron_1.ipcRenderer.invoke('lsp:available', language),
    lspInstallGuide: (language) => electron_1.ipcRenderer.invoke('lsp:installGuide', language),
    onLspMessage: (callback) => {
        electron_1.ipcRenderer.on('lsp:message', (_e, data) => callback(data));
    },
    offLspMessage: () => {
        electron_1.ipcRenderer.removeAllListeners('lsp:message');
    },
    // ── Git Blame ──
    gitBlame: (filePath, projectPath) => electron_1.ipcRenderer.invoke('git:blame', filePath, projectPath),
    gitListBranches: (projectPath) => electron_1.ipcRenderer.invoke('git:listBranches', projectPath),
    gitCheckout: (branch, projectPath) => electron_1.ipcRenderer.invoke('git:checkout', branch, projectPath),
    // ── MCP 工具 ──
    mcpListTools: () => electron_1.ipcRenderer.invoke('mcp:listTools'),
    mcpCallTool: (call, projectPath, extraContext) => electron_1.ipcRenderer.invoke('mcp:callTool', call, projectPath, extraContext),
    sendToAIWithTools: (messages, options) => electron_1.ipcRenderer.invoke('ai:send-with-tools', messages, options),

    // ═══════════════════════════════════════════════
    // P0: Debug
    // ═══════════════════════════════════════════════
    debugGetAdapters: () => electron_1.ipcRenderer.invoke('debug:getAdapters'),
    debugStartSession: (type, program, cwd, options) => electron_1.ipcRenderer.invoke('debug:startSession', type, program, cwd, options),
    debugStopSession: (sessionId) => electron_1.ipcRenderer.invoke('debug:stopSession', sessionId),
    debugSetBreakpoints: (sessionId, filePath, breakpoints) => electron_1.ipcRenderer.invoke('debug:setBreakpoints', sessionId, filePath, breakpoints),
    debugContinue: (sessionId) => electron_1.ipcRenderer.invoke('debug:continue', sessionId),
    debugNext: (sessionId) => electron_1.ipcRenderer.invoke('debug:next', sessionId),
    debugStepIn: (sessionId) => electron_1.ipcRenderer.invoke('debug:stepIn', sessionId),
    debugStepOut: (sessionId) => electron_1.ipcRenderer.invoke('debug:stepOut', sessionId),
    debugPause: (sessionId) => electron_1.ipcRenderer.invoke('debug:pause', sessionId),
    debugEvaluate: (sessionId, expression, frameId) => electron_1.ipcRenderer.invoke('debug:evaluate', sessionId, expression, frameId),
    debugGetThreads: (sessionId) => electron_1.ipcRenderer.invoke('debug:getThreads', sessionId),
    debugGetStackTrace: (sessionId, threadId) => electron_1.ipcRenderer.invoke('debug:getStackTrace', sessionId, threadId),
    debugGetScopes: (sessionId, frameId) => electron_1.ipcRenderer.invoke('debug:getScopes', sessionId, frameId),
    debugGetVariables: (sessionId, variablesRef) => electron_1.ipcRenderer.invoke('debug:getVariables', sessionId, variablesRef),
    debugGetConsoleOutput: (sessionId) => electron_1.ipcRenderer.invoke('debug:getConsoleOutput', sessionId),
    onDebugEvent: (callback) => { electron_1.ipcRenderer.on('debug:event', (_e, data) => callback(data)); },

    // ═══════════════════════════════════════════════
    // P0: Lint
    // ═══════════════════════════════════════════════
    lintIsInstalled: (projectRoot, tool) => electron_1.ipcRenderer.invoke('lint:isInstalled', projectRoot, tool),
    lintGetInstallGuide: (tool) => electron_1.ipcRenderer.invoke('lint:getInstallGuide', tool),
    lintFile: (filePath, projectRoot) => electron_1.ipcRenderer.invoke('lint:lintFile', filePath, projectRoot),
    formatFile: (filePath, projectRoot) => electron_1.ipcRenderer.invoke('lint:formatFile', filePath, projectRoot),
    lintProject: (projectRoot) => electron_1.ipcRenderer.invoke('lint:lintProject', projectRoot),
    lintFixAll: (projectRoot, filePaths) => electron_1.ipcRenderer.invoke('lint:fixAll', projectRoot, filePaths),
    lintGetFileSummary: (filePath) => electron_1.ipcRenderer.invoke('lint:getFileSummary', filePath),
    lintGetProjectSummary: () => electron_1.ipcRenderer.invoke('lint:getProjectSummary'),
    onLintDiagnostics: (callback) => { electron_1.ipcRenderer.on('lint:diagnostics', (_e, data) => callback(data)); },
    onLintProgress: (callback) => { electron_1.ipcRenderer.on('lint:projectProgress', (_e, data) => callback(data)); },

    // ═══════════════════════════════════════════════
    // P0: Chunker
    // ═══════════════════════════════════════════════
    chunkerNeedsChunking: (filePath) => electron_1.ipcRenderer.invoke('chunker:needsChunking', filePath),
    chunkerChunkFile: (filePath) => electron_1.ipcRenderer.invoke('chunker:chunkFile', filePath),
    chunkerGetChunkIndex: (filePath, lineNumber) => electron_1.ipcRenderer.invoke('chunker:getChunkIndex', filePath, lineNumber),
    chunkerGetViewportChunks: (filePath, startLine, endLine) => electron_1.ipcRenderer.invoke('chunker:getViewportChunks', filePath, startLine, endLine),
    chunkerGetPreview: (filePath) => electron_1.ipcRenderer.invoke('chunker:getPreview', filePath),
    chunkerInvalidate: (filePath) => electron_1.ipcRenderer.invoke('chunker:invalidate', filePath),

    // ═══════════════════════════════════════════════
    // P0: Context Trimmer
    // ═══════════════════════════════════════════════
    contextInit: (projectRoot) => electron_1.ipcRenderer.invoke('context:init', projectRoot),
    contextStartTrim: () => electron_1.ipcRenderer.invoke('context:startTrim'),
    contextStopTrim: () => electron_1.ipcRenderer.invoke('context:stopTrim'),
    contextTrim: (messages) => electron_1.ipcRenderer.invoke('context:trim', messages),
    contextExtractSummary: (messages) => electron_1.ipcRenderer.invoke('context:extractSummary', messages),
    contextGetStats: () => electron_1.ipcRenderer.invoke('context:getStats'),
    contextCachePrompt: (key, content) => electron_1.ipcRenderer.invoke('context:cachePrompt', key, content),
    contextGetPrompt: (key) => electron_1.ipcRenderer.invoke('context:getPrompt', key),

    // ═══════════════════════════════════════════════
    // P0: AutoHeal
    // ═══════════════════════════════════════════════
    autohealParseErrors: (output, projectRoot) => electron_1.ipcRenderer.invoke('autoheal:parseErrors', output, projectRoot),
    autohealAbort: () => electron_1.ipcRenderer.invoke('autoheal:abort'),

    // ═══════════════════════════════════════════════
    // P0: Batch Modifier
    // ═══════════════════════════════════════════════
    batchCollectFiles: (projectRoot, filter) => electron_1.ipcRenderer.invoke('batch:collectFiles', projectRoot, filter),
    batchSearch: (projectRoot, pattern, options) => electron_1.ipcRenderer.invoke('batch:search', projectRoot, pattern, options),
    batchPreview: (projectRoot, search, replace, options) => electron_1.ipcRenderer.invoke('batch:preview', projectRoot, search, replace, options),
    batchApply: (projectRoot, search, replace, options) => electron_1.ipcRenderer.invoke('batch:apply', projectRoot, search, replace, options),
    batchRefactor: (projectRoot, oldName, newName, language, options) => electron_1.ipcRenderer.invoke('batch:refactor', projectRoot, oldName, newName, language, options),
    batchRollback: (backupId) => electron_1.ipcRenderer.invoke('batch:rollback', backupId),
    batchListBackups: () => electron_1.ipcRenderer.invoke('batch:listBackups'),
    batchClearBackup: (backupId) => electron_1.ipcRenderer.invoke('batch:clearBackup', backupId),

    // ═══════════════════════════════════════════════
    // P0: Perf Optimizer
    // ═══════════════════════════════════════════════
    perfGetMetrics: () => electron_1.ipcRenderer.invoke('perf:getMetrics'),
    perfResetMetrics: () => electron_1.ipcRenderer.invoke('perf:resetMetrics'),
    perfGcSweep: () => electron_1.ipcRenderer.invoke('perf:gcSweep'),

    // === P1: Vector Index ===
    vectorInit: (projectRoot) => electron_1.ipcRenderer.invoke('vector:init', projectRoot),
    vectorIndexAll: () => electron_1.ipcRenderer.invoke('vector:indexAll'),
    vectorSearch: (query, options) => electron_1.ipcRenderer.invoke('vector:search', query, options),
    vectorSearchSymbol: (name, options) => electron_1.ipcRenderer.invoke('vector:searchSymbol', name, options),
    vectorGetStats: () => electron_1.ipcRenderer.invoke('vector:getStats'),
    vectorGetDependencies: (filePath) => electron_1.ipcRenderer.invoke('vector:getDependencies', filePath),

    // === P1: Project Memory ===
    memoryInit: (projectRoot) => electron_1.ipcRenderer.invoke('memory:init', projectRoot),
    memoryGetInjection: () => electron_1.ipcRenderer.invoke('memory:getInjection'),
    memoryRecordRefactor: (type, desc, oldCode, newCode, fp) => electron_1.ipcRenderer.invoke('memory:recordRefactor', type, desc, oldCode, newCode, fp),
    memorySearchPatterns: (query) => electron_1.ipcRenderer.invoke('memory:searchPatterns', query),
    memoryGetTimeline: () => electron_1.ipcRenderer.invoke('memory:getTimeline'),

    // === P1: Semantic Completion ===
    completionInit: (projectRoot) => electron_1.ipcRenderer.invoke('completion:init', projectRoot),
    completionGet: (params) => electron_1.ipcRenderer.invoke('completion:get', params),
    completionInvalidateCache: (fp) => electron_1.ipcRenderer.invoke('completion:invalidateCache', fp),

    // === P1: Git Intelligence ===
    gitintelInit: (projectRoot) => electron_1.ipcRenderer.invoke('gitintel:init', projectRoot),
    gitintelGenerateCommitMessage: (projectRoot, options) => electron_1.ipcRenderer.invoke('gitintel:generateCommitMessage', projectRoot, options),
    gitintelAnalyzeChanges: (projectRoot, baseRef, headRef) => electron_1.ipcRenderer.invoke('gitintel:analyzeChanges', projectRoot, baseRef, headRef),
    gitintelAnalyzeConflicts: (projectRoot, branch) => electron_1.ipcRenderer.invoke('gitintel:analyzeConflicts', projectRoot, branch),
    gitintelBlameHeatmap: (projectRoot, filePath) => electron_1.ipcRenderer.invoke('gitintel:blameHeatmap', projectRoot, filePath),
    gitintelGetFileOwners: (projectRoot, filePath) => electron_1.ipcRenderer.invoke('gitintel:getFileOwners', projectRoot, filePath),
    gitintelGetChangelog: (projectRoot, days) => electron_1.ipcRenderer.invoke('gitintel:getChangelog', projectRoot, days),

    // === P2: Agent Orchestrator ===
    orchestratorInit: (projectRoot) => electron_1.ipcRenderer.invoke('orchestrator:init', projectRoot),
    orchestratorRun: (requirement, context) => electron_1.ipcRenderer.invoke('orchestrator:run', requirement, context),
    orchestratorAbort: () => electron_1.ipcRenderer.invoke('orchestrator:abort'),
    orchestratorStatus: () => electron_1.ipcRenderer.invoke('orchestrator:status'),
    onOrchestratorPhase: (cb) => { electron_1.ipcRenderer.on('orchestrator:phase', (_e, d) => cb(d)); },
    onOrchestratorTaskProgress: (cb) => { electron_1.ipcRenderer.on('orchestrator:taskProgress', (_e, d) => cb(d)); },

    // === P2: Warehouse Analyzer ===
    warehouseInit: (projectRoot) => electron_1.ipcRenderer.invoke('warehouse:init', projectRoot),
    warehouseAnalyzeAll: () => electron_1.ipcRenderer.invoke('warehouse:analyzeAll'),
    warehouseGetCallChain: (symbolName, filePath, direction) => electron_1.ipcRenderer.invoke('warehouse:getCallChain', symbolName, filePath, direction),
    warehouseGetImpactAnalysis: (filePath) => electron_1.ipcRenderer.invoke('warehouse:getImpactAnalysis', filePath),
    warehouseFindSimilarCode: (snippet, minScore) => electron_1.ipcRenderer.invoke('warehouse:findSimilarCode', snippet, minScore),
    onWarehouseProgress: (cb) => { electron_1.ipcRenderer.on('warehouse:progress', (_e, d) => cb(d)); },

    // === P2: Unattended Runner ===
    runnerInit: (projectRoot) => electron_1.ipcRenderer.invoke('runner:init', projectRoot),
    runnerExecute: (plan) => electron_1.ipcRenderer.invoke('runner:execute', plan),
    runnerAbort: () => electron_1.ipcRenderer.invoke('runner:abort'),
    runnerGetHistory: (limit) => electron_1.ipcRenderer.invoke('runner:getHistory', limit),
    onRunnerLog: (cb) => { electron_1.ipcRenderer.on('runner:log', (_e, d) => cb(d)); },
    onRunnerStepChange: (cb) => { electron_1.ipcRenderer.on('runner:step', (_e, d) => cb(d)); },

    // === P3: Entropy Evaluator ===
    entropyInit: (projectRoot) => electron_1.ipcRenderer.invoke('entropy:init', projectRoot),
    entropyEvaluate: () => electron_1.ipcRenderer.invoke('entropy:evaluate'),
    entropyGetFileEntropy: (filePath) => electron_1.ipcRenderer.invoke('entropy:getFileEntropy', filePath),
    entropyGetProjectEntropy: () => electron_1.ipcRenderer.invoke('entropy:getProjectEntropy'),
    onEntropyProgress: (cb) => { electron_1.ipcRenderer.on('entropy:progress', (_e, d) => cb(d)); },

    // === P3: Smart Trimmer ===
    smartTrimmerInit: (projectRoot) => electron_1.ipcRenderer.invoke('smartTrimmer:init', projectRoot),
    smartTrimmerTrim: (messages, context) => electron_1.ipcRenderer.invoke('smartTrimmer:trim', messages, context),
    smartTrimmerSetProjectEntropy: (entropy) => electron_1.ipcRenderer.invoke('smartTrimmer:setProjectEntropy', entropy),
    smartTrimmerGetArchiveSummary: () => electron_1.ipcRenderer.invoke('smartTrimmer:getArchiveSummary'),

    // === P3: Entropy Controller ===
    entropyCtrlInit: (projectRoot) => electron_1.ipcRenderer.invoke('entropyCtrl:init', projectRoot),
    entropyCtrlTick: (state) => electron_1.ipcRenderer.invoke('entropyCtrl:tick', state),
    entropyCtrlGetSystemPromptInjection: () => electron_1.ipcRenderer.invoke('entropyCtrl:getSystemPromptInjection'),
    entropyCtrlGetSessionRecommendation: () => electron_1.ipcRenderer.invoke('entropyCtrl:getSessionRecommendation'),
    entropyCtrlGetTrimmingStrategy: () => electron_1.ipcRenderer.invoke('entropyCtrl:getTrimmingStrategy'),

    // === Dream Engine ===
    dreamInit: (projectRoot) => electron_1.ipcRenderer.invoke('dream:init', projectRoot),
    dreamTrigger: () => electron_1.ipcRenderer.invoke('dream:trigger'),
    dreamGetJournal: (limit) => electron_1.ipcRenderer.invoke('dream:getJournal', limit),
    dreamGetExpertMemory: (type) => electron_1.ipcRenderer.invoke('dream:getExpertMemory', type),
    dreamShouldDream: () => electron_1.ipcRenderer.invoke('dream:shouldDream'),
    dreamRecord: (entry) => electron_1.ipcRenderer.invoke('dream:record', entry),
    onDreamProgress: (cb) => { electron_1.ipcRenderer.on('dream:progress', (_e, d) => cb(d)); },
    onDreamComplete: (cb) => { electron_1.ipcRenderer.on('dream:complete', (_e, d) => cb(d)); },
};
electron_1.contextBridge.exposeInMainWorld('api', api);
