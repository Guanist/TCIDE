/**
 * TCIDE Electron → Python Backend Bridge Shim
 * 
 * Replaces window.electron / window.api (Electron IPC) with fetch() calls
 * to the FastAPI Python backend. Inject this BEFORE the main bundle loads.
 */
(function() {
  'use strict';

  const API_BASE = 'http://127.0.0.1:18420';

  async function apiCall(method, path, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      if (body instanceof FormData) {
        opts.body = body;
      } else {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      }
    }
    try {
      const resp = await fetch(API_BASE + path, opts);
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        return { error: `HTTP ${resp.status}: ${text}` };
      }
      return await resp.json();
    } catch (e) {
      return { error: e.message || String(e) };
    }
  }

  function qp(params) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    return parts.length ? '?' + parts.join('&') : '';
  }

  // Event emitter for .on() subscriptions
  const listeners = {};
  function emit(event, data) {
    (listeners[event] || []).forEach(fn => { try { fn(data); } catch(e) {} });
  }

  // ── window.api shim ──
  window.api = {
    // ── Project ──
    openProject: (p) => apiCall('POST', '/api/project/open' + qp({path: p})),
    openFileDialog: () => apiCall('GET', '/api/project/dialog'),
    openFolder: (p) => apiCall('POST', '/api/project/open' + qp({path: p})),
    watchProject: () => apiCall('GET', '/api/project/watch'),
    getProjectRules: () => apiCall('GET', '/api/project/rules'),
    setProjectRules: (r) => apiCall('POST', '/api/project/rules', {rules: r}),

    // ── Files ──
    readFile: (p) => apiCall('GET', '/api/files/read' + qp({path: p})),
    readTextFile: (p) => apiCall('GET', '/api/files/read' + qp({path: p})),
    writeFile: (p, c) => apiCall('POST', '/api/files/write', {path: p, content: c}),
    createDir: (p) => apiCall('POST', '/api/files/mkdir' + qp({path: p})),
    deleteFile: (p) => apiCall('POST', '/api/files/delete' + qp({path: p})),
    renameFile: (o, n) => apiCall('POST', '/api/files/rename', {old_path: o, new_path: n}),
    readDirectory: (p) => apiCall('GET', '/api/files/list' + qp({path: p})),
    readFileAsDataURL: (p) => apiCall('GET', '/api/files/read' + qp({path: p, as_base64: true})),
    readHex: (p, o, l) => apiCall('GET', '/api/files/hex' + qp({path: p, offset: o, length: l})),
    readPdfBase64: (p) => apiCall('GET', '/api/files/read' + qp({path: p, as_base64: true})),
    readDocxText: (p) => apiCall('GET', '/api/files/read' + qp({path: p})),
    formatFile: (p) => apiCall('POST', '/api/files/format' + qp({path: p})),
    openSystemFile: (p) => apiCall('POST', '/api/files/open' + qp({path: p})),
    showItemInFolder: (p) => apiCall('POST', '/api/files/show' + qp({path: p})),
    openBrowser: (u) => apiCall('POST', '/api/files/open-url' + qp({url: u})),
    openExternal: (u) => apiCall('POST', '/api/files/open-url' + qp({url: u})),

    // ── AI ──
    sendToAI: (msgs, opts) => apiCall('POST', '/api/ai/chat', {messages: msgs, ...opts}),
    sendToAIStream: (msgs, opts) => {
      // For streaming, use fetch with ReadableStream
      return fetch(API_BASE + '/api/ai/chat/stream', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({messages: msgs, ...opts})
      }).then(r => r.body.getReader());
    },
    sendToAIWithTools: (msgs, opts) => apiCall('POST', '/api/ai/chat/tools', {messages: msgs, ...opts}),
    aiComplete: (p, c) => apiCall('POST', '/api/ai/complete', {prefix: p, context: c}),
    abortAI: () => apiCall('POST', '/api/ai/abort'),
    testModelConnection: (cfg) => apiCall('POST', '/api/ai/test', cfg),
    getTaskSession: () => apiCall('GET', '/api/ai/task-session'),

    // ── Git ──
    getGitStatus: () => apiCall('GET', '/api/git/status'),
    getGitBranch: () => apiCall('GET', '/api/git/branch'),
    gitListBranches: () => apiCall('GET', '/api/git/branches'),
    gitCheckout: (b) => apiCall('POST', '/api/git/checkout' + qp({branch: b})),
    commit: (msg) => apiCall('POST', '/api/git/commit', {message: msg}),
    stageAll: () => apiCall('POST', '/api/git/stage-all'),
    pull: () => apiCall('POST', '/api/git/pull'),
    push: () => apiCall('POST', '/api/git/push'),
    getDiff: (p) => apiCall('GET', '/api/git/diff' + qp({path: p})),

    // ── LSP ──
    lspStart: (lang) => apiCall('POST', '/api/lsp/start' + qp({language: lang})),
    lspStop: (lang) => apiCall('POST', '/api/lsp/stop' + qp({language: lang})),
    lspRequest: (lang, method, params) => apiCall('POST', '/api/lsp/request', {language: lang, method: method, params: params}),
    lspAvailable: () => apiCall('GET', '/api/lsp/servers'),
    lspNotify: (lang, method, params) => apiCall('POST', '/api/lsp/notify', {language: lang, method: method, params: params}),
    lspInstallGuide: (lang) => apiCall('GET', '/api/lsp/install-guide' + qp({language: lang})),
    onLspMessage: (fn) => { (listeners['lsp-message'] = listeners['lsp-message'] || []).push(fn); },
    offLspMessage: (fn) => { listeners['lsp-message'] = (listeners['lsp-message'] || []).filter(f => f !== fn); },

    // ── Memory ──
    memoryInit: (p) => apiCall('POST', '/api/memory/init' + qp({project: p})),
    memoryGetInjection: () => apiCall('GET', '/api/memory/context'),

    // ── Vector ──
    vectorInit: (p) => apiCall('POST', '/api/vector/init' + qp({project: p})),
    vectorIndexAll: () => apiCall('POST', '/api/vector/index-all'),

    // ── Entropy ──
    entropyInit: (p) => apiCall('POST', '/api/entropy/init' + qp({project: p})),
    entropyEvaluate: (p) => apiCall('GET', '/api/entropy/evaluate' + qp({path: p})),
    entropyCtrlInit: () => apiCall('POST', '/api/entropy/ctrl/init'),
    entropyCtrlTick: () => apiCall('POST', '/api/entropy/ctrl/tick'),
    entropyCtrlGetSessionRecommendation: () => apiCall('GET', '/api/entropy/ctrl/recommendation'),
    onEntropyProgress: (fn) => { (listeners['entropy-progress'] = listeners['entropy-progress'] || []).push(fn); },

    // ── Warehouse ──
    warehouseInit: (p) => apiCall('POST', '/api/warehouse/init' + qp({project: p})),
    warehouseAnalyzeAll: () => apiCall('POST', '/api/warehouse/analyze-all'),
    warehouseGetCallChain: (f) => apiCall('GET', '/api/warehouse/call-chain' + qp({file: f})),
    warehouseGetImpactAnalysis: (f) => apiCall('GET', '/api/warehouse/impact' + qp({file: f})),

    // ── Runner ──
    runnerInit: (p) => apiCall('POST', '/api/runner/init' + qp({project: p})),
    runnerExecute: (task) => apiCall('POST', '/api/runner/execute', {task: task}),
    onRunnerLog: (fn) => { (listeners['runner-log'] = listeners['runner-log'] || []).push(fn); },
    onRunnerStepChange: (fn) => { (listeners['runner-step'] = listeners['runner-step'] || []).push(fn); },

    // ── Orchestrator ──
    orchestratorInit: (p) => apiCall('POST', '/api/orchestrator/init' + qp({project: p})),
    orchestratorRun: (task) => apiCall('POST', '/api/orchestrator/run', {task: task}),
    onOrchestratorPhase: (fn) => { (listeners['orchestrator-phase'] = listeners['orchestrator-phase'] || []).push(fn); },
    onOrchestratorTaskProgress: (fn) => { (listeners['orchestrator-progress'] = listeners['orchestrator-progress'] || []).push(fn); },

    // ── Builder/Coder ──
    runBuilder: (task) => apiCall('POST', '/api/ai/build', {task: task}),
    runCoder: (task) => apiCall('POST', '/api/ai/code', {task: task}),

    // ── Usage ──
    getUsageToday: () => apiCall('GET', '/api/usage/stats'),
    getUsageTotal: () => apiCall('GET', '/api/usage/stats'),
    getUsageByProject: (p) => apiCall('GET', '/api/usage/history' + qp({project: p})),
    getUsageByDate: (d) => apiCall('GET', '/api/usage/history' + qp({days: d || 30})),

    // ── Snapshot ──
    listSnapshots: (p) => apiCall('GET', '/api/snapshot/list' + qp({project_path: p})),
    restoreSnapshot: (id) => apiCall('POST', '/api/snapshot/restore' + qp({snapshot_id: id})),

    // ── Settings ──
    getModelConfig: () => apiCall('GET', '/api/settings/ai'),
    saveModelConfig: (cfg) => apiCall('POST', '/api/settings/ai', cfg),
    getModelMeta: () => apiCall('GET', '/api/settings'),
    listModelMeta: () => apiCall('GET', '/api/settings/models'),
    exportConfig: () => apiCall('GET', '/api/settings'),
    importConfig: (cfg) => apiCall('POST', '/api/settings', cfg),

    // ── Debug ──
    // Debug uses Electron IPC directly (ipcRenderer.invoke)
    // These need special handling
    ...(function() {
      const debugHandler = {
        get(target, prop) {
          if (prop === 'startSession') return (adapter, file, line) => apiCall('POST', '/api/debug/start', {adapter, file, line});
          if (prop === 'stopSession') return () => apiCall('POST', '/api/debug/stop');
          if (prop === 'continue') return (sid) => apiCall('POST', '/api/debug/continue' + qp({session: sid}));
          if (prop === 'pause') return (sid) => apiCall('POST', '/api/debug/pause' + qp({session: sid}));
          if (prop === 'next') return (sid) => apiCall('POST', '/api/debug/next' + qp({session: sid}));
          if (prop === 'stepIn') return (sid) => apiCall('POST', '/api/debug/step-in' + qp({session: sid}));
          if (prop === 'stepOut') return (sid) => apiCall('POST', '/api/debug/step-out' + qp({session: sid}));
          if (prop === 'evaluate') return (sid, expr) => apiCall('POST', '/api/debug/evaluate', {session: sid, expression: expr});
          if (prop === 'setBreakpoints') return (sid, file, bps) => apiCall('POST', '/api/debug/breakpoints', {session: sid, file, breakpoints: bps});
          if (prop === 'getAdapters') return () => apiCall('GET', '/api/debug/adapters');
          return undefined;
        }
      };
      return { debug: new Proxy({}, debugHandler) };
    })(),

    // ── Gradle ──
    gradleExec: (task) => apiCall('POST', '/api/exec', {command: 'gradle ' + task}),

    // ── Lint ──
    lintFile: (p) => apiCall('GET', '/api/lint' + qp({path: p})),

    // ── Architecture ──
    analyzeArchitecture: () => apiCall('GET', '/api/warehouse/analyze-all'),

    // ── Chunker ──
    chunkerChunkFile: (p) => apiCall('GET', '/api/chunker/chunk' + qp({file_path: p})),
    chunkerNeedsChunking: (p) => apiCall('GET', '/api/chunker/needs-chunking' + qp({file_path: p})),

    // ── Batch Search ──
    batchSearch: (q) => apiCall('POST', '/api/search/batch', {query: q}),

    // ── Snapshot (extended) ──
    saveSession: (data) => apiCall('POST', '/api/session/save', data),
    restoreSession: (id) => apiCall('POST', '/api/session/restore' + qp({id: id})),

    // ── Event system ──
    on: (event, fn) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
    },
    removeListener: (event, fn) => {
      listeners[event] = (listeners[event] || []).filter(f => f !== fn);
    },

    // ── Balance warning ──
    onBalanceWarning: (fn) => { (listeners['balance-warning'] = listeners['balance-warning'] || []).push(fn); },

    // ── File changed ──
    onFileChanged: (fn) => { (listeners['file-changed'] = listeners['file-changed'] || []).push(fn); },

    // ── Lint diagnostics ──
    onLintDiagnostics: (fn) => { (listeners['lint-diagnostics'] = listeners['lint-diagnostics'] || []).push(fn); },

    // ── Debug events ──
    onDebugEvent: (fn) => { (listeners['debug-event'] = listeners['debug-event'] || []).push(fn); },
  };

  // ── WebSocket for real-time events ──
  let ws = null;
  function connectWS() {
    try {
      ws = new WebSocket('ws://127.0.0.1:18420/ws/events');
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.event) emit(msg.event, msg.data);
        } catch(err) {}
      };
      ws.onclose = () => setTimeout(connectWS, 3000);
      ws.onerror = () => {};
    } catch(e) {}
  }
  connectWS();

  console.log('[TCIDE] Electron shim loaded — API bridged to Python backend');
})();

