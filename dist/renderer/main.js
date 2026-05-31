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
/**
* PersonalIDE - Renderer Main Entry
* 三栏 UI 交互、Monaco Editor、文件树、AI 面板全部逻辑
*/
const monaco = __importStar(require("monaco-editor"));
const xterm_1 = require("xterm");
const xterm_addon_fit_1 = require("xterm-addon-fit");
require("xterm/css/xterm.css");
const lsp_client_1 = require("./lsp-client");
const snippet_service_1 = require("./snippet-service");
// ── 轻量 Emmet 解析器 (内联, 避免外部依赖) ──
function expandEmmet(abbr, type) {
    // CSS 属性缩写
    if (type === 'stylesheet')
        return expandCssEmmet(abbr);
    return expandHtmlEmmet(abbr);
}
function expandCssEmmet(abbr) {
    const map = {
        m: 'margin:', p: 'padding:', w: 'width:', h: 'height:',
        w100: 'width:100%', h100: 'height:100%',
        m0: 'margin:0', p0: 'padding:0',
        ma: 'margin:auto',
        'bgc:': 'background-color:', 'c:': 'color:', 'fz:': 'font-size:',
        'd:b': 'display:block', 'd:f': 'display:flex', 'd:g': 'display:grid', 'd:n': 'display:none',
        'd:ib': 'display:inline-block',
        'fxdc': 'flex-direction:column', 'fxd': 'flex-direction:',
        'jcc': 'justify-content:center', 'jcsb': 'justify-content:space-between', 'jcsa': 'justify-content:space-around',
        'aic': 'align-items:center', 'aifs': 'align-items:flex-start',
        'tac': 'text-align:center', 'tal': 'text-align:left', 'tar': 'text-align:right',
        'posa': 'position:absolute', 'posr': 'position:relative', 'posf': 'position:fixed',
        'curp': 'cursor:pointer',
        'bd': 'border:', 'bdr:': 'border-radius:',
        'ovh': 'overflow:hidden', 'ova': 'overflow:auto',
        'trs:': 'transition:', 'trf:': 'transform:',
        'fs:': 'font-style:', 'fw:': 'font-weight:',
        'lh:': 'line-height:', 'ls:': 'letter-spacing:',
    };
    // 带值的缩写
    for (const [key, val] of Object.entries(map)) {
        if (abbr === key || abbr.startsWith(key)) {
            const suffix = abbr.slice(key.length);
            return val + suffix + ';';
        }
    }
    // 常见的数值+单位: w100 → width:100px; m10 → margin:10px;
    const unitMatch = abbr.match(/^([mpwh])(\d+)$/);
    if (unitMatch) {
        const props = { m: 'margin', p: 'padding', w: 'width', h: 'height' };
        return props[unitMatch[1]] + ':' + unitMatch[2] + 'px;';
    }
    return abbr;
}
function expandHtmlEmmet(abbr) {
    // 处理乘法: li*3 → <li></li><li></li><li></li>
    const multMatch = abbr.match(/^(.+?)\*(\d+)$/);
    if (multMatch) {
        const inner = expandHtmlEmmet(multMatch[1]);
        const count = parseInt(multMatch[2]);
        let result = '';
        const numMatch = inner.match(/\$(\d+)/g);
        for (let i = 1; i <= count; i++) {
            let part = inner;
            if (numMatch)
                numMatch.forEach(n => { part = part.replace(n, String(i)); });
            result += part;
        }
        return result;
    }
    // 处理子元素: div>p → <div><p></p></div>
    const childIdx = abbr.indexOf('>');
    if (childIdx > 0) {
        const parent = expandHtmlEmmet(abbr.substring(0, childIdx));
        const child = expandHtmlEmmet(abbr.substring(childIdx + 1));
        // 插入到闭合标签前
        const closeMatch = parent.match(/^(<\w+[^>]*>)(.*?)(<\/\w+>)$/s);
        if (closeMatch)
            return closeMatch[1] + child + closeMatch[3];
        return parent.replace(/><\/(\w+)>$/, '>' + child + '</$1>');
    }
    // 处理兄弟: div+p → <div></div><p></p>
    const sibIdx = abbr.indexOf('+');
    if (sibIdx > 0) {
        return expandHtmlEmmet(abbr.substring(0, sibIdx)) + expandHtmlEmmet(abbr.substring(sibIdx + 1));
    }
    // 处理上移: div^ → 结束当前层
    if (abbr.endsWith('^')) {
        return '</' + extractTag(abbr.slice(0, -1)) + '>';
    }
    // 基本标签展开
    return expandSingleTag(abbr);
}
function expandSingleTag(abbr) {
    // 提取标签名
    let tagMatch = abbr.match(/^([a-zA-Z][\w-]*)/);
    if (!tagMatch)
        return abbr;
    let tag = tagMatch[1];
    let rest = abbr.slice(tag.length);
    const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'area', 'base', 'col', 'embed', 'source', 'track', 'wbr']);
    let id = '', classes = '', attrs = '', text = '';
    // #id
    const idMatch = rest.match(/^#([\w-]+)/);
    if (idMatch) {
        id = ' id="' + idMatch[1] + '"';
        rest = rest.slice(idMatch[0].length);
    }
    // .class1.class2
    while (rest.startsWith('.')) {
        const clsMatch = rest.match(/^\.([\w-]+)/);
        if (clsMatch) {
            classes += ' ' + clsMatch[1];
            rest = rest.slice(clsMatch[0].length);
        }
        else
            break;
    }
    // [attr=val]
    while (rest.startsWith('[')) {
        const attrIdx = rest.indexOf(']');
        if (attrIdx < 0)
            break;
        attrs += ' ' + rest.substring(1, attrIdx);
        rest = rest.slice(attrIdx + 1);
    }
    // {text}
    if (rest.startsWith('{')) {
        const textIdx = rest.indexOf('}');
        if (textIdx > 0) {
            text = rest.substring(1, textIdx);
            rest = rest.slice(textIdx + 1);
        }
    }
    // $ placeholder (配合乘法)
    const numMatch = rest.match(/^\$(\d*)/);
    const num = numMatch ? (numMatch[1] || '1') : '';
    const classAttr = classes ? ' class="' + classes.trim() + '"' : '';
    if (rest.includes('*') || rest.includes('>') || rest.includes('+')) {
        // 还有后续操作符
        const remaining = rest;
        const baseTag = '<' + tag + id + classAttr + attrs + '>';
        const closeTag = '</' + tag + '>';
        // 先构建基础标签，然后用剩余部分继续展开
        return (VOID_TAGS.has(tag) ? baseTag.replace(/>$/, ' />') : baseTag + text + closeTag).replace(baseTag + text + closeTag, baseTag + text + expandHtmlEmmet(remaining.substring(1)) + closeTag);
    }
    if (VOID_TAGS.has(tag)) {
        return '<' + tag + id + classAttr + attrs + ' />';
    }
    return '<' + tag + id + classAttr + attrs + '>' + (text || '') + '</' + tag + '>';
}
function extractTag(abbr) {
    const m = abbr.match(/^([a-zA-Z][\w-]*)/);
    return m ? m[1] : 'div';
}
const IMG_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const TXT_EXTS = new Set(['.txt', '.js', '.ts', '.tsx', '.jsx', '.json', '.xml', '.html', '.css', '.md', '.py', '.go', '.rs', '.java', '.kt', '.kts', '.gradle', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.sh', '.bat', '.cmd', '.sql', '.log', '.csv']);
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_IMG_SIZE = 5 * 1024 * 1024; // 5 MB
const state = {
    projectPath: null,
    openFiles: [],
    activeFileIndex: -1,
    chatHistory: [], // 向后兼容
    chatSessions: [],
    currentSessionId: '',
    isStreaming: false,
    currentStreamContent: '',
    zenMode: false,
    sidebarWidth: 240,
    aiPanelWidth: 480,
    config: {
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: '',
        model: 'deepseek-v4-pro',
        builderModel: 'deepseek-reasoner',
        coderModel: 'deepseek-v4-pro',
    },
};
let attachments = [];
let editor = null;
let draggedTab = null;
let terminalInitialized = false;
// ─────────────────────────────────────────
// Monaco Editor 初始化
// ─────────────────────────────────────────
function initMonaco() {
    // 配置 Monaco(去除多余功能,保持轻量)
    self.MonacoEnvironment = {
        getWorker(_workerId, _label) {
            return new Worker(new URL('monaco-editor/esm/vs/editor/editor.worker.js', import.meta.url), { type: 'module' });
        },
    };
    // 注入暗色主题(老虎)
    monaco.editor.defineTheme('trae-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '6A9955' },
            { token: 'keyword', foreground: '569CD6' },
            { token: 'string', foreground: 'CE9178' },
            { token: 'number', foreground: 'B5CEA8' },
            { token: 'type', foreground: '4EC9B0' },
            { token: 'class', foreground: '4EC9B0' },
            { token: 'function', foreground: 'DCDCAA' },
        ],
        colors: {
            'editor.background': '#1E1E1E',
            'editor.foreground': '#D4D4D4',
            'editor.lineHighlightBackground': '#2A2D2E',
            'editor.selectionBackground': '#094771',
            'editorLineNumber.foreground': '#858585',
            'editorCursor.foreground': '#AEAFAD',
            'editorIndentGuide.background': '#3C3C3C',
            'editorWidget.background': '#252526',
            'editorSuggestWidget.background': '#252526',
            'editorSuggestWidget.border': '#3C3C3C',
            'scrollbar.shadow': '#00000000',
            'scrollbarSlider.background': '#42424280',
            'scrollbarSlider.hoverBackground': '#686868',
        },
    });
    // 注入浅色主题(白虎)
    monaco.editor.defineTheme('trae-light', {
        base: 'vs',
        inherit: true,
        rules: [
            { token: 'comment', foreground: '6D8B5E' },
            { token: 'keyword', foreground: '0451A5' },
            { token: 'string', foreground: 'A31515' },
            { token: 'number', foreground: '098658' },
            { token: 'type', foreground: '267F99' },
            { token: 'class', foreground: '267F99' },
            { token: 'function', foreground: '795E26' },
        ],
        colors: {
            'editor.background': '#FFFFFF',
            'editor.foreground': '#1E1E1E',
            'editor.lineHighlightBackground': '#F5F5F5',
            'editor.selectionBackground': '#DBE4F0',
            'editorLineNumber.foreground': '#999999',
            'editorCursor.foreground': '#333333',
            'editorIndentGuide.background': '#E0E0E0',
            'editorWidget.background': '#F5F5F5',
            'editorSuggestWidget.background': '#F5F5F5',
            'editorSuggestWidget.border': '#D0D0D0',
            'scrollbar.shadow': '#00000000',
            'scrollbarSlider.background': '#C0C0C060',
            'scrollbarSlider.hoverBackground': '#A0A0A0',
        },
    });
    const container = document.getElementById('monaco-container');
    editor = monaco.editor.create(container, {
        value: '',
        language: 'kotlin',
        theme: (() => { try {
            return localStorage.getItem('tcide-theme') === 'light' ? 'trae-light' : 'trae-dark';
        }
        catch {
            return 'trae-dark';
        } })(),
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
        fontLigatures: true,
        lineHeight: 22,
        letterSpacing: 0,
        minimap: { enabled: true, scale: 1, showSlider: 'mouseover', renderCharacters: false, maxColumn: 80 },
        scrollBeyondLastLine: false,
        glyphMargin: true,
        renderWhitespace: 'none',
        bracketPairColorization: { enabled: true },
        suggest: { showWords: false, showSnippets: true, showClasses: true, showFunctions: true, showVariables: true },
        quickSuggestions: { other: true, comments: false, strings: false },
        parameterHints: { enabled: true, cycle: true },
        padding: { top: 12, bottom: 12 },
        scrollbar: {
            verticalScrollbarSize: 6,
            horizontalScrollbarSize: 6,
        },
        overviewRulerLanes: 3,
        hideCursorInOverviewRuler: false,
        overviewRulerBorder: false,
        renderLineHighlight: 'line',
        smoothScrolling: false,
        mouseWheelZoom: false,
        cursorBlinking: 'solid',
        cursorSmoothCaretAnimation: 'off',
        wordWrap: 'off',
        automaticLayout: true,
        unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
    });
    // 暴露全局引用（供 p0/p1/p2-modules.js 使用）
    window.editor = editor;
    window.monaco = monaco;
    window.__tcide_projectRoot = () => state.projectPath;
    window.__lspGetDiagnostics = () => {
        // 返回所有模型的诊断 (Monaco 内置 + LSP 外部)
        const all = [];
        // Monaco 内置诊断 (所有已打开模型)
        try {
            all.push(...monaco.editor.getModelMarkers({}));
        }
        catch { }
        // LSP 外部诊断
        try {
            all.push(...(0, lsp_client_1.getAllDiagnostics)());
        }
        catch { }
        // 按 message+line+column 去重
        const seen = new Map();
        return all.filter(m => {
            const key = `${m.message}|${m.startLineNumber}|${m.startColumn}`;
            if (seen.has(key))
                return false;
            seen.set(key, true);
            return true;
        });
    };
    // ── Emmet 缩写展开 (Tab 触发 HTML/CSS/JSX/TSX) ──
    const EMMET_LANGS = new Set(['html', 'css', 'scss', 'less', 'javascriptreact', 'typescriptreact', 'vue', 'svelte', 'xml', 'xsl']);
    editor.addAction({
        id: 'tcide.emmet.expand',
        label: 'Emmet: Expand Abbreviation',
        keybindings: [monaco.KeyCode.Tab],
        run: (ed) => {
            const model = ed.getModel();
            if (!model)
                return;
            const lang = model.getLanguageId();
            if (!EMMET_LANGS.has(lang))
                return;
            const pos = ed.getPosition();
            if (!pos)
                return;
            const line = model.getLineContent(pos.lineNumber);
            const beforeCursor = line.substring(0, pos.column - 1);
            const abbrMatch = beforeCursor.match(/([\w#\.\[\]\{\}\>\+\*\^\$@\-:!()]+)$/);
            if (!abbrMatch)
                return;
            const abbr = abbrMatch[1];
            if (!/^[a-zA-Z#\.\[]/.test(abbr))
                return;
            if (abbr.length < 2)
                return;
            try {
                const expanded = expandEmmet(abbr, lang === 'css' || lang === 'scss' || lang === 'less' ? 'stylesheet' : 'markup');
                if (expanded && expanded !== abbr) {
                    const abbrStartCol = pos.column - abbr.length;
                    ed.executeEdits('emmet', [{
                            range: new monaco.Range(pos.lineNumber, abbrStartCol, pos.lineNumber, pos.column),
                            text: expanded,
                        }]);
                }
            }
            catch { /* ignore */ }
        },
    });
    // ── Snippets 初始化 ──
    (0, snippet_service_1.initSnippets)();
    window.__tcide_listSnippets = snippet_service_1.listSnippets;
    // 编辑器事件
    editor.onDidChangeModelContent(() => {
        if (state.activeFileIndex >= 0) {
            const model = editor.getModel();
            if (model) {
                state.openFiles[state.activeFileIndex].content = model.getValue();
                state.openFiles[state.activeFileIndex].dirty = true;
                const dirtyEl = document.getElementById('status-dirty');
                if (dirtyEl)
                    dirtyEl.style.display = '';
                // ⏳ 自动保存:3 秒无操作后保存
                scheduleAutoSave();
            }
        }
    });
    // 编辑器失焦时立即触发自动保存
    editor.onDidBlurEditorText(() => { doAutoSave(); });
    // ── LSP: 模型切换时通知语言服务器 ──
    let lspDidOpenSent = new Set();
    let lspPrevModelUri = '';
    editor.onDidChangeModel(() => {
        // 旧文件: didClose
        if (lspPrevModelUri && lspDidOpenSent.has(lspPrevModelUri)) {
            const oldModel = editor?.getModel();
            // 获取旧模型的语言 (从 openFiles 中查找)
            const oldFile = state.openFiles.find(f => {
                const m = monaco.editor.getModel(monaco.Uri.parse(f.path)) || monaco.editor.getModel(monaco.Uri.file(f.path));
                return m?.uri.toString() === lspPrevModelUri;
            });
            const oldLang = oldFile?.language || 'plaintext';
            (0, lsp_client_1.lspDidClose)(monaco.Uri.parse(lspPrevModelUri), oldLang).catch(() => { });
            lspDidOpenSent.delete(lspPrevModelUri);
        }
        // 新文件: didOpen
        const model = editor?.getModel();
        if (model) {
            const file = state.openFiles[state.activeFileIndex];
            if (file && model.uri) {
                const uri = model.uri.toString();
                // 初始化 LSP 客户端
                (0, lsp_client_1.getLspClient)(file.language).start(state.projectPath || '').catch(() => { });
                (0, lsp_client_1.lspDidOpen)(model.uri, file.language, model.getValue()).catch(() => { });
                lspDidOpenSent.add(uri);
                lspPrevModelUri = uri;
            }
        }
    });
    // ── LSP: 内容变化时通知语言服务器 ──
    let lspChangeTimer = null;
    editor.onDidChangeModelContent((e) => {
        const model = editor?.getModel();
        if (!model)
            return;
        const file = state.openFiles[state.activeFileIndex];
        if (!file || !lspDidOpenSent.has(model.uri.toString()))
            return;
        // 防抖: 300ms 内收集所有变更
        if (lspChangeTimer)
            clearTimeout(lspChangeTimer);
        lspChangeTimer = setTimeout(() => {
            const changes = e?.changes || e.changes || [];
            const contentChanges = changes.map((c) => ({ text: c.text || '' }));
            (0, lsp_client_1.lspDidChange)(model.uri, file.language, contentChanges.length ? contentChanges : [{ text: model.getValue() }]).catch(() => { });
        }, 300);
    });
    // ── LSP: 关闭文件时通知 ──
    window.__lspNotifyClose = (filePath, language) => {
        try {
            const uri = monaco.Uri.file(filePath);
            const models = monaco.editor.getModels();
            const matched = models.find(m => {
                const u = m.uri.toString();
                return u.includes(filePath.replace(/\\/g, '/')) || m.uri.fsPath === filePath;
            });
            const closeUri = matched?.uri || uri;
            if (lspDidOpenSent.has(closeUri.toString())) {
                (0, lsp_client_1.lspDidClose)(closeUri, language).catch(() => { });
                lspDidOpenSent.delete(closeUri.toString());
            }
        }
        catch { /* ignore */ }
    };
    let autoSaveTimer = null;
    function scheduleAutoSave() {
        if (autoSaveTimer)
            clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(doAutoSave, 3000);
    }
    function doAutoSave() {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = null;
        }
        if (state.activeFileIndex < 0)
            return;
        const file = state.openFiles[state.activeFileIndex];
        if (!file.dirty)
            return;
        try {
            window.api.writeFile(file.path, file.content);
            file.dirty = false;
            const dirtyEl = document.getElementById('status-dirty');
            if (dirtyEl)
                dirtyEl.style.display = 'none';
        }
        catch { /* 静默失败 */ }
    }
    editor.onDidChangeCursorPosition((e) => {
        document.getElementById('status-position').textContent =
            `行 ${e.position.lineNumber}, 列 ${e.position.column}`;
    });
    // 光标位置同步到状态栏
    updateEditorStatusBar();
    // ── AI 实时代码补全(Inline Completion) ──
    const inlineLangs = ['javascript', 'typescript', 'python', 'java', 'kotlin',
        'go', 'rust', 'cpp', 'c', 'csharp', 'swift', 'ruby', 'php',
        'html', 'css', 'scss', 'json', 'yaml', 'xml', 'markdown', 'shell', 'sql', 'dart'];
    let completionTimer = null;
    let completionRequestId = 0;
    for (const lang of inlineLangs) {
        monaco.languages.registerInlineCompletionsProvider(lang, {
            provideInlineCompletions: async (model, position, context, token) => {
                if (context.triggerKind !== monaco.languages.InlineCompletionTriggerKind.Automatic) {
                    return { items: [] };
                }
                // 只在行尾触发
                const lineContent = model.getLineContent(position.lineNumber);
                if (position.column <= lineContent.length && lineContent.trim().length > 0)
                    return { items: [] };
                // 当前行空白不补全
                if (lineContent.trim().length === 0)
                    return { items: [] };
                const requestId = ++completionRequestId;
                return new Promise((resolve) => {
                    if (completionTimer)
                        clearTimeout(completionTimer);
                    completionTimer = setTimeout(async () => {
                        if (token.isCancellationRequested || requestId !== completionRequestId) {
                            resolve({ items: [] });
                            return;
                        }
                        try {
                            const startLine = Math.max(1, position.lineNumber - 25);
                            const textBefore = model.getValueInRange({
                                startLineNumber: startLine, startColumn: 1,
                                endLineNumber: position.lineNumber, endColumn: position.column,
                            });
                            const language = model.getLanguageId();
                            const completion = await window.api.aiComplete(textBefore, language);
                            if (!completion || token.isCancellationRequested || requestId !== completionRequestId) {
                                resolve({ items: [] });
                                return;
                            }
                            resolve({
                                items: [{ insertText: completion, range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column } }]
                            });
                        }
                        catch {
                            resolve({ items: [] });
                        }
                    }, 350);
                });
            },
            freeInlineCompletions: () => { },
        });
    }
    // ── LSP: TypeScript/JavaScript 语言服务配置 ──
    // Monaco 内置 TypeScript 编译器,启用后自动提供:
    // F12=跳转定义 Shift+F12=查找引用 F2=重命名 Ctrl+.=快速修复
    const tsCompilerOpts = {
        target: monaco.languages.typescript.ScriptTarget.ES2020,
        allowNonTsExtensions: true,
        moduleResolution: monaco.languages.typescript.ModuleResolutionKind.NodeJs,
        module: monaco.languages.typescript.ModuleKind.ESNext,
        noEmit: true,
        esModuleInterop: true,
        allowJs: true,
        strict: true,
        jsx: monaco.languages.typescript.JsxEmit.React,
    };
    monaco.languages.typescript.typescriptDefaults.setCompilerOptions(tsCompilerOpts);
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions(tsCompilerOpts);
    // 开启诊断(错误/警告波浪线)
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false,
    });
    // 添加浏览器 DOM 类型声明，提升 JS/TS IntelliSense 质量
    monaco.languages.typescript.typescriptDefaults.addExtraLib('declare var console: { log(...args: any[]): void; error(...args: any[]): void; warn(...args: any[]): void; info(...args: any[]): void; }; ' +
        'declare var process: { env: { [key: string]: string | undefined } }; ' +
        'declare var require: (id: string) => any; ' +
        'declare var module: { exports: any }; ', 'ts:global.d.ts');
    // ── AI 一键编程 Action ──────────────────
    // 快捷键:Ctrl+Shift+I 或右键菜单
    editor.addAction({
        id: 'tcide-ai-insert',
        label: 'AI 生成代码并插入',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyI],
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 1,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            const prompt = selectedText
                ? `请改进以下代码,直接返回完整代码块,不要解释:\n\n${selectedText}`
                : `请根据当前文件上下文生成代码。当前光标位置在行 ${selection?.startLineNumber}。`;
            aiGenerateAndInsert(ed, prompt, selection);
        },
    });
    editor.addAction({
        id: 'tcide-ai-explain',
        label: 'AI 解释代码',
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyE],
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 2,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            if (!selectedText.trim()) {
                showMiniToast('请先选中要解释的代码');
                return;
            }
            const prompt = `请用中文简洁解释以下代码的功能(不超过5句话):\n\n${selectedText}`;
            aiGenerateAndInsert(ed, prompt, selection, true); // true = 插入为注释
        },
    });
    // ── AI 重构 ──
    editor.addAction({
        id: 'tcide-ai-refactor',
        label: 'AI 重构代码',
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 3,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            if (!selectedText.trim()) {
                showMiniToast('请先选中要重构的代码');
                return;
            }
            const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
            const prompt = `重构以下${lang}代码,提高可读性和可维护性,保持功能不变。直接返回完整重构后的代码块,不要解释:\n\n${selectedText}`;
            aiGenerateAndInsert(ed, prompt, selection);
        },
    });
    // ── AI 生成测试 ──
    editor.addAction({
        id: 'tcide-ai-tests',
        label: 'AI 生成测试',
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 4,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            if (!selectedText.trim()) {
                showMiniToast('请先选中要生成测试的函数/类');
                return;
            }
            const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
            const prompt = `为以下${lang}代码生成完整的单元测试。覆盖主要功能和边界情况。直接返回测试代码块,不要解释:\n\n${selectedText}`;
            aiGenerateAndInsert(ed, prompt, selection);
        },
    });
    // ── AI 修复 Bug ──
    editor.addAction({
        id: 'tcide-ai-fix',
        label: 'AI 修复 Bug',
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 5,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            if (!selectedText.trim()) {
                showMiniToast('请先选中可能有 Bug 的代码');
                return;
            }
            const prompt = `检查并修复以下代码中的潜在 Bug、性能问题和安全漏洞。直接返回修复后的完整代码块,不要解释:\n\n${selectedText}`;
            aiGenerateAndInsert(ed, prompt, selection);
        },
    });
    // ── AI 生成注释/文档 ──
    editor.addAction({
        id: 'tcide-ai-docs',
        label: 'AI 生成文档注释',
        contextMenuGroupId: 'tcide-ai',
        contextMenuOrder: 6,
        run: (ed) => {
            const selection = ed.getSelection();
            if (!selection)
                return;
            const selectedText = ed.getModel()?.getValueInRange(selection) ?? '';
            if (!selectedText.trim()) {
                showMiniToast('请先选中要生成文档的代码');
                return;
            }
            const lang = state.openFiles[state.activeFileIndex]?.language || 'code';
            const prompt = `为以下${lang}代码生成详细的文档注释(JSDoc/KDoc/Docstring格式),包含参数说明和返回值说明。只返回注释块,不要返回代码:\n\n${selectedText}`;
            aiGenerateAndInsert(ed, prompt, selection);
        },
    });
    // 监听窗口 resize
    window.addEventListener('resize', () => {
        editor?.layout();
    });
    // 首次启动：显示欢迎 README
    setTimeout(() => showFirstLaunchReadme(), 500);
}
// ─────────────────────────────────────────
// 文件树
// ─────────────────────────────────────────
// ── 文件夹图标映射 ──
const FOLDER_ICONS = {
    '.git': '🔀', '.github': '🐙', '.gitlab': '🦊',
    'node_modules': '📦', '.pnpm': '📦',
    '.venv': '🐍', 'venv': '🐍', '.tox': '🐍', '__pycache__': '🐍',
    '.idea': '⚙️', '.vscode': '⚙️', '.cursor': '⚙️', '.windsurf': '⚙️',
    'dist': '🏗️', 'build': '🏗️', 'out': '🏗️', 'target': '🏗️', '.next': '🏗️', '.nuxt': '🏗️', '.output': '🏗️',
    'src': '📁', 'source': '📁', 'sources': '📁', 'lib': '📁', 'app': '📁',
    'core': '🧩', 'agent': '🤖', 'compat': '🔗', 'indexer': '🔍',
    'model': '🧠', 'config': '⚙️', 'configs': '⚙️',
    'renderer': '🖥️', 'main': '⚡',
    'components': '🧩', 'modules': '🧩', 'utils': '🔧', 'helpers': '🔧',
    'styles': '🎨', 'types': '📋', 'hooks': '🪝',
    'test': '🧪', 'tests': '🧪', 'spec': '🧪', '__tests__': '🧪', 'e2e': '🧪',
    'docs': '📚', 'doc': '📚', 'documentation': '📚', 'wiki': '📚',
    'public': '🌐', 'static': '🌐', 'assets': '🎨', 'images': '🖼️', 'img': '🖼️', 'icons': '🖼️',
    'scripts': '💻', 'tools': '🔧', 'tasks': '📋',
    'logs': '📄', 'temp': '🗑️', 'tmp': '🗑️', '.cache': '🗑️',
    'docker': '🐳', 'kubernetes': '☸️', 'k8s': '☸️', 'helm': '☸️',
    'terraform': '🏗️', 'ansible': '⚙️', 'ci': '🔄', 'cd': '🔄',
    'migrations': '🗃️', 'database': '🗃️', 'db': '🗃️',
    '.husky': '🪝', '.storybook': '📖',
    'release': '🚀', 'resources': '📦', 'task-artifacts': '📄',
};
function getFileIcon(name, isDir) {
    const base = name.toLowerCase();
    const ext = name.split('.').pop()?.toLowerCase() || '';
    // ── 目录:特殊文件夹有专属图标 ──
    if (isDir) {
        const dirIcon = FOLDER_ICONS[base];
        if (dirIcon)
            return `<span class="file-icon-emoji">${dirIcon}</span>`;
        return '<span class="file-icon-emoji">📁</span>';
    }
    // ── 无扩展名文件(无点号或多段点号特殊名)──
    const noExtFiles = {
        dockerfile: '🐳', containerfile: '🐳', vagrantfile: '📦',
        makefile: '🔨', gnumakefile: '🔨', justfile: '🔨',
        rakefile: '💎', jenkinsfile: '🔄', procfile: '⚙️',
    };
    if (noExtFiles[base])
        return `<span class="file-icon-emoji">${noExtFiles[base]}</span>`;
    if (base.startsWith('license') || base === 'licence' || base === 'copying' || base.startsWith('license-'))
        return '<span class="file-icon-emoji">📜</span>';
    if (base.startsWith('readme'))
        return '<span class="file-icon-emoji">📖</span>';
    if (base.startsWith('changelog'))
        return '<span class="file-icon-emoji">📋</span>';
    if (base === '.gitignore' || base === '.gitattributes' || base === '.gitmodules' || base === '.mailmap' || base === '.gitkeep')
        return '<span class="file-icon-emoji">🔀</span>';
    if (base === '.dockerignore' || base === '.npmignore' || base === '.eslintignore' || base === '.prettierignore')
        return '<span class="file-icon-emoji">🙈</span>';
    if (base === '.editorconfig')
        return '<span class="file-icon-emoji">⚙️</span>';
    if (base === '.env' || base.startsWith('.env.'))
        return '<span class="file-icon-emoji">⚙️</span>';
    if (base === '.npmrc' || base === '.yarnrc' || base === '.yarnrc.yml' || base === '.nvmrc')
        return '<span class="file-icon-emoji">⚙️</span>';
    if (base === '.babelrc' || base === '.browserslistrc' || base === '.babelrc.js' || base === '.babelrc.json')
        return '<span class="file-icon-emoji">⚙️</span>';
    if (base === '.prettierrc' || base === '.prettierrc.json' || base === '.prettierrc.yaml' || base === '.prettierrc.yml' || base === '.prettierrc.js' || base === '.prettierrc.toml')
        return '<span class="file-icon-emoji">🎨</span>';
    if (base === '.eslintrc' || base === '.eslintrc.json' || base === '.eslintrc.js' || base === '.eslintrc.yaml' || base === '.eslintrc.yml' || base === '.eslintrc.cjs' || base === 'eslint.config.js' || base === 'eslint.config.mjs' || base === 'eslint.config.ts' || base === 'eslint.config.cjs')
        return '<span class="file-icon-emoji">✅</span>';
    if (base === '.stylelintrc' || base === '.stylelintrc.json' || base === '.stylelintrc.js' || base === 'stylelint.config.js')
        return '<span class="file-icon-emoji">🎨</span>';
    if (base.startsWith('.env.'))
        return '<span class="file-icon-emoji">⚙️</span>';
    // ── 知名项目配置文件 ──
    const knownFiles = {
        'tsconfig.json': '📘', 'jsconfig.json': '📘',
        'package.json': '📦', 'package-lock.json': '📦',
        'composer.json': '🐘', 'composer.lock': '🐘',
        'cargo.toml': '🦀', 'cargo.lock': '🦀',
        'go.mod': '🔵', 'go.sum': '🔵',
        'gemfile': '💎', 'gemfile.lock': '💎',
        'pyproject.toml': '🐍', 'setup.py': '🐍', 'setup.cfg': '🐍', 'requirements.txt': '🐍', 'requirements-dev.txt': '🐍', 'pipfile': '🐍', 'pipfile.lock': '🐍',
        'pom.xml': '🐘', 'build.gradle': '🐘', 'build.gradle.kts': '🐘', 'settings.gradle': '🐘', 'settings.gradle.kts': '🐘',
        'cmakelists.txt': '🔨',
        'docker-compose.yml': '🐳', 'docker-compose.yaml': '🐳', 'docker-compose.override.yml': '🐳',
        'vite.config.ts': '⚡', 'vite.config.js': '⚡', 'vite.config.mts': '⚡', 'vite.config.mjs': '⚡',
        'tailwind.config.js': '🎨', 'tailwind.config.ts': '🎨',
        'webpack.config.js': '📦', 'webpack.config.ts': '📦', 'rollup.config.js': '📦', 'rollup.config.ts': '📦',
        '.travis.yml': '🔄', '.circleci': '🔄', 'bitbucket-pipelines.yml': '🔄', 'azure-pipelines.yml': '🔄',
        '.gitlab-ci.yml': '🦊', 'jenkinsfile': '🔄',
        'nginx.conf': '🌐', 'apache.conf': '🌐', '.htaccess': '🌐',
        'robots.txt': '🤖', 'sitemap.xml': '🗺️',
        'favicon.ico': '⭐',
        '.slugignore': '🙈', '.nowignore': '🙈', '.vercelignore': '🙈',
        '.gcloudignore': '🙈', '.cfignore': '🙈',
    };
    if (knownFiles[base])
        return `<span class="file-icon-emoji">${knownFiles[base]}</span>`;
    // ── 有专用 PNG 的扩展 ──
    const pngMap = {
        ts: 'file-ts.png', tsx: 'file-ts.png', mts: 'file-ts.png', cts: 'file-ts.png',
        js: 'file-js.png', jsx: 'file-js.png', mjs: 'file-js.png', cjs: 'file-js.png',
        py: 'file-py.png', pyw: 'file-py.png', pyi: 'file-py.png', pyx: 'file-py.png', ipynb: 'file-py.png',
        go: 'file-go.png', rs: 'file-rs.png', java: 'file-java.png',
        kt: 'file-kt.png', kts: 'file-gradle.png', gradle: 'file-gradle.png',
        xml: 'file-xml.png', xsd: 'file-xml.png', wsdl: 'file-xml.png', plist: 'file-xml.png', svg: 'file-xml.png',
        html: 'file-html.png', htm: 'file-html.png', shtml: 'file-html.png',
        css: 'file-css.png', scss: 'file-css.png', less: 'file-css.png', styl: 'file-css.png',
        json: 'file-json.png', jsonc: 'file-json.png', json5: 'file-json.png',
        md: 'file-md.png', mdx: 'file-md.png', markdown: 'file-md.png',
        sh: 'file-sh.png', bash: 'file-sh.png', zsh: 'file-sh.png', fish: 'file-sh.png',
        bat: 'file-sh.png', cmd: 'file-sh.png', ps1: 'file-sh.png',
        yml: 'file-json.png', yaml: 'file-json.png', toml: 'file-json.png',
        cfg: 'file-json.png', ini: 'file-json.png', conf: 'file-json.png',
        properties: 'file-json.png', editorconfig: 'file-json.png',
    };
    if (pngMap[ext])
        return `<img src="icons/file/${pngMap[ext]}" alt="" class="ft-icon" />`;
    // ── Emoji 分类图标 ──
    const docExts = new Set(['pdf', 'docx', 'doc', 'rtf', 'odt', 'pages', 'wpd']);
    const sheetExts = new Set(['xlsx', 'xls', 'xlsm', 'csv', 'tsv', 'ods', 'numbers']);
    const slideExts = new Set(['pptx', 'ppt', 'pptm', 'odp', 'key']);
    const archiveExts = new Set(['zip', 'rar', '7z', 'gz', 'tar', 'tgz', 'bz2', 'xz', 'zst', 'lz', 'lz4', 'br', 'ar', 'cpio', 'whl', 'egg', 'apk', 'aab', 'ipa', 'dmg', 'pkg', 'deb', 'rpm', 'msi', 'appx']);
    const imgExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'icns', 'tiff', 'tif', 'jfif', 'avif', 'heic', 'heif', 'raw', 'cr2', 'nef', 'dng', 'psd', 'ai', 'eps', 'xcf', 'sketch', 'fig']);
    const audioExts = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a', 'opus', 'aiff', 'alac', 'mid', 'midi', 'ape', 'amr', 'caf', 'ra']);
    const videoExts = new Set(['mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'm4v', 'mpg', 'mpeg', '3gp', 'ogv', 'rm', 'rmvb', 'vob', 'f4v', 'webm']);
    const fontExts = new Set(['ttf', 'otf', 'woff', 'woff2', 'eot', 'ttc', 'otc']);
    const dbExts = new Set(['sql', 'db', 'sqlite', 'sqlite3', 'mdb', 'accdb', 'dbf', 'sqlitedb', 'duckdb', 'parquet', 'ndjson', 'jsonl', 'avro', 'orc']);
    const cExts = new Set(['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx', 'hh', 'inl', 'ipp', 'c++', 'cu', 'cuh']);
    const binaryExts = new Set(['exe', 'dll', 'so', 'dylib', 'wasm', 'bin', 'dat', 'sys', 'drv', 'lib', 'a', 'o', 'obj', 'pdb', 'ilk', 'exp', 'pyc', 'pyo', 'pyd', 'class']);
    const certExts = new Set(['pem', 'crt', 'key', 'cer', 'p12', 'pfx', 'der', 'csr', 'p7b', 'p7c', 'jks', 'keystore', 'truststore']);
    const texExts = new Set(['tex', 'bib', 'cls', 'sty', 'bbl', 'bst', 'bcf', 'lco', 'dtx', 'ins']);
    const langExts = {
        cs: '🧩', csx: '🧩', rb: '💎', erb: '💎', php: '🐘',
        swift: '🍎', dart: '🎯', lua: '🌙', r: '📊', rmd: '📊', qmd: '📊',
        scala: '🔴', sc: '🔴', elm: '🌳',
        ex: '💧', exs: '💧', eex: '💧', heex: '💧',
        clj: '🔮', cljs: '🔮', cljc: '🔮', edn: '🔮',
        fs: '🧩', fsx: '🧩', fsi: '🧩',
        hs: 'λ', lhs: 'λ', ml: '🧩', mli: '🧩',
        nim: '👑', zig: '⚡', v: '🔷', odin: '🔶', jl: '🔬',
        cr: '💎', vala: '🧩', vapi: '🧩',
        groovy: '🧩', gvy: '🧩', gy: '🧩', gsh: '🧩',
        haxe: '🧩', hx: '🧩', pony: '🐴',
        solidity: '🧩', sol: '🧩',
        purs: '🧩', idr: '🧩', lidr: '🧩',
        agda: '🧩', coq: '🧩', lean: '🧩',
        nix: '❄️', dhall: '🧩', cue: '🧩',
        wast: '🧩', wat: '🧩', wai: '🧩',
        f: '🧩', f90: '🧩', f95: '🧩', f03: '🧩', f08: '🧩', for: '🧩', fpp: '🧩',
        asm: '🧩', s: '🧩', S: '🧩',
        m: '🧩', mm: '🧩',
        pl: '🧩', pm: '🧩', t: '🧩',
        tcl: '🧩', tk: '🧩',
        coffee: '🧩', litcoffee: '🧩',
        lisp: '🧩', lsp: '🧩', cl: '🧩', fasl: '🧩', scm: '🧩', ss: '🧩', rkt: '🧩',
        erl: '🧩', hrl: '🧩',
        d: '🧩', di: '🧩',
        pas: '🧩', pp: '🧩',
        ada: '🧩', adb: '🧩', ads: '🧩',
        cbl: '🧩', cob: '🧩', cpy: '🧩',
        abap: '🧩',
        dot: '🧩', gv: '🧩',
    };
    const webExts = new Set(['vue', 'svelte', 'astro', 'ejs', 'pug', 'jade', 'hbs', 'handlebars', 'mustache', 'twig', 'liquid', 'njk', 'nunjucks', 'jinja', 'jinja2', 'j2', 'tera', 'latte']);
    const docFormatExts = new Set(['rst', 'adoc', 'asciidoc', 'org', 'txt', 'log', 'text', 'diff', 'patch']);
    const certExtSet = new Set(['pem', 'crt', 'key', 'cer', 'p12', 'pfx', 'der', 'csr', 'p7b']);
    const i18nExts = new Set(['po', 'pot', 'mo', 'resx', 'resw', 'xliff', 'xlf']);
    const infraExts = new Set(['tf', 'tfvars', 'tfstate', 'hcl', 'bicep', 'pulumi', 'cdk']);
    const notebookExts = new Set(['ipynb']);
    if (ext === 'lock')
        return '<span class="file-icon-emoji">🔒</span>';
    if (ext === 'cmake')
        return '<span class="file-icon-emoji">🔨</span>';
    if (ext === 'proto' || ext === 'thrift' || ext === 'graphql' || ext === 'gql' || ext === 'prisma')
        return '<span class="file-icon-emoji">🔧</span>';
    if (texExts.has(ext))
        return '<span class="file-icon-emoji">📝</span>';
    if (docExts.has(ext))
        return '<span class="file-icon-emoji">📝</span>';
    if (ext === 'pdf')
        return '<span class="file-icon-emoji">📕</span>';
    if (sheetExts.has(ext))
        return '<span class="file-icon-emoji">📊</span>';
    if (slideExts.has(ext))
        return '<span class="file-icon-emoji">📽️</span>';
    if (archiveExts.has(ext))
        return '<span class="file-icon-emoji">📦</span>';
    if (imgExts.has(ext))
        return '<span class="file-icon-emoji">🖼️</span>';
    if (audioExts.has(ext))
        return '<span class="file-icon-emoji">🎵</span>';
    if (videoExts.has(ext))
        return '<span class="file-icon-emoji">🎬</span>';
    if (fontExts.has(ext))
        return '<span class="file-icon-emoji">🔤</span>';
    if (dbExts.has(ext))
        return '<span class="file-icon-emoji">🗃️</span>';
    if (cExts.has(ext))
        return '<span class="file-icon-emoji">🧩</span>';
    if (binaryExts.has(ext))
        return '<span class="file-icon-emoji">⚡</span>';
    if (certExtSet.has(ext))
        return '<span class="file-icon-emoji">🔐</span>';
    if (i18nExts.has(ext))
        return '<span class="file-icon-emoji">🌐</span>';
    if (infraExts.has(ext))
        return '<span class="file-icon-emoji">🏗️</span>';
    if (notebookExts.has(ext))
        return '<span class="file-icon-emoji">📓</span>';
    if (docFormatExts.has(ext))
        return '<span class="file-icon-emoji">📄</span>';
    if (langExts[ext])
        return `<span class="file-icon-emoji">${langExts[ext]}</span>`;
    if (webExts.has(ext))
        return '<span class="file-icon-emoji">🧩</span>';
    // 3D 模型文件
    const model3dExts = new Set(['obj', 'fbx', 'blend', 'stl', 'glb', 'gltf', '3ds', 'dae', 'ply', 'usd', 'usda', 'usdc', 'usdz']);
    if (model3dExts.has(ext))
        return '<span class="file-icon-emoji">🧊</span>';
    // 兜底:无扩展名文件
    if (!ext)
        return '<span class="file-icon-emoji">📄</span>';
    return '<img src="icons/file/file-default.png" alt="" class="ft-icon" />';
}
function renderFileTree(nodes, container, depth = 0) {
    for (const node of nodes) {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.style.paddingLeft = `${8 + depth * 16}px`;
        item.dataset.path = node.path;
        item.dataset.isDir = String(node.isDirectory);
        const arrow = document.createElement('span');
        arrow.className = 'arrow' + (node.isDirectory ? '' : ' empty');
        arrow.textContent = node.isDirectory ? '▶' : '';
        const icon = document.createElement('span');
        icon.className = 'icon';
        icon.innerHTML = getFileIcon(node.name, node.isDirectory);
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = node.name;
        item.appendChild(arrow);
        item.appendChild(icon);
        item.appendChild(name);
        container.appendChild(item);
        // 点击事件
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            if (node.isDirectory) {
                toggleTreeNode(item, node);
            }
            else {
                openFile(node.path, node.name);
            }
        });
        // 右键菜单
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            showContextMenu(e, node);
        });
    }
}
function toggleTreeNode(item, node) {
    const arrow = item.querySelector('.arrow');
    const existingChildren = item.nextElementSibling;
    if (arrow.classList.contains('open')) {
        // 折叠
        arrow.classList.remove('open');
        if (existingChildren?.classList.contains('tree-children')) {
            existingChildren.remove();
        }
    }
    else {
        // 展开
        arrow.classList.add('open');
        if (node.children && node.children.length > 0) {
            const childContainer = document.createElement('div');
            childContainer.className = 'tree-children';
            childContainer.style.display = 'block';
            item.after(childContainer);
            renderFileTree(node.children, childContainer, 0);
        }
    }
}
async function loadFileTree(projectPath) {
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    try {
        const tree = await window.api.readDirectory(projectPath);
        state.fileTree = tree;
        if (tree.length === 0) {
            container.innerHTML = '<div class="empty-state">项目为空</div>';
            return;
        }
        renderFileTree(tree, container);
        // ⚙ Gradle 检测
        const gradleBadges = document.getElementById('status-gradle');
        if (gradleBadges) {
            const hasGradle = tree.some((n) => ['gradlew', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'].includes(n.name));
            gradleBadges.style.display = hasGradle ? '' : 'none';
        }
    }
    catch (err) {
        container.innerHTML = `<div class="empty-state">加载失败: ${err.message}</div>`;
    }
}
// ─────────────────────────────────────────
// 文件操作
// ─────────────────────────────────────────
async function openFile(filePath, name) {
    // 隐藏欢迎页
    hideWelcomePage();
    // 检查是否已打开
    const existing = state.openFiles.findIndex(f => f.path === filePath);
    if (existing >= 0) {
        switchToFile(existing);
        return;
    }
    const lang = detectLanguage(name);
    // 二进制文件 - Hex 预览
    if (lang === 'binary') {
        try {
            const hexData = await window.api.readHex(filePath, 16384);
            const content = [
                `文件: ${name}`,
                `大小: ${(hexData.size / 1024).toFixed(1)} KB`,
                `${hexData.truncated ? `(仅显示前 ${(hexData.maxBytes / 1024).toFixed(0)} KB)` : ''}`,
                '',
                hexData.hex
            ].join('\n');
            state.openFiles.push({ path: filePath, name, content, dirty: false, language: 'plaintext' });
            const index = state.openFiles.length - 1;
            renderEditorTabs();
            switchToFile(index);
        }
        catch (err) {
            showToast(`无法打开: ${err.message}`, 'error');
        }
        return;
    }
    // ── HTML/SVG/XML 预览 + 源码编辑 双模式 ──
    if (lang === 'html' || lang === 'xml' || name.endsWith('.svg')) {
        try {
            const content = await window.api.readFile(filePath);
            const fileLang = name.endsWith('.svg') ? 'html' : (lang === 'xml' ? 'xml' : 'html');
            state.openFiles.push({ path: filePath, name, content, dirty: false, language: fileLang });
            const index = state.openFiles.length - 1;
            renderEditorTabs();
            switchToFile(index);
            // 默认预览模式
            toggleHtmlMode('preview');
            // SVG 设置 iframe 使用 srcdoc 渲染
            if (name.endsWith('.svg')) {
                const htmlFrame = document.getElementById('html-preview');
                if (htmlFrame) {
                    htmlFrame.src = '';
                    htmlFrame.srcdoc = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${content}</body></html>`;
                }
            }
        }
        catch {
            showToast(`${name.split('.').pop()?.toUpperCase()} 加载失败`, 'error');
        }
        return;
    }
    // ── PDF 预览 ──
    if (lang === 'pdf') {
        try {
            // Electron 内嵌 PDF 渲染不稳定，直接用系统阅读器打开
            await window.api.openExternal(filePath);
            showToast(`已在外部打开: ${name}`, 'info', 2000);
        }
        catch (err) {
            showToast(`PDF 打开失败: ${err.message}`, 'error');
        }
        return;
    }
    // ── 图片预览 ──
    if (lang === 'image') {
        try {
            const dataUrl = await window.api.readFileAsDataURL(filePath);
            state.openFiles.push({ path: filePath, name, content: dataUrl, dirty: false, language: 'image' });
            const index = state.openFiles.length - 1;
            renderEditorTabs();
            switchToFile(index);
        }
        catch (err) {
            showToast(`图片加载失败: ${err.message}`, 'error');
        }
        return;
    }
    // ── 视频/音频预览 ──
    if (lang === 'video' || lang === 'audio') {
        const dataUrl = await window.api.readFileAsDataURL(filePath);
        state.openFiles.push({ path: filePath, name, content: dataUrl, dirty: false, language: lang });
        const index = state.openFiles.length - 1;
        renderEditorTabs();
        switchToFile(index);
        return;
    }
    // ── DOCX 文本提取 ──
    if (lang === 'docx') {
        try {
            const text = await window.api.readDocxText(filePath);
            state.openFiles.push({ path: filePath, name, content: text, dirty: false, language: 'markdown' });
            const index = state.openFiles.length - 1;
            renderEditorTabs();
            switchToFile(index);
        }
        catch (err) {
            showToast(`DOCX 加载失败: ${err.message}`, 'error');
        }
        return;
    }
    try {
        const content = await window.api.readFile(filePath);
        state.openFiles.push({ path: filePath, name, content, dirty: false, language: lang });
        const index = state.openFiles.length - 1;
        renderEditorTabs();
        switchToFile(index);
        // 更新文件树选中
        document.querySelectorAll('.tree-item').forEach(el => {
            el.classList.toggle('selected', el.dataset.path === filePath);
        });
    }
    catch (err) {
        console.error('打开文件失败:', err);
    }
}
function switchToFile(index) {
    if (index < 0 || index >= state.openFiles.length)
        return;
    state.activeFileIndex = index;
    const file = state.openFiles[index];
    // ── HTML / PDF 预览 ──
    const pdfFrame = document.getElementById('pdf-preview');
    const htmlFrame = document.getElementById('html-preview');
    const editorEl = document.getElementById('monaco-container');
    // 全部先隐藏
    editorEl.classList.add('hidden');
    if (pdfFrame) {
        pdfFrame.classList.add('hidden');
        pdfFrame.src = '';
    }
    if (htmlFrame) {
        htmlFrame.classList.add('hidden');
        htmlFrame.src = '';
    }
    const imgContainer = document.getElementById('image-preview-container');
    if (imgContainer)
        imgContainer.classList.add('hidden');
    const mediaContainer = document.getElementById('media-preview-container');
    if (mediaContainer)
        mediaContainer.classList.add('hidden');
    if (file.language === 'pdf') {
        if (pdfFrame) {
            pdfFrame.classList.remove('hidden');
            pdfFrame.src = file.content;
        }
    }
    else if (file.language === 'image') {
        // 图片预览
        if (imgContainer) {
            imgContainer.classList.remove('hidden');
            const img = imgContainer.querySelector('img');
            let imgErrorHandled = false;
            img.onload = () => { imgErrorHandled = true; };
            img.onerror = () => {
                if (imgErrorHandled)
                    return;
                img.src = '';
                // 只报一次错
                if (!imgErrorHandled) {
                    imgErrorHandled = true;
                    showToast(`无法加载图片: ${file.name}`, 'error');
                }
            };
            img.src = file.content;
            img.alt = file.name;
        }
    }
    else if (file.language === 'video') {
        const mediaContainer = document.getElementById('media-preview-container');
        const video = document.getElementById('media-video-preview');
        const audio = document.getElementById('media-audio-preview');
        if (mediaContainer) {
            mediaContainer.classList.remove('hidden');
            audio?.classList.add('hidden');
            video?.classList.remove('hidden');
        }
        if (video) {
            video.src = file.content;
            video.load();
        }
    }
    else if (file.language === 'audio') {
        const mediaContainer = document.getElementById('media-preview-container');
        const video = document.getElementById('media-video-preview');
        const audio = document.getElementById('media-audio-preview');
        if (mediaContainer) {
            mediaContainer.classList.remove('hidden');
            video?.classList.add('hidden');
            audio?.classList.remove('hidden');
        }
        if (audio) {
            audio.src = file.content;
            audio.load();
        }
    }
    else if (file.language === 'html' || file.language === 'xml' || file.language === 'markdown' || file.name.endsWith('.svg')) {
        // 预览/源码可切换
        const htmlErr = document.getElementById('html-error-console');
        if (file.language === 'markdown') {
            // Markdown 预览渲染
            if (htmlFrame) {
                htmlFrame.classList.remove('hidden');
                htmlFrame.src = '';
                htmlFrame.srcdoc = wrapMarkdownForPreview(file.content);
            }
        }
        else if (file.name.endsWith('.svg')) {
            // SVG 用 srcdoc 包裹确保渲染
            if (htmlFrame) {
                htmlFrame.classList.remove('hidden');
                htmlFrame.src = '';
                htmlFrame.srcdoc = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${file.content}</body></html>`;
            }
        }
        else {
            if (htmlFrame) {
                htmlFrame.classList.remove('hidden');
                htmlFrame.src = '';
                htmlFrame.srcdoc = wrapHtmlWithErrorCapture(file.content);
            }
        }
        const modeBtn = document.getElementById('html-mode-toggle');
        if (modeBtn) {
            modeBtn.style.display = '';
            modeBtn.textContent = '📝 源码';
        }
        const toolbar = document.getElementById('html-toolbar');
        if (toolbar)
            toolbar.style.display = 'flex';
        if (htmlErr && file.language !== 'markdown')
            htmlErr.classList.remove('hidden');
        else if (htmlErr)
            htmlErr.classList.add('hidden');
        htmlMode = 'preview';
    }
    else {
        editorEl.classList.remove('hidden');
        const toolbar = document.getElementById('html-toolbar');
        if (toolbar)
            toolbar.style.display = 'none';
        const htmlErrCon = document.getElementById('html-error-console');
        if (htmlErrCon) {
            htmlErrCon.classList.add('hidden');
            htmlErrCon.innerHTML = '';
        }
        const modeBtn = document.getElementById('html-mode-toggle');
        if (modeBtn)
            modeBtn.style.display = 'none';
        const errInd = document.getElementById('html-error-indicator');
        if (errInd)
            errInd.classList.add('hidden');
        const model = monaco.editor.createModel(file.content, file.language);
        editor?.setModel(model);
    }
    renderEditorTabs();
    updateEditorStatusBar(file.language);
    // 🔀 Git diff 标记
    showGitDiffDecorations(file.path);
    // P0: 实时 Lint 检测
    triggerLintForFile(file.path);
    // P0: 大文件分片检测
    triggerChunkerForFile(file.path);
    // P0: 更新状态栏 Lint 角标
    updateStatusBarLint();
    // P0: Perf 计时结束
    if (window.__perfOpenTimer) { window.__perfOpenTimer(); window.__perfOpenTimer = null; }
    // 更新文件树选中
    document.querySelectorAll('.tree-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.path === file.path);
    });
}
function renderEditorTabs() {
    const tabs = document.getElementById('editor-tabs');
    tabs.innerHTML = '';
    state.openFiles.forEach((file, index) => {
        const tab = document.createElement('div');
        tab.className = 'tab-item' + (index === state.activeFileIndex ? ' active' : '');
        tab.draggable = true;
        tab.dataset.fileIndex = String(index);
        tab.innerHTML = `
      <span class="tab-icon">${getFileIcon(file.name, false)}</span>
      <span class="tab-name">${file.name}${file.dirty ? ' ●' : ''}</span>
      <button class="tab-close" data-index="${index}">×</button>
    `;
        tab.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('tab-close')) {
                closeFile(parseInt(target.dataset.index));
            }
            else {
                switchToFile(index);
            }
        });
        // 拖拽
        tab.addEventListener('dragstart', (e) => {
            draggedTab = tab;
            tab.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        tab.addEventListener('dragend', () => {
            tab.classList.remove('dragging');
        });
        // 右键菜单
        tab.addEventListener('contextmenu', (e) => {
            showTabContextMenu(e, index);
        });
        tabs.appendChild(tab);
    });
}
// renderTabs is an alias used by AI code block flow
const renderTabs = renderEditorTabs;
function closeFile(index) {
    if (index < 0 || index >= state.openFiles.length)
        return;
    const file = state.openFiles[index];
    window.__lspNotifyClose?.(file.path, file.language);
    state.openFiles.splice(index, 1);
    if (state.activeFileIndex >= state.openFiles.length) {
        state.activeFileIndex = Math.max(0, state.openFiles.length - 1);
    }
    renderEditorTabs();
    if (state.openFiles.length === 0) {
        editor?.setModel(null);
        const pdfFrame = document.getElementById('pdf-preview');
        if (pdfFrame) {
            pdfFrame.style.display = 'none';
            pdfFrame.src = '';
        }
        document.getElementById('monaco-container').style.display = 'block';
    }
    else {
        switchToFile(state.activeFileIndex);
    }
}
function detectLanguage(name) {
    const ext = name.split('.').pop()?.toLowerCase();
    const langs = {
        kt: 'kotlin', java: 'java', xml: 'xml', gradle: 'gradle',
        kts: 'kotlin', json: 'json', md: 'markdown', txt: 'plainText',
        sh: 'shell', bat: 'bat', ps1: 'powershell', go: 'go',
        rs: 'rust', py: 'python', ts: 'typescript', tsx: 'typescript',
        js: 'javascript', yml: 'yaml', yaml: 'yaml', toml: 'toml',
        cpp: 'cpp', c: 'c', h: 'c', cs: 'csharp', rb: 'ruby',
        php: 'php', sql: 'sql', css: 'css', scss: 'scss', less: 'less',
        html: 'html', htm: 'html', svg: 'xml', vue: 'html', svelte: 'html',
        dart: 'dart', swift: 'swift', scala: 'scala', lua: 'lua', r: 'r',
    };
    // 特殊文件类型
    if (ext === 'pdf')
        return 'pdf';
    if (ext === 'docx')
        return 'docx';
    // 图片文件
    const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico']);
    if (imageExts.has(ext || ''))
        return 'image';
    // 视频文件
    const videoExts = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'flv', 'wmv', 'm4v']);
    if (videoExts.has(ext || ''))
        return 'video';
    // 音频文件
    const audioExts = new Set(['mp3', 'wav', 'flac', 'aac', 'm4a', 'wma', 'opus']);
    if (audioExts.has(ext || ''))
        return 'audio';
    if (ext === 'pdf')
        return 'pdf';
    if (ext === 'docx')
        return 'docx';
    // 其他二进制文件不应在编辑器中打开
    const binaryExts = new Set(['doc', 'xlsx', 'xls', 'pptx', 'ppt', 'zip', 'rar', '7z', 'gz', 'tar', 'exe', 'dll', 'so', 'dylib', 'wasm', 'ttf', 'otf', 'woff', 'woff2', 'eot', 'mp3', 'mp4', 'avi', 'mov', 'wmv', 'flv', 'mkv', 'webm', 'ogg', 'wav', 'flac', 'icns', 'bin', 'dat', 'db', 'sqlite', 'sqlite3']);
    if (binaryExts.has(ext || ''))
        return 'binary';
    return langs[ext || ''] || 'plainText';
}
let gitDiffDeco = null;
// ── 自诊断：文件切换时自动运行 ──
function refreshFileDiagnostics() {
    const file = state.openFiles[state.activeFileIndex];
    if (!file || !['typescript', 'javascript', 'ts', 'js', 'jsx', 'tsx', 'python', 'py', 'go', 'java', 'kt', 'kotlin', 'cs', 'csharp', 'rs', 'rust'].includes(file.language)) return;
    const issues = runSelfDiagnostic(file);
    renderDiagnosticResults(issues);
}
// ── 做梦引擎：操作记录钩子 ──
function recordDreamOp(type, data = {}) {
    if (!state.projectPath) return;
    window.api.dreamRecord?.({ type, ...data }).catch(() => {});
}
async function showGitDiffDecorations(filePath) {
    if (!editor || !state.projectPath) {
        clearGitDecorations();
        return;
    }
    try {
        const diff = await window.api.getDiff(filePath, state.projectPath);
        if (!diff.success) {
            clearGitDecorations();
            return;
        }
        const decorations = [];
        for (const ln of diff.added) {
            decorations.push({
                range: new monaco.Range(ln, 1, ln, 1),
                options: { isWholeLine: true, linesDecorationsClassName: 'git-line-added', glyphMarginClassName: 'git-glyph-added' },
            });
        }
        for (const ln of diff.modified) {
            decorations.push({
                range: new monaco.Range(ln, 1, ln, 1),
                options: { isWholeLine: true, linesDecorationsClassName: 'git-line-modified', glyphMarginClassName: 'git-glyph-modified' },
            });
        }
        for (const ln of diff.removed) {
            // 已删除行在当前版本中不存在,跳过(或显示在附近行)
        }
        if (gitDiffDeco)
            gitDiffDeco.clear();
        gitDiffDeco = editor.createDecorationsCollection(decorations);
    }
    catch {
        clearGitDecorations();
    }
}
function clearGitDecorations() {
    if (gitDiffDeco) {
        gitDiffDeco.clear();
        gitDiffDeco = null;
    }
}
// ═══ HTML 预览/源码 双模式 ═══
let htmlMode = 'preview';
function toggleHtmlMode(mode) {
    if (mode)
        htmlMode = mode;
    else
        htmlMode = htmlMode === 'preview' ? 'source' : 'preview';
    const frame = document.getElementById('html-preview');
    const toolbar = document.getElementById('html-toolbar');
    const editorEl = document.getElementById('monaco-container');
    const toggleBtn = document.getElementById('html-mode-toggle');
    const errCon = document.getElementById('html-error-console');
    if (htmlMode === 'preview') {
        if (frame) {
            frame.classList.remove('hidden');
            const file = state.openFiles[state.activeFileIndex];
            if (file && (file.language === 'html' || file.language === 'xml' || file.language === 'markdown' || file.name.endsWith('.svg'))) {
                if (file.language === 'markdown') {
                    frame.srcdoc = wrapMarkdownForPreview(file.content);
                }
                else if (file.name.endsWith('.svg')) {
                    // SVG 用 srcdoc 包裹确保渲染
                    frame.srcdoc = `<html><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#fff">${file.content}</body></html>`;
                    frame.src = '';
                }
                else {
                    frame.srcdoc = wrapHtmlWithErrorCapture(file.content);
                }
            }
        }
        editorEl.classList.add('hidden');
        if (toolbar)
            toolbar.style.display = 'flex';
        if (toggleBtn)
            toggleBtn.textContent = '📝 源码';
    }
    else {
        if (frame) {
            frame.classList.add('hidden');
            frame.srcdoc = '';
        }
        editorEl.classList.remove('hidden');
        if (toolbar)
            toolbar.style.display = 'flex';
        if (toggleBtn)
            toggleBtn.textContent = '👁 预览';
        if (errCon)
            errCon.classList.add('hidden');
        const file = state.openFiles[state.activeFileIndex];
        if (file && (file.language === 'html' || file.language === 'xml' || file.language === 'markdown')) {
            const model = monaco.editor.createModel(file.content, file.language);
            editor?.setModel(model);
        }
    }
}
function wrapHtmlWithErrorCapture(html) {
    // 注入错误捕获脚本
    const errorScript = `
<script>
window.onerror = function(msg, url, line, col, err) {
  var detail = (err && err.stack) ? err.stack : msg + ' (line ' + line + ':' + col + ')';
  try {
    window.parent.postMessage({ type: 'html-error', detail: String(detail) }, '*');
  } catch(e) {}
};
window.addEventListener('unhandledrejection', function(e) {
  try {
    window.parent.postMessage({ type: 'html-error', detail: String(e.reason) }, '*');
  } catch(_) {}
});
</script>`;
    // 注入到 </head> 或 <body> 之前
    if (html.includes('</head>')) {
        return html.replace('</head>', errorScript + '</head>');
    }
    else if (html.includes('<body')) {
        return html.replace('<body', errorScript + '<body');
    }
    return errorScript + html;
}
// 监听 iframe 错误消息
window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'html-error') {
        const errCon = document.getElementById('html-error-console');
        const indicator = document.getElementById('html-error-indicator');
        if (errCon) {
            errCon.classList.remove('hidden');
            errCon.innerHTML += `<div class="html-error-line">⚠ ${e.data.detail}</div>`;
        }
        if (indicator)
            indicator.classList.remove('hidden');
    }
});
document.getElementById('html-mode-toggle')?.addEventListener('click', () => toggleHtmlMode());
// ═══ AI 文件大纲生成 ═══
function generateFileOutline(content, lang) {
    const lines = content.split('\n');
    const parts = [];
    // 搜索结构化标记
    const patterns = [];
    if (['html', 'xml'].includes(lang)) {
        patterns.push({ regex: /<\s*(\w+)[\s>]/g, label: '<$1>' });
    }
    else if (['typescript', 'javascript'].includes(lang)) {
        patterns.push({ regex: /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/gm, label: 'fn $1()' }, { regex: /^(?:export\s+)?class\s+(\w+)/gm, label: 'class $1' }, { regex: /^\s*\/\/\s*(={2,}|#{1,4})\s*(.+)/gm, label: '## $2' });
    }
    else if (['kotlin', 'java'].includes(lang)) {
        patterns.push({ regex: /^(?:public\s+|private\s+|internal\s+|protected\s+)?(?:suspend\s+)?fun\s+(\w+)/gm, label: 'fun $1()' }, { regex: /^(?:data\s+)?class\s+(\w+)/gm, label: 'class $1' });
    }
    else if (lang === 'python') {
        patterns.push({ regex: /^class\s+(\w+)/gm, label: 'class $1' }, { regex: /^def\s+(\w+)/gm, label: 'def $1()' });
    }
    else if (lang === 'css') {
        patterns.push({ regex: /^([.#@]?[\w-]+)\s*\{/gm, label: '$1 {}' });
    }
    else {
        // 通用:搜索缩进为 0 的行(顶层结构)
        patterns.push({ regex: /^(?!\s)(.+)$/gm, label: '$1' });
    }
    const found = new Map();
    for (const p of patterns) {
        for (const m of content.matchAll(p.regex)) {
            const lineNum = (content.slice(0, m.index).match(/\n/g) || []).length + 1;
            const name = p.label.replace('$1', m[1]).replace('$2', (m[2] || ''));
            if (name.trim().length < 100) {
                found.set(lineNum, name.slice(0, 80));
            }
        }
    }
    // 按行号排序,最多 100 条
    const sorted = Array.from(found.entries()).sort((a, b) => a[0] - b[0]).slice(0, 100);
    if (sorted.length === 0) {
        // 降级:显示行号范围
        const chunkSize = Math.ceil(lines.length / 20);
        for (let i = 1; i <= lines.length; i += chunkSize) {
            const line = lines[i - 1]?.trim().slice(0, 60) || '';
            parts.push(`L${i}: ${line}`);
        }
    }
    else {
        for (const [ln, name] of sorted) {
            parts.push(`L${ln}: ${name}`);
        }
    }
    return `共 ${lines.length} 行,${sorted.length} 个结构标记:\n${parts.join('\n')}`;
}
function streamToAI(userMsg, ctxMsg, fileName) {
    const chatInput = document.getElementById('chat-input');
    if (chatInput)
        chatInput.value = '';
    state.isStreaming = true;
    state.currentStreamContent = '';
    document.getElementById('btn-send').classList.add('hidden');
    document.getElementById('btn-abort').classList.remove('hidden');
    (async () => {
        try {
            const session = ensureSession();
            const msg = [
                { role: 'system', content: `你是虎猫 TCIDE 本地 IDE 的 AI 助手。当前文件: ${fileName}。严禁说「我看不到」「无法访问」。` },
                { role: 'user', content: userMsg + '\n\n' + ctxMsg },
            ];
            window.api.sendToAIStream(msg, { model: state.config.model });
            showTypingIndicator();
            session.updatedAt = Date.now();
        }
        catch (err) {
            addChatMessage('assistant', `错误: ${err.message}`);
            stopStreaming();
        }
    })();
}
function updateEditorStatusBar(language) {
    if (language) {
        const langLabels = {
            pdf: 'PDF 预览', markdown: 'Markdown (DOCX 提取)',
            plainText: '纯文本', plaintext: '纯文本',
            javascript: 'JavaScript', typescript: 'TypeScript',
            python: 'Python', kotlin: 'Kotlin', java: 'Java',
            go: 'Go', rust: 'Rust', cpp: 'C++', c: 'C',
            csharp: 'C#', ruby: 'Ruby', php: 'PHP',
            dart: 'Dart', swift: 'Swift', scala: 'Scala',
            lua: 'Lua', r: 'R', sql: 'SQL',
            html: 'HTML', css: 'CSS', xml: 'XML',
            json: 'JSON', yaml: 'YAML', toml: 'TOML',
            shell: 'Shell', powershell: 'PowerShell',
            gradle: 'Gradle', bat: 'Batch',
        };
        document.getElementById('status-language').textContent =
            langLabels[language] || language;
    }
}
// ─────────────────────────────────────────
// AI 面板 - Chat
// ─────────────────────────────────────────
function addChatMessage(role, content, attachList) {
    const msg = {
        id: crypto.randomUUID(),
        role, content,
        timestamp: Date.now(),
        attachments: attachList?.length ? attachList : undefined,
    };
    // 保存到当前会话
    ensureSession().chatHistory.push(msg);
    // 渲染
    renderChatMessage(msg);
}
// ── MCP 工具调用显示 ──
let toolCallElements = new Map();
function addToolCallMessage(name, args, id) {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-message tool-call';
    el.id = 'tool-' + id;
    const emoji = { read_file: '📖', write_file: '✏️', list_files: '📁', search_code: '🔍', run_command: '⚡', git_status: '🔀', git_diff: '📊' };
    const argStr = args.path ? args.path.split('/').pop()?.split('\\').pop() || '' : '';
    el.innerHTML = '<div class="tool-call-header">🔧 <b>' + name + '</b> ' + argStr + ' <span class="tool-status">⏳</span></div>';
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
    toolCallElements.set(id, el);
}
function updateToolCallResult(id, result, error) {
    const el = toolCallElements.get(id);
    if (!el)
        return;
    if (error) {
        el.querySelector('.tool-status').textContent = '❌';
        el.innerHTML += '<div class="tool-result error">' + (error || '').replace(/</g, '&lt;') + '</div>';
    }
    else {
        el.querySelector('.tool-status').textContent = '✅';
        const preview = (result || '').slice(0, 300);
        el.innerHTML += '<div class="tool-result">' + preview.replace(/</g, '&lt;').replace(/>/g, '&gt;') + (result.length > 300 ? '...' : '') + '</div>';
    }
    const container = document.getElementById('chat-messages');
    container.scrollTop = container.scrollHeight;
}
function appendStreamChunk(chunk) {
    const container = document.getElementById('chat-messages');
    let lastMsg = container.lastElementChild;
    if (!lastMsg || !lastMsg.classList.contains('assistant')) {
        lastMsg = document.createElement('div');
        lastMsg.className = 'chat-message assistant';
        lastMsg.setAttribute('data-role', 'assistant');
        lastMsg.innerHTML = `
      <div class="msg-avatar">🐯</div>
      <div class="msg-body">
        <div class="msg-header">
          <span class="msg-role">虎猫 AI</span>
          <span class="msg-time">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="msg-content"></div>
      </div>`;
        container.appendChild(lastMsg);
    }
    state.currentStreamContent += chunk;
    const contentEl = lastMsg.querySelector('.msg-content');
    // 检查流式内容中的思考块
    const { contentHtml, thinkingHtml } = parseThinking(state.currentStreamContent);
    const thinkEl = lastMsg.querySelector('.msg-body .thinking-block');
    if (thinkingHtml && !thinkEl) {
        const body = lastMsg.querySelector('.msg-body');
        const header = body.querySelector('.msg-header');
        const temp = document.createElement('div');
        temp.innerHTML = thinkingHtml;
        const thinkBlock = temp.querySelector('.thinking-block');
        if (thinkBlock && header) {
            header.after(thinkBlock);
        }
    }
    else if (thinkingHtml && thinkEl) {
        thinkEl.querySelector('.thinking-content').innerHTML = parseThinking(state.currentStreamContent).thinkingHtml.match(/<div class="thinking-content">([\s\S]*)<\/div>/)?.[1] || '';
    }
    contentEl.innerHTML = contentHtml;
    container.scrollTop = container.scrollHeight;
}
function renderMarkdown(text) {
    // 先用占位符替换代码块,处理完其他 markdown 后再还原
    const codeBlocks = [];
    let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_m, lang, code) => {
        codeBlocks.push({ lang: lang || '', code });
        return `___CODEBLOCK_${codeBlocks.length - 1}___`;
    });
    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    // 还原代码块：带语言标签 + 复制按钮 + 长代码折叠
    html = html.replace(/___CODEBLOCK_(\d+)___/g, (_m, idx) => {
        const block = codeBlocks[parseInt(idx)];
        if (!block)
            return '';
        const escaped = block.code
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
        const langLabel = block.lang ? `<span class="code-lang">${block.lang}</span>` : '';
        const codeId = 'cb_' + Math.random().toString(36).slice(2, 8);
        const langLower = (block.lang || '').toLowerCase();
        const previewable = ['html', 'htm', 'xml', 'svg', 'css', 'javascript', 'js', 'typescript', 'ts'];
        const canPreview = previewable.includes(langLower);
        const runnable = ['python', 'py', 'javascript', 'js', 'typescript', 'ts', 'shell', 'bash', 'bat', 'cmd'];
        const canRun = runnable.includes(langLower);
        const escapedLang = block.lang.replace(/'/g, "\\'");
        const actionsHtml = `
      <button class="code-action-btn code-open-btn" title="在编辑器中打开" 
        onclick="event.stopPropagation();(function(){const el=document.getElementById('${codeId}');const code=el?el.textContent:'';window.__openCodeInEditor__('${escapedLang}',code)})()">📂 打开</button>
      ${canPreview ? `<button class="code-action-btn code-preview-btn" title="预览效果"
        onclick="event.stopPropagation();(function(){const el=document.getElementById('${codeId}');const code=el?el.textContent:'';window.__previewCode__('${escapedLang}',code)})()">👁 预览</button>` : ''}
      ${canRun ? `<button class="code-action-btn code-run-btn" title="运行代码"
        onclick="event.stopPropagation();(function(){const el=document.getElementById('${codeId}');const code=el?el.textContent:'';window.__runCode__('${escapedLang}',code)})()">▶ 运行</button>` : ''}
      <button class="code-action-btn code-save-btn" title="保存到项目"
        onclick="event.stopPropagation();(function(){const el=document.getElementById('${codeId}');const code=el?el.textContent:'';window.__saveCodeToProject__('${escapedLang}',code)})()">💾 保存</button>
    `;
        const lineCount = (block.code.match(/\n/g) || []).length + 1;
        const FOLD_THRESHOLD = 10;
        const FOLD_LINES = 8;
        const needsFold = lineCount > FOLD_THRESHOLD;
        let codeBlockHtml;
        if (needsFold) {
            const foldEscaped = escaped.split('\n').slice(0, FOLD_LINES).join('\n');
            codeBlockHtml = `<div class="code-block-wrapper code-block-folded" id="${codeId}_wrap">
      <div class="code-block-header">${langLabel}<span class="code-block-spacer"></span>${actionsHtml}<button class="copy-code-btn" onclick="var t=this.parentElement.parentElement.querySelector('code').textContent;navigator.clipboard.writeText(t).then(()=>{this.textContent='✓已复制';setTimeout(()=>{this.textContent='📋 复制'},2000)})">📋 复制</button></div>
      <pre class="code-block-pre folded"><code id="${codeId}" class="lang-${block.lang}">${foldEscaped}</code></pre>
      <div class="code-fold-bar" onclick="event.stopPropagation();var w=document.getElementById('${codeId}_wrap');var p=w.querySelector('.code-block-pre');var b=w.querySelector('.code-fold-bar');if(p.classList.contains('folded')){p.classList.remove('folded');p.querySelector('code').textContent=decodeURIComponent('${encodeURIComponent(block.code).replace(/'/g, "\\'")}');b.innerHTML='🔼 收起 (${lineCount}行)'}else{p.classList.add('folded');p.querySelector('code').textContent=decodeURIComponent('${encodeURIComponent(block.code.split('\\n').slice(0,FOLD_LINES).join('\\n'))}');b.innerHTML='🔽 展开全部 (${lineCount}行)'}">🔽 展开全部 (${lineCount}行)</div>
    </div>`;
        } else {
            codeBlockHtml = `<div class="code-block-wrapper">
      <div class="code-block-header">${langLabel}<span class="code-block-spacer"></span>${actionsHtml}<button class="copy-code-btn" onclick="var t=this.parentElement.parentElement.querySelector('code').textContent;navigator.clipboard.writeText(t).then(()=>{this.textContent='✓已复制';setTimeout(()=>{this.textContent='📋 复制'},2000)})">📋 复制</button></div>
      <pre class="code-block-pre"><code id="${codeId}" class="lang-${block.lang}">${escaped}</code></pre>
    </div>`;
        }
        return codeBlockHtml;
    });
    return html;
}
// ─────────────────────────────────────────
// Markdown 预览包装（用于文件预览 iframe）
// ─────────────────────────────────────────
function wrapMarkdownForPreview(mdContent) {
    const mdHtml = renderMarkdown(mdContent);
    const css = `
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;font-size:15px;line-height:1.7;color:#1f2328;max-width:860px;margin:0 auto;padding:32px 40px;background:#fff}
h1{font-size:2em;border-bottom:1px solid #d8dee4;padding-bottom:.3em;margin:24px 0 16px}
h2{font-size:1.5em;border-bottom:1px solid #d8dee4;padding-bottom:.3em;margin:24px 0 16px}
h3{font-size:1.25em;margin:24px 0 16px}
h4{font-size:1em;margin:24px 0 16px}
p{margin:0 0 16px}
code{background:#f6f8fa;padding:.2em .4em;border-radius:3px;font-size:85%;font-family:ui-monospace,'Cascadia Code','Fira Code',monospace}
pre{background:#f6f8fa;padding:16px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0;font-size:13px;line-height:1.5}
li{margin:4px 0}
ul,ol{padding-left:2em}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #d8dee4;padding:8px 12px;text-align:left}
th{background:#f6f8fa}
blockquote{border-left:3px solid #d8dee4;padding:0 1em;color:#656d76;margin:0 0 16px}
a{color:#0969da}
hr{border:none;border-top:1px solid #d8dee4;margin:24px 0}
img{max-width:100%}
strong{font-weight:600}
</style>`;
    return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + css + '</head><body>' + mdHtml + '</body></html>';
}
// ─────────────────────────────────────────
// AI 代码块：打开编辑 / 预览
// ─────────────────────────────────────────
// 全局桥接：从 onclick handler 调用（代码块中的按钮）
self.__openCodeInEditor__ = function (lang, code) {
    if (!editor) {
        showToast('编辑器未初始化', 'warning');
        return;
    }
    // 推断文件名
    const extMap = {
        html: '.html', htm: '.html', xml: '.xml', svg: '.svg',
        css: '.css',
        javascript: '.js', js: '.js', jsx: '.jsx',
        typescript: '.ts', ts: '.ts', tsx: '.tsx',
        python: '.py', py: '.py',
        java: '.java', kotlin: '.kt', kt: '.kt',
        c: '.c', cpp: '.cpp', csharp: '.cs', cs: '.cs',
        go: '.go', rust: '.rs', rs: '.rs',
        json: '.json', yaml: '.yml', yml: '.yml',
        markdown: '.md', md: '.md',
        shell: '.sh', bash: '.sh', bat: '.bat',
        sql: '.sql',
    };
    const ext = extMap[lang.toLowerCase()] || '.txt';
    const name = `ai-generated-${Date.now().toString(36)}${ext}`;
    // 在编辑区打开
    const model = editor.getModel();
    if (model && model.getValue() === '' && state.openFiles.length <= 1) {
        // 如果当前是空白页，直接替换
        model.setValue(code);
        const langId = mapLangToMonaco(lang);
        monaco.editor.setModelLanguage(model, langId);
        showToast(`已加载到编辑器 (${name})`, 'success');
    }
    else {
        // 新建标签页
        const langId = mapLangToMonaco(lang);
        state.openFiles.push({ name, path: `virtual://${name}`, content: code, language: langId, dirty: false, isAI: true });
        state.activeFileIndex = state.openFiles.length - 1;
        switchToFile(state.activeFileIndex);
        renderTabs();
        showToast(`已打开: ${name}`, 'success');
    }
    // 缓存到本地 .tcide/generated/
    cacheAICode(name, code);
};
let _lastPreviewFrame = null;
self.__previewCode__ = function (lang, code) {
    const langLower = lang.toLowerCase();
    // 找到或创建预览面板
    let previewContainer = document.getElementById('code-preview-panel');
    if (!previewContainer) {
        previewContainer = document.createElement('div');
        previewContainer.id = 'code-preview-panel';
        previewContainer.className = 'code-preview-panel';
        previewContainer.innerHTML = `
      <div class="code-preview-header">
        <span class="code-preview-title" id="code-preview-title">代码预览</span>
        <button class="code-preview-close" onclick="document.getElementById('code-preview-panel').remove()">✕</button>
        <button class="code-preview-open-editor" id="code-preview-open-btn" title="在编辑器中打开">📂 编辑</button>
      </div>
      <div class="code-preview-content">
        <iframe id="code-preview-frame" class="code-preview-frame" sandbox="allow-scripts allow-same-origin"></iframe>
      </div>
    `;
        document.body.appendChild(previewContainer);
        // 打开编辑按钮事件
        document.getElementById('code-preview-open-btn')?.addEventListener('click', () => {
            self.__openCodeInEditor__(lang, code);
            previewContainer?.remove();
        });
    }
    const title = document.getElementById('code-preview-title');
    if (title)
        title.textContent = `代码预览 · ${lang}`;
    const frame = document.getElementById('code-preview-frame');
    if (frame) {
        if (langLower === 'html' || langLower === 'htm') {
            frame.srcdoc = code;
        }
        else if (langLower === 'svg') {
            const blob = new Blob([code], { type: 'image/svg+xml' });
            frame.src = URL.createObjectURL(blob);
        }
        else if (langLower === 'css') {
            frame.srcdoc = `<html><head><style>${code}</style></head><body><div style="padding:40px;font-family:sans-serif;color:#888">CSS 预览 — 样式已应用到此页面</div></body></html>`;
        }
        else if (langLower === 'javascript' || langLower === 'js' || langLower === 'ts') {
            frame.srcdoc = `<html><head></head><body><div id="output" style="padding:20px;font-family:monospace"></div><script>try{const out=document.getElementById('output');const origLog=console.log;console.log=function(...args){out.innerHTML+=args.join(' ')+'<br>'};${code};console.log=origLog}catch(e){document.getElementById('output').innerHTML='<span style="color:red">❌ Error: '+e.message+'</span>'}<\/script></body></html>`;
        }
        else {
            frame.srcdoc = `<html><body style="padding:20px;font-family:monospace;background:#1e1e1e;color:#d4d4d4"><h3>🔍 ${lang} 源码预览</h3><pre style="white-space:pre-wrap">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre></body></html>`;
        }
    }
    _lastPreviewFrame = frame;
    previewContainer.classList.remove('hidden');
};
// ── ▶ 运行 AI 代码 ──
self.__runCode__ = async function (lang, code) {
    const langLower = lang.toLowerCase();
    const ext = langLower === 'shell' || langLower === 'bash' ? '.sh' : langLower === 'bat' || langLower === 'cmd' ? '.bat' : langLower === 'py' ? '.py' : langLower === 'js' ? '.js' : langLower === 'ts' ? '.ts' : '.txt';
    const name = `run-${Date.now().toString(36)}${ext}`;
    if (!state.projectPath) {
        // 无项目时用临时文件
        try {
            const tmpDir = window.os?.tmpdir?.() || process.env.TEMP || '/tmp';
            const tmpPath = `${tmpDir}/${name}`;
            await window.fs?.writeFile?.(tmpPath, code);
            const cmd = ext === '.py' ? `python "${tmpPath}"` : ext === '.js' || ext === '.ts' ? `node "${tmpPath}"` : ext === '.sh' ? `bash "${tmpPath}"` : ext === '.bat' ? `"${tmpPath}"` : `echo "该语言暂不支持直接运行"`;
            addChatMessage('system', `▶ 执行: \`${cmd}\``);
            const result = await window.api.execCommand(cmd, state.projectPath);
            addChatMessage('system', `\`\`\`\n${result.stdout || result.stderr || '(无输出)'}\n\`\`\``);
        }
        catch (e) {
            showToast('运行失败: ' + (e.message || e), 'error');
        }
        return;
    }
    // 有项目：写入临时文件再执行
    try {
        const genDir = `${state.projectPath}/.tcide/generated`;
        await window.api.writeFile(`${genDir}/${name}`, code);
        const cmd = ext === '.py' ? `python "${genDir}/${name}"` : ext === '.js' ? `node "${genDir}/${name}"` : ext === '.sh' ? `bash "${genDir}/${name}"` : ext === '.bat' ? `"${genDir}/${name}"` : `echo "运行已写入 ${name}"`;
        addChatMessage('system', `▶ 执行: \`${cmd}\``);
        const result = await window.api.execCommand(cmd, state.projectPath);
        addChatMessage('system', `\`\`\`\n${result.stdout || result.stderr || '(无输出)'}\n\`\`\``);
    }
    catch (e) {
        showToast('运行失败: ' + (e.message || e), 'error');
    }
};
// ── 💾 保存 AI 代码到项目 ──
self.__saveCodeToProject__ = function (lang, code) {
    if (!state.projectPath) {
        showToast('请先打开项目', 'warning');
        return;
    }
    // 弹出文件名输入框
    const extMap = {
        html: '.html', htm: '.html', xml: '.xml', svg: '.svg',
        css: '.css', scss: '.scss', less: '.less',
        javascript: '.js', js: '.js', jsx: '.jsx',
        typescript: '.ts', ts: '.ts', tsx: '.tsx',
        python: '.py', py: '.py', java: '.java', kotlin: '.kt',
        c: '.c', cpp: '.cpp', csharp: '.cs',
        go: '.go', rust: '.rs',
        json: '.json', yaml: '.yml', yml: '.yml',
        markdown: '.md', md: '.md',
        shell: '.sh', bash: '.sh', bat: '.bat',
        sql: '.sql', terraform: '.tf',
    };
    const ext = extMap[lang.toLowerCase()] || '.txt';
    const defaultName = `ai-code-${Date.now().toString(36)}${ext}`;
    showSaveDialog(defaultName, async (filePath) => {
        try {
            await window.api.writeFile(filePath, code);
            const shortName = filePath.replace(/\\/g, '/').split('/').pop() || filePath;
            showToast(`已保存: ${shortName}`, 'success');
            // 在编辑器中打开已保存的文件
            const langId = mapLangToMonaco(lang);
            state.openFiles.push({ name: shortName, path: filePath, content: code, language: langId, dirty: false, isAI: false });
            state.activeFileIndex = state.openFiles.length - 1;
            switchToFile(state.activeFileIndex);
            renderTabs();
        }
        catch (e) {
            showToast('保存失败: ' + (e.message || e), 'error');
        }
    });
};
// 通用输入对话框
function showSaveDialog(defaultName, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.style.zIndex = '9999';
    overlay.innerHTML = `
    <div class="confirm-dialog" style="min-width:380px">
      <div class="confirm-msg">💾 保存到项目</div>
      <div style="color:var(--text-secondary);font-size:12px;margin:4px 0 12px">文件名（相对项目根目录）</div>
      <input id="__save_dialog_input__" type="text" value="${defaultName}" style="width:100%;padding:8px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border-color);border-radius:4px;font-size:13px;box-sizing:border-box">
      <div class="confirm-actions" style="margin-top:12px">
        <button class="btn-confirm-cancel">取消</button>
        <button class="btn-confirm-ok">保存</button>
      </div>
    </div>`;
    const input = overlay.querySelector('#__save_dialog_input__');
    overlay.querySelector('.btn-confirm-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.btn-confirm-ok')?.addEventListener('click', () => {
        const val = input.value.trim();
        if (!val)
            return;
        overlay.remove();
        onConfirm(`${state.projectPath}/${val}`);
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.dispatchEvent(new Event('change'));
            overlay.querySelector('.btn-confirm-ok')?.dispatchEvent(new Event('click'));
        }
        if (e.key === 'Escape') {
            overlay.remove();
        }
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay)
        overlay.remove(); });
    document.body.appendChild(overlay);
    input.focus();
    input.select();
}
// 缓存 AI 生成的代码
async function cacheAICode(name, code) {
    if (!state.projectPath)
        return;
    try {
        const dir = `${state.projectPath}/.tcide/generated`;
        await window.api.writeFile(`${dir}/${name}`, code);
    }
    catch {
        // 静默失败 — .tcide/generated 可能不存在或没有权限
        try {
            const dir = `${state.projectPath}/.tcide`;
            const genDir = `${dir}/generated`;
            await window.api.writeFile(`${genDir}/_init_`, '');
            await window.api.writeFile(`${genDir}/${name}`, code);
        }
        catch { /* 忽略 */ }
    }
}
// 将语言名映射到 Monaco language ID
function mapLangToMonaco(lang) {
    const map = {
        html: 'html', htm: 'html', xml: 'xml', svg: 'xml',
        css: 'css', scss: 'scss', less: 'less',
        javascript: 'javascript', js: 'javascript', jsx: 'javascript', cjs: 'javascript', mjs: 'javascript',
        typescript: 'typescript', ts: 'typescript', tsx: 'typescript', mts: 'typescript',
        python: 'python', py: 'python',
        java: 'java', kotlin: 'kotlin', kt: 'kotlin',
        c: 'c', cpp: 'cpp', csharp: 'csharp', cs: 'csharp',
        go: 'go', rust: 'rust', rs: 'rust',
        json: 'json', yaml: 'yaml', yml: 'yaml',
        markdown: 'markdown', md: 'markdown',
        shell: 'shell', bash: 'shell', bat: 'bat',
        sql: 'sql',
    };
    return map[lang.toLowerCase()] || 'plaintext';
}
// ─────────────────────────────────────────
// 附件管理
// ─────────────────────────────────────────
function isImageFile(name) {
    const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
    return IMG_EXTS.has(ext);
}
function isTextFile(name) {
    const ext = name.toLowerCase().slice(name.lastIndexOf('.'));
    return TXT_EXTS.has(ext);
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return bytes + 'B';
    if (bytes < 1024 * 1024)
        return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(1) + 'MB';
}
function fileIcon(ext) {
    const map = {
        '.ts': '📘', '.tsx': '📘', '.js': '📒', '.jsx': '📒',
        '.json': '📋', '.xml': '📋', '.html': '🌐', '.css': '🎨',
        '.md': '📝', '.py': '🐍', '.go': '🔵', '.rs': '🦀',
        '.java': '☕', '.kt': '☕', '.kts': '☕', '.gradle': '🐘',
        '.yaml': '⚙️', '.yml': '⚙️', '.toml': '⚙️', '.ini': '⚙️',
        '.sh': '💻', '.bat': '💻', '.sql': '🗃️', '.csv': '📊',
        '.txt': '📄', '.log': '📄',
        '.docx': '📝', '.doc': '📝', '.pdf': '📕',
        '.xlsx': '📊', '.xls': '📊', '.pptx': '📽️', '.ppt': '📽️',
        '.zip': '📦', '.rar': '📦', '.gz': '📦',
        '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '🖼️',
    };
    return map[ext] || '📎';
}
async function openAttachDialog() {
    try {
        const files = await window.api.openFileDialog();
        if (!files || files.length === 0)
            return;
        for (const f of files) {
            const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
            const isImg = IMG_EXTS.has(ext);
            const maxSize = isImg ? MAX_IMG_SIZE : MAX_FILE_SIZE;
            if (f.size > maxSize) {
                showToast(`文件 "${f.name}" 超过 ${formatFileSize(maxSize)} 限制`, 'warn');
                continue;
            }
            const id = crypto.randomUUID();
            const meta = { id, name: f.name, path: f.path, size: f.size, type: isImg ? 'image' : 'file', mime: isImg ? 'image/' + ext.slice(1) : 'text/plain' };
            // 图片立即转 base64
            if (isImg) {
                try {
                    meta.dataUrl = await window.api.readFileAsDataURL(f.path);
                }
                catch (_) { /* 转换失败则回退 */ }
            }
            attachments.push(meta);
        }
        renderAttachmentBar();
    }
    catch (err) {
        showToast('打开文件失败: ' + (err.message || err), 'error');
    }
}
function removeAttachment(id) {
    attachments = attachments.filter(a => a.id !== id);
    renderAttachmentBar();
}
function renderAttachmentBar() {
    const bar = document.getElementById('attachment-preview');
    if (attachments.length === 0) {
        bar.classList.add('hidden');
        bar.innerHTML = '';
        return;
    }
    bar.classList.remove('hidden');
    bar.innerHTML = attachments.map(a => {
        const ext = a.name.slice(a.name.lastIndexOf('.'));
        const isImg = a.type === 'image';
        return `<div class="attachment-item ${isImg ? 'att-image' : ''}" data-att-id="${a.id}" title="${a.name}">
      ${isImg ? `<span class="att-icon">🖼️</span><span class="att-name">${a.name}</span>`
            : `<span class="att-icon">${fileIcon(ext)}</span><span class="att-name">${a.name}</span><span class="att-size">${formatFileSize(a.size)}</span>`}
      <span class="att-remove" data-remove="${a.id}">✕</span>
    </div>`;
    }).join('');
    // 绑定删除事件
    bar.querySelectorAll('.att-remove').forEach(el => {
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            removeAttachment(el.dataset.remove);
        });
    });
}
// ─────────────────────────────────────────
// 模型快速切换
// ─────────────────────────────────────────
function populateModelSelector() {
    const sel = document.getElementById('quick-model-select');
    if (!sel)
        return;
    const provider = state.config.provider || 'deepseek';
    const providerModels = modelListCache.filter(m => m.provider === provider);
    // 头部:已配置 provider 的模型
    sel.innerHTML = '<option value="">-- 选择模型 --</option>';
    if (providerModels.length > 0) {
        const icon = provider === 'deepseek' ? '🐋' : provider === 'huoshan' ? '🌋' : provider === 'ollama' ? '🦙' : '⚙️';
        for (const m of providerModels) {
            const reasoning = m.reasoning ? ' 🧠' : '';
            const selected = state.config.model === m.id ? ' selected' : '';
            sel.innerHTML += `<option value="${m.provider}|${m.id}"${selected}>${icon} ${m.name}${reasoning}</option>`;
        }
    }
    // 分隔线 + 其他 provider 的模型(归入"自定义")
    const otherModels = modelListCache.filter(m => m.provider !== provider);
    if (otherModels.length > 0) {
        sel.innerHTML += '<option disabled>──────────</option>';
        for (const m of otherModels) {
            sel.innerHTML += `<option value="${m.provider}|${m.id}">🔌 ${m.name} (${m.provider})</option>`;
        }
    }
    updateModelStatusDot();
}
function updateModelStatusDot() {
    const dot = document.getElementById('model-status');
    if (!dot)
        return;
    if (state.config.apiKey) {
        dot.className = 'model-status connected';
        dot.title = '已配置: ' + state.config.model;
    }
    else {
        dot.className = 'model-status disconnected';
        dot.title = '未配置 API Key';
    }
}
function onQuickModelChange() {
    const sel = document.getElementById('quick-model-select');
    const val = sel.value;
    if (!val)
        return;
    const [provider, modelId] = val.split('|');
    const meta = modelListCache.find(m => m.provider === provider && m.id === modelId);
    if (!meta)
        return;
    state.config.provider = provider;
    state.config.model = modelId;
    // 自动填充 baseUrl
    const defaultBaseUrls = {
        deepseek: 'https://api.deepseek.com/v1',
        huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
        anthropic: 'https://api.anthropic.com',
        custom: '',
    };
    state.config.baseUrl = defaultBaseUrls[provider] || '';
    updateModelStatusDot();
    updateModelIndicator();
    showToast(`已切换到 ${meta.name}`, 'info');
    saveConfig().catch(() => { });
}
// ═══════════════════════════════════════════
// 多会话管理
// ═══════════════════════════════════════════
function ensureSession() {
    if (!state.currentSessionId || !state.chatSessions.find(s => s.id === state.currentSessionId)) {
        createSession();
    }
    const s = state.chatSessions.find(s => s.id === state.currentSessionId);
    // 向后兼容:迁移旧 chatHistory
    if (state.chatHistory.length > 0 && s.chatHistory.length === 0) {
        s.chatHistory = [...state.chatHistory];
        state.chatHistory = [];
    }
    return s;
}
function createSession(name) {
    const id = crypto.randomUUID();
    // 去重：避免重名 session（旧版可能产生重复）
    const safeName = name || `对话 ${state.chatSessions.length + 1}`;
    const session = {
        id,
        name: safeName,
        chatHistory: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        projectPath: state.projectPath || undefined,
    };
    state.chatSessions.unshift(session);
    state.currentSessionId = id;
    renderChatList();
    return session;
}
// ═══ 会话持久化(聊天记忆) ═══
async function saveSessionsToDisk() {
    if (!state.projectPath)
        return;
    try {
        const tcideDir = `${state.projectPath}/.tcide/chat`;
        // Ensure directory exists before writing
        try { await window.api.createDir(tcideDir); } catch {}
        // 只保存最近 500 条消息
        const data = JSON.stringify(state.chatSessions.map(s => ({
            id: s.id, name: s.name, customName: s.customName, chatHistory: s.chatHistory.slice(-500),
            createdAt: s.createdAt, updatedAt: s.updatedAt, projectPath: s.projectPath,
        })));
        await window.api.writeFile(`${tcideDir}/sessions.json`, data);
    }
    catch (e) {
        console.warn('[虎猫] 保存会话失败:', e);
    }
}
async function loadSessionsFromDisk() {
    if (!state.projectPath)
        return;
    try {
        const raw = await window.api.readTextFile(`${state.projectPath}/.tcide/chat/sessions.json`);
        if (!raw)
            return;
        const data = JSON.parse(raw);
        if (Array.isArray(data) && data.length > 0) {
            state.chatSessions = data.map((s) => ({
                id: s.id, name: s.name, chatHistory: s.chatHistory || [],
                createdAt: s.createdAt, updatedAt: Date.now(), projectPath: s.projectPath,
            }));
            state.currentSessionId = state.chatSessions[0].id;
            renderChatList();
            renderChatHistory();
            addChatMessage('system', `📂 已恢复 ${state.chatSessions.length} 个历史会话`);
        }
    }
    catch (e) {
        // 文件不存在或损坏,忽略
    }
}
// ═══ AI 分段读取交互 ═══
function confirmAiRead(start, end) {
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    if (!session)
        return;
    if (!session.pendingReads)
        session.pendingReads = [];
    session.pendingReads.push({ start, end });
    const container = document.getElementById('chat-messages');
    if (!container)
        return;
    const readId = `read-${session.pendingReads.length}`;
    const file = state.openFiles[state.activeFileIndex];
    const readDiv = document.createElement('div');
    readDiv.className = 'chat-message system read-confirm';
    readDiv.id = readId;
    readDiv.innerHTML = `
    <div class="read-confirm-card">
      <div class="read-confirm-title">📖 虎猫想继续读取文件</div>
      <div class="read-confirm-file">${file?.name || '当前文件'} L${start}-L${end}</div>
      <div class="read-confirm-actions">
        <button class="btn-read-confirm">✅ 允许读取</button>
        <button class="btn-read-deny">❌ 拒绝</button>
      </div>
    </div>`;
    readDiv.querySelector('.btn-read-confirm')?.addEventListener('click', () => {
        readDiv.remove();
        executeAiRead(start, end);
    });
    readDiv.querySelector('.btn-read-deny')?.addEventListener('click', () => {
        readDiv.remove();
        addChatMessage('system', '⏭ 已拒绝分段读取请求');
    });
    container.appendChild(readDiv);
    readDiv.scrollIntoView({ behavior: 'smooth' });
}
async function executeAiRead(start, end) {
    if (state.activeFileIndex < 0)
        return;
    const file = state.openFiles[state.activeFileIndex];
    const lines = file.content.split('\n');
    const sliceStart = Math.max(0, start - 1);
    const sliceEnd = Math.min(lines.length, end);
    const chunk = lines.slice(sliceStart, sliceEnd).join('\n');
    addChatMessage('system', `📄 ${file.name} L${sliceStart + 1}-L${sliceEnd}:\n\`\`\`${file.language}\n${chunk}\n\`\`\``);
    state.isStreaming = true;
    state.currentStreamContent = '';
    document.getElementById('btn-send').classList.add('hidden');
    document.getElementById('btn-abort').classList.remove('hidden');
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    const historyMsgs = session.chatHistory.slice(-30).map(m => ({ role: m.role, content: m.content }));
    const msg = [
        { role: 'system', content: `你是虎猫 TCIDE 的 AI 助手。文件 ${file.name} 的 L${sliceStart + 1}-L${sliceEnd} 行已发送给你。如需继续,在回复中用 /read N-M 请求更多行。` },
        ...historyMsgs,
        { role: 'user', content: `已读取 L${sliceStart + 1}-L${sliceEnd},请继续分析。` },
    ];
    window.api.sendToAIStream(msg, { model: state.config.model });
    showTypingIndicator();
}
// ═══ 会话删除 / 重命名(带确认) ═══
function deleteSession(id) {
    const session = state.chatSessions.find(s => s.id === id);
    if (!session)
        return;
    const name = session.name;
    const title = session.chatHistory.find(m => m.role === 'user')?.content?.slice(0, 30) || name;
    showConfirm(`确定要删除「${title}」吗?此操作不可撤销。`, () => {
        state.chatSessions = state.chatSessions.filter(s => s.id !== id);
        if (state.currentSessionId === id) {
            state.currentSessionId = state.chatSessions[0]?.id || '';
            state.chatHistory = [];
            if (!state.chatSessions[0])
                createSession();
            renderChatHistory();
        }
        renderChatList();
        saveSessionsToDisk();
        showToast('已删除对话', 'success');
    });
}
function renameSession(id) {
    const session = state.chatSessions.find(s => s.id === id);
    if (!session)
        return;
    // 找到 DOM 中的标题元素进行内联编辑
    const titleEl = document.querySelector(`.chat-list-item[data-session-id="${id}"] .chat-list-title`);
    if (titleEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'chat-list-title-input';
        input.value = session.name;
        input.style.cssText = 'background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--tc-orange);border-radius:3px;padding:2px 6px;font-size:12px;width:100%;';
        titleEl.replaceWith(input);
        input.focus();
        input.select();
        const save = () => {
            const newName = input.value.trim();
            if (newName) {
                session.name = newName;
                session.customName = true;
                session.updatedAt = Date.now();
                showToast('已重命名', 'success');
            }
            renderChatList();
            saveSessionsToDisk();
        };
        input.addEventListener('blur', save);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                save();
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                renderChatList();
            }
        });
    }
}
/** 通用二次确认模态框 */
function showConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
    <div class="confirm-dialog">
      <div class="confirm-msg">${message}</div>
      <div class="confirm-actions">
        <button class="btn-confirm-cancel">取消</button>
        <button class="btn-confirm-ok">确定删除</button>
      </div>
    </div>`;
    overlay.querySelector('.btn-confirm-cancel')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('.btn-confirm-ok')?.addEventListener('click', () => { overlay.remove(); onConfirm(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay)
        overlay.remove(); });
    document.body.appendChild(overlay);
}
function switchSession(id) {
    state.currentSessionId = id;
    state.chatHistory = [];
    // 重新渲染消息
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    const session = state.chatSessions.find(s => s.id === id);
    if (session) {
        // 恢复 AI 欢迎页
        const welcome = document.getElementById('ai-welcome');
        if (welcome)
            welcome.style.display = '';
        // 重新渲染消息
        for (const msg of session.chatHistory) {
            renderChatMessage(msg);
        }
    }
    renderChatList();
}
function renderChatMessage(msg) {
    const container = document.getElementById('chat-messages');
    const welcome = document.getElementById('ai-welcome');
    if (welcome && welcome.style.display !== 'none') {
        welcome.style.display = 'none';
    }
    const el = document.createElement('div');
    el.className = `chat-message ${msg.role}`;
    el.setAttribute('data-role', msg.role);
    el.setAttribute('data-msg-id', msg.id);
    const avatars = { user: '🧑', assistant: '🐯', system: '⚙' };
    const labels = { user: '你', assistant: '虎猫 AI', system: '系统' };
    const timeStr = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    let attachHtml = '';
    if (msg.attachments?.length) {
        attachHtml = '<div class="msg-attachments">' + msg.attachments.map(a => {
            if (a.type === 'image') {
                const src = a.dataUrl || `tcide://${encodeURIComponent(a.name)}`;
                return `<img class="msg-attachment-img" src="${src}" alt="${a.name}" title="${a.name}" loading="lazy">`;
            }
            return `<span class="msg-attachment">📄 ${a.name}</span>`;
        }).join('') + '</div>';
    }
    // 解析思考过程 [reasoning]...[/reasoning]
    let { contentHtml, thinkingHtml } = parseThinking(msg.content);
    // 消息操作按钮（hover 显示）
    const actionsHtml = buildMsgActions(msg);
    // 多选复选框
    const selectHtml = chatSelectMode ? `<label class="msg-select-cb"><input type="checkbox" data-msg-id="${msg.id}" onchange="window.__chatToggleSelect__('${msg.id}', this.checked)"></label>` : '';
    el.innerHTML = `
    ${selectHtml}
    <div class="msg-avatar">${avatars[msg.role] || '💬'}</div>
    <div class="msg-body">
      <div class="msg-header">
        <span class="msg-role">${labels[msg.role] || msg.role}</span>
        <span class="msg-time">${timeStr}</span>
      </div>
      ${thinkingHtml}
      <div class="msg-content">${contentHtml}${attachHtml}</div>
      ${actionsHtml}
    </div>
  `;
    // 事件绑定
    wireMsgActions(el, msg);
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;
}
// ── 解析思考过程 ──
function parseThinking(content) {
    // 只在行首匹配 [reasoning]...[/reasoning]，避免正文中的误匹配
    const m = content.match(/(?:^|[\r\n])\[reasoning\]([\s\S]*?)\[\/reasoning\](?:[\r\n]|$)/);
    if (!m)
        return { contentHtml: renderMarkdown(content), thinkingHtml: '' };
    const thinking = m[1].trim();
    const mainContent = content.replace(/(?:^|[\r\n])\[reasoning\][\s\S]*?\[\/reasoning\](?:[\r\n]|$)/, '').trim();
    return {
        contentHtml: mainContent ? renderMarkdown(mainContent) : renderMarkdown(content),
        thinkingHtml: `<details class="thinking-block" open><summary class="thinking-summary">🧠 思考过程</summary><div class="thinking-content">${renderMarkdown(thinking)}</div></details>`
    };
}
// ── 消息操作按钮 ──
function buildMsgActions(msg) {
    if (msg.role === 'user') {
        return `<div class="msg-actions"><button class="msg-action-btn" data-action="copy" title="复制">📋</button><button class="msg-action-btn" data-action="edit" title="编辑">✏️</button><button class="msg-action-btn" data-action="delete" title="删除">🗑</button></div>`;
    }
    if (msg.role === 'assistant') {
        return `<div class="msg-actions"><button class="msg-action-btn" data-action="copy" title="复制">📋</button><button class="msg-action-btn" data-action="delete" title="删除">🗑</button><button class="msg-action-btn" data-action="share" title="分享">📤</button></div>`;
    }
    // system messages
    return `<div class="msg-actions"><button class="msg-action-btn" data-action="copy" title="复制">📋</button><button class="msg-action-btn" data-action="delete" title="删除">🗑</button></div>`;
}
// ── 消息操作事件 ──
function wireMsgActions(el, msg) {
    el.querySelectorAll('.msg-action-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const action = btn.dataset.action;
            handleMsgAction(msg.id, action);
        });
    });
}
function handleMsgAction(msgId, action) {
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    if (!session)
        return;
    const msg = session.chatHistory.find(m => m.id === msgId);
    if (!msg)
        return;
    if (action === 'copy') {
        navigator.clipboard.writeText(msg.content).then(() => showToast('已复制', 'success'));
    }
    else if (action === 'delete') {
        showConfirm('删除此消息?', () => {
            session.chatHistory = session.chatHistory.filter(m => m.id !== msgId);
            session.updatedAt = Date.now();
            renderChatHistory();
            saveSessionsToDisk();
        });
    }
    else if (action === 'edit') {
        editUserMessage(msg);
    }
    else if (action === 'share') {
        shareMessage(msg);
    }
}
// ── 编辑用户消息（回填到输入框）──
function editUserMessage(msg) {
    if (msg.role !== 'user')
        return;
    const input = document.getElementById('chat-input');
    if (!input)
        return;
    input.value = msg.content;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    showToast('已回填到输入框，修改后发送即可', 'info');
}
// ── 分享消息 ──
function shareMessage(msg) {
    const text = `【虎猫 TCIDE AI 对话】\n\n${msg.role === 'assistant' ? '🐯 虎猫 AI：\n' : '🧑 你：\n'}${msg.content}`;
    navigator.clipboard.writeText(text).then(() => showToast('已复制到剪贴板,可粘贴分享', 'success'));
}
// ── 多选模式 ──
let chatSelectMode = false;
let chatSelectedIds = new Set();
self.__chatToggleSelect__ = function (msgId, checked) {
    if (checked)
        chatSelectedIds.add(msgId);
    else
        chatSelectedIds.delete(msgId);
    updateSelectBarUI();
};
function toggleChatSelectMode() {
    chatSelectMode = !chatSelectMode;
    if (!chatSelectMode)
        chatSelectedIds.clear();
    updateSelectBarUI();
    renderChatHistory();
}
function updateSelectBarUI() {
    const bar = document.getElementById('chat-select-bar');
    if (!bar)
        return;
    if (chatSelectMode) {
        bar.classList.remove('hidden');
        bar.querySelector('.select-count').textContent = `已选 ${chatSelectedIds.size} 条`;
    }
    else {
        bar.classList.add('hidden');
    }
}
function deleteSelectedMessages() {
    if (chatSelectedIds.size === 0)
        return;
    showConfirm(`删除已选的 ${chatSelectedIds.size} 条消息?`, () => {
        const session = state.chatSessions.find(s => s.id === state.currentSessionId);
        if (!session)
            return;
        session.chatHistory = session.chatHistory.filter(m => !chatSelectedIds.has(m.id));
        session.updatedAt = Date.now();
        chatSelectedIds.clear();
        chatSelectMode = false;
        updateSelectBarUI();
        renderChatHistory();
        saveSessionsToDisk();
        showToast('已删除', 'success');
    });
}
function selectAllMessages() {
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    if (!session) return;
    chatSelectedIds = new Set(session.chatHistory.map(m => m.id));
    updateSelectBarUI();
    renderChatHistory();
}
function deleteAllMessages() {
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    if (!session || session.chatHistory.length === 0) return;
    showConfirm(`确定清空全部 ${session.chatHistory.length} 条消息?此操作不可撤销。`, () => {
        session.chatHistory = [];
        session.updatedAt = Date.now();
        chatSelectedIds.clear();
        chatSelectMode = false;
        updateSelectBarUI();
        renderChatHistory();
        saveSessionsToDisk();
        showToast('已清空全部消息', 'success');
    });
}
function clearChatSelectMode() {
    chatSelectedIds.clear();
    chatSelectMode = false;
    updateSelectBarUI();
    renderChatHistory();
}
// ── 重新渲染当前会话所有消息 ──
function renderChatHistory() {
    const container = document.getElementById('chat-messages');
    if (!container)
        return;
    const session = state.chatSessions.find(s => s.id === state.currentSessionId);
    if (!session)
        return;
    // 保留欢迎页（如果存在）和多选工具栏
    const welcome = container.querySelector('#ai-welcome');
    const selectBar = container.querySelector('#chat-select-bar');
    container.innerHTML = '';
    if (selectBar)
        container.appendChild(selectBar);
    if (welcome)
        container.appendChild(welcome);
    // 渲染所有消息
    session.chatHistory.forEach(msg => {
        renderChatMessage(msg);
    });
    // 若无消息且无欢迎页，恢复欢迎
    if (session.chatHistory.length === 0) {
        const wEl = document.createElement('div');
        wEl.id = 'ai-welcome';
        wEl.className = 'ai-welcome-section';
        wEl.innerHTML = `<div class="ai-welcome-icon">🐯</div><h3>虎猫 AI 已就绪</h3><p>输入问题或使用 /task 启动 Builder 自动编程</p>`;
        container.appendChild(wEl);
    }
}
async function sendToAI() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text && attachments.length === 0)
        return;
    if (state.isStreaming)
        return;
    if (!state.config.apiKey) {
        addChatMessage('system', '请先在设置中配置 API Key');
        switchToSettingsTab();
        return;
    }
    input.value = '';
    // ── 模式路由：Builder / Pipeline 模式自动触发任务执行 ──
    if (state.projectPath && !text.startsWith('/')) {
        if (currentAgentMode === 'builder') {
            addChatMessage('user', text);
            await executeTaskAgentLoop(text);
            return;
        }
        if (currentAgentMode === 'pipeline') {
            addChatMessage('user', text);
            await executeOrchestratorLoop(text);
            return;
        }
    }
    // ── /task 命令：Builder → Coder 自动执行循环 ──
    if (text.startsWith('/task') && state.projectPath) {
        const desc = text.replace(/^\/task\s*/, '').trim();
        if (!desc) {
            addChatMessage('assistant', '命令列表:\n/task <描述> - Builder 串行模式，自动拆分任务并执行\n/orch <描述> - 🚀 全流水线：Builder→并行Coder→Reviewer→Tester→自动修复\n/file - 发送当前文件给 AI(超大文件自动生成大纲)\n/lines N-M - 发送指定行范围，如 /lines 100-200');
            return;
        }
        addChatMessage('user', text);
        await executeTaskAgentLoop(desc);
        return;
    }
    // ── /orch 命令：AgentOrchestrator 🧱 Builder → 🔧并行 Coder池 → 🔍Reviewer → 🧪Tester ──
    if (text.startsWith('/orch') && state.projectPath) {
        const desc = text.replace(/^\/orch\s*/, '').trim();
        if (!desc) {
            addChatMessage('assistant', '/orch <描述> - 全流水线模式\n🧱 Builder 拆解 → 🔧 并行 Coder(最多4个) → 🔍 Reviewer审查 → 🧪 Tester构建验证 → 自动修复');
            return;
        }
        addChatMessage('user', text);
        await executeOrchestratorLoop(desc);
        return;
    }
    // ── /file 命令:发送当前文件给 AI(超大文件自动生成大纲)──
    if (text.startsWith('/file') && state.activeFileIndex >= 0) {
        const file = state.openFiles[state.activeFileIndex];
        const lines = file.content.split('\n');
        const totalChars = file.content.length;
        const MAX_SEND = 200000;
        let ctx;
        if (totalChars <= MAX_SEND) {
            // 小文件:直接发送
            ctx = `📄 ${file.name} (${lines.length} 行, ${(totalChars / 1000).toFixed(0)}k 字符):\n\`\`\`${file.language}\n${file.content}\n\`\`\`\n\n请分析以上文件内容。`;
        }
        else {
            // 大文件:生成结构化大纲
            const outline = generateFileOutline(file.content, file.language);
            ctx = `📐 ${file.name} - 文件过大,发送结构化大纲\n\n文件行数: ${lines.length} | 字符数: ${(totalChars / 1000).toFixed(0)}k\n\n## 文件结构大纲:\n${outline}\n\n---\n💡 使用 /lines N-M 命令获取指定行范围的内容。\n例如: /lines 1500-1600 查看第 1500 到 1600 行。\n\n请根据大纲回答,需要查看具体代码时告诉我行号范围。`;
        }
        const fileMsg = text.replace(/^\/file\s*/, '').trim() || file.name;
        addChatMessage('user', `/file ${fileMsg}`);
        addChatMessage('system', ctx);
        streamToAI(fileMsg, ctx, file.name);
        return;
    }
    // ── /lines 命令:发送指定行范围 ──
    const linesMatch = text.match(/^\/lines\s+(\d+)(?:\s*-\s*(\d+))?/);
    if (linesMatch && state.activeFileIndex >= 0) {
        const file = state.openFiles[state.activeFileIndex];
        const lines = file.content.split('\n');
        const start = Math.max(1, parseInt(linesMatch[1]));
        const end = linesMatch[2] ? parseInt(linesMatch[2]) : start + 50;
        const sliceStart = Math.max(0, start - 1);
        const sliceEnd = Math.min(lines.length, end);
        const chunk = lines.slice(sliceStart, sliceEnd).join('\n');
        const ctx = `📄 ${file.name} 第 ${start}-${sliceEnd} 行 (共 ${lines.length} 行):\n\`\`\`${file.language}\n${chunk}\n\`\`\``;
        addChatMessage('user', text);
        addChatMessage('system', ctx);
        streamToAI(text, ctx, file.name);
        return;
    }
    addChatMessage('user', text, [...attachments]);
    // 构建附件上下文(仅手动附件 + 编辑器选中内容)
    let attachContext = '';
    // 1) 编辑器选中文本(用户主动选择 = 明确意图)
    if (editor) {
        const selection = editor.getSelection();
        if (selection && !selection.isEmpty()) {
            const selectedText = editor.getModel()?.getValueInRange(selection) || '';
            if (selectedText) {
                const activeFile = state.openFiles[state.activeFileIndex];
                const lang = activeFile?.language || '';
                // 20 万字符以内直接发送,超出则智能截断(头+尾)
                const MAX_SELECTION = 200000;
                let sendText = selectedText;
                let truncNote = '';
                if (selectedText.length > MAX_SELECTION) {
                    sendText = selectedText.slice(0, MAX_SELECTION * 0.3) +
                        `\n\n...(中间省略 ${selectedText.length - MAX_SELECTION * 0.6} 字符)...\n\n` +
                        selectedText.slice(-MAX_SELECTION * 0.3);
                    truncNote = `(已截断:共 ${(selectedText.length / 1000).toFixed(0)}k 字符,发送了开头和结尾各 ${(MAX_SELECTION * 0.3 / 1000).toFixed(0)}k)`;
                }
                attachContext += `\n---\n📌 选中代码 ${truncNote} (${activeFile?.name || '编辑器'}):\n\`\`\`${lang}\n${sendText}\n\`\`\`\n---\n`;
            }
        }
    }
    // 2) 手动附件
    if (attachments.length > 0) {
        for (const a of attachments) {
            if (a.type === 'image') {
                // 图片附件：发送图片给 AI
                attachContext += `\n---\n🖼️ 图片: ${a.name}`;
                if (a.dataUrl) {
                    const base64 = a.dataUrl.split(',')[1] || '';
                    attachContext += ` [图片已附加为 base64, 请用 vision 能力查看]`;
                    // 图片会作为单独的消息内容发送
                }
                else {
                    attachContext += ` (图片无法读取)\n---\n`;
                }
            }
            else {
                // 文件附件
                const ext = a.name.split('.').pop()?.toLowerCase() || '';
                const textExts = new Set(['txt', 'md', 'js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'kt', 'scala', 'lua', 'r', 'dart', 'sql', 'html', 'htm', 'css', 'scss', 'less', 'json', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'xml', 'svg', 'sh', 'bash', 'bat', 'ps1', 'gradle', 'properties', 'env', 'gitignore', 'dockerfile', 'makefile', 'cmake', 'vue', 'svelte', 'astro', 'graphql', 'prisma', 'proto']);
                if (textExts.has(ext)) {
                    try {
                        const content = await window.api.readTextFile(a.path);
                        if (content) {
                            attachContext += `\n---\n📄 ${a.name}:\n\`\`\`${ext}\n${content.slice(0, 10000)}\n\`\`\`\n---\n`;
                        }
                    }
                    catch (_) {
                        attachContext += `\n---\n📄 ${a.name} (读取失败)\n---\n`;
                    }
                }
                else {
                    // 非文本文件 —— 尝试获取文件信息
                    attachContext += `\n---\n📦 ${a.name} (${formatFileSize(a.size)})\n---\n`;
                }
            }
        }
    }
    const currentAttach = [...attachments];
    attachments = [];
    renderAttachmentBar();
    const session = ensureSession();
    session.updatedAt = Date.now();
    state.isStreaming = true;
    state.currentStreamContent = '';
    document.getElementById('btn-send').classList.add('hidden');
    document.getElementById('btn-abort').classList.remove('hidden');
    try {
        const userContent = attachContext ? text + '\n\n' + attachContext : text;
        // 构建用户消息（支持多模态图片）
        const imageAttachments = currentAttach.filter(a => a.type === 'image' && a.dataUrl);
        let userMessage;
        if (imageAttachments.length > 0) {
            userMessage = {
                role: 'user',
                content: [
                    { type: 'text', text: userContent },
                    ...imageAttachments.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl } }))
                ]
            };
        }
        else {
            userMessage = { role: 'user', content: userContent };
        }
        const toolInstructions = mcpToolsEnabled ? `
## 🔧 工具模式已激活
你现在可以调用以下函数来真正操作项目:
• read_file(path) — 读取项目文件
• write_file(path, content) — 创建/修改文件
• list_files(path) — 列出目录
• search_code(query) — grep 代码搜索
• run_command(cmd) — 执行终端命令
• git_status() / git_diff() — Git 操作

使用工具时，每次调用前先解释你在做什么（用简洁的中文），然后调用工具。
工具执行结果会自动反馈给你，你可以据此继续操作。
最多可连续调用 3 轮工具。` : `
## 💡 提示
当前工具模式未开启。点击输入框左侧的 🔧 按钮开启后，我就可以直接读写文件和执行命令。`;
        const messages = [
            { role: 'system', content: `【绝对规则 - 必须遵守】
你正在虎猫 TCIDE(本地 IDE)中运行,直接嵌在用户的编辑器中。

## 你的真实能力
你已接入 IDE 的文件系统、终端和项目上下文。你可以:
• 看到用户当前打开的文件和编辑器选区
• 分析项目代码结构
• 生成/修改代码
• 执行终端命令
${toolInstructions}

## 当前 IDE 状态
${state.projectPath ? `项目: ${state.projectPath}` : '未打开项目'}
${state.openFiles.length > 0 ? `已打开文件: ${state.openFiles.slice(0, 10).map(f => `  - ${f.name} (${f.language})`).join('\n')}` : ''}
${state.activeFileIndex >= 0 && state.openFiles[state.activeFileIndex] ? `当前活跃文件: ${state.openFiles[state.activeFileIndex].name}` : ''}

## 严禁事项
• 严禁说「我无法访问你的文件」「我看不到你的屏幕」「请粘贴内容」-- 你已经在 IDE 里了
• 严禁说「我是一个纯文本模型」-- 你是有工具接入的 IDE Agent
• 严禁假装自己是网页版 AI -- 你是桌面 IDE 内置助手
• 如果用户问文件内容但你缺上下文,直接说:「请打开该文件或在编辑器中选中相关代码,我就能看到」

## 应该这样做
• 用户问「左边是什么文件」→ 看上面已打开文件列表,直接回答
• 用户问「帮我改这个文件」→ 直接给出修改后的完整代码
• 用户问项目结构 → 描述你知道的上下文
• 用户说「继续」→ 继续之前的工作` },
            ...session.chatHistory.slice(-20).map(m => ({ role: m.role, content: m.content })),
            userMessage,
        ];
        if (mcpToolsEnabled) {
            window.api.sendToAIWithTools(messages, { model: state.config.model });
        } else {
            window.api.sendToAIStream(messages, { model: state.config.model });
        }
        showTypingIndicator();
        // Note: user message already saved by addChatMessage() above
        // 首次对话自动命名为用户第一条消息
        if (session.name.startsWith('对话 ') && session.chatHistory.filter(m => m.role === 'user').length === 1) {
            session.name = text.slice(0, 30) + (text.length > 30 ? '...' : '');
            renderChatList();
        }
    }
    catch (err) {
        addChatMessage('assistant', `错误: ${err.message}`);
        stopStreaming();
    }
}
function stopStreaming() {
    window.api.abortAI();
    state.isStreaming = false;
    state.currentStreamContent = '';
    document.getElementById('btn-send').classList.remove('hidden');
    document.getElementById('btn-abort').classList.add('hidden');
}
// ── Agent 自动执行循环(/task 命令) ──
async function executeTaskAgentLoop(description) {
    if (!state.projectPath) {
        addChatMessage('assistant', '⚠️ 请先打开一个项目文件夹');
        return;
    }
    // 使用流水线面板
    showPipelinePanel('🧱 构建模式串行执行');
    setPipelinePhase('builder');
    let tasks;
    try {
        tasks = await window.api.runBuilder(description, { projectPath: state.projectPath });
        if (!tasks || tasks.length === 0) {
            showPipelineSummary(false, 'Builder 未生成有效任务');
            addChatMessage('assistant', '⚠️ Builder 未生成有效任务，请更具体地描述需求。');
            return;
        }
    } catch (err) {
        showPipelineSummary(false, `Builder 出错: ${err?.message || err}`);
        return;
    }
    setPipelinePhase('coder');
    // 预建任务卡片
    tasks.forEach((t, i) => {
        const name = t.title || t.name || t.desc || `任务 ${i + 1}`;
        addPipelineTask(t.id || `t${i}`, name, (t.files || []).join(', '));
    });
    let successCount = 0;
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const tid = task.id || `t${i}`;
        const title = task.title || task.name || task.desc || `任务 ${i + 1}`;
        updatePipelineTask(tid, 'running');
        try {
            let result = await window.api.runCoder(task, state.projectPath);
            let retries = 0;
            while (!result.success && retries < 2) {
                retries++;
                const fixTask = { ...task, description: task.description || task.title || task.desc || '', previousError: result.output?.slice(0, 800) || '' };
                try { result = await window.api.runCoder(fixTask, state.projectPath); } catch { break; }
            }
            if (result.success) {
                successCount++;
                updatePipelineTask(tid, 'done');
                addChatMessage('assistant', `✅ ${title} 完成`);
            } else {
                updatePipelineTask(tid, 'failed');
                addChatMessage('assistant', `❌ ${title} 失败`);
            }
        } catch (err) {
            updatePipelineTask(tid, 'failed');
        }
    }
    showPipelineSummary(successCount === tasks.length, `${successCount}/${tasks.length} 任务完成`);
    addChatMessage('assistant', `🏁 Builder 完成: ${successCount}/${tasks.length} 个任务成功。`);
    if (successCount > 0) loadFileTree(state.projectPath);
}
// ═══ AgentOrchestrator 全流水线模式 ═══
async function executeOrchestratorLoop(description) {
    if (!state.projectPath) {
        addChatMessage('assistant', '⚠️ 请先打开一个项目文件夹');
        return;
    }
    showPipelinePanel('🚀 流水线全流程');
    setPipelinePhase('builder');
    document.getElementById('pipeline-abort-btn')?.addEventListener('click', () => {
        window.api.orchestratorAbort?.();
        showPipelineSummary(false, '用户终止');
    }, { once: true });
    try {
        await window.api.orchestratorInit(state.projectPath);
        const context = {
            projectType: state.activeFileIndex >= 0 ? state.openFiles[state.activeFileIndex]?.language || 'unknown' : 'unknown',
            fileTree: state.fileTree?.slice(0, 30) || [],
            modules: [],
        };
        const result = await window.api.orchestratorRun(description, context);
        if (result.success) {
            const fm = result.stats?.filesModified?.length || 0;
            showPipelineSummary(true, `完成！${result.stats?.phases?.builder || 0} 任务, ${fm} 文件修改`);
            addChatMessage('assistant', `✅ Pipeline 完成！${result.stats?.phases?.builder || 0} 个任务 | 修改 ${fm} 个文件 | 重试 ${result.stats?.retries || 0} 次`);
            if (fm > 0) loadFileTree(state.projectPath);
        } else {
            showPipelineSummary(false, result.error || '流水线失败');
            addChatMessage('assistant', `❌ Pipeline 失败: ${result.error || '未知错误'}`);
        }
    } catch (err) {
        showPipelineSummary(false, `异常: ${err?.message || err}`);
    }
}
// 废弃：不再需要 /task /orch 文本命令，由模式栏替代
// 保留 executeTaskAgentLoop_legacy / executeOrchestratorLoop_legacy 作为兜底
        // 初始化 Orchestrator
        await window.api.orchestratorInit(state.projectPath);
        // 构建项目上下文
        const context = {
            projectType: state.activeFileIndex >= 0
                ? state.openFiles[state.activeFileIndex]?.language || 'unknown'
                : 'unknown',
            fileTree: state.fileTree?.slice(0, 30) || [],
            modules: [],
        };
        // 运行流水线
        const result = await window.api.orchestratorRun(description, context);
        if (result.success) {
            addChatMessage('assistant', `✅ **流水线完成！**\n` +
                `📂 修改文件: ${result.stats?.filesModified?.length || 0}\n` +
                `📊 Builder: ${result.stats?.phases?.builder || 0} 任务 | Coder: ${result.stats?.phases?.coder || 0} | Reviewer: ${result.stats?.phases?.reviewer || 0}\n` +
                `🔁 重试: ${result.stats?.retries || 0} 次 | ⏱ 耗时: ${result.stats?.duration || '?'}`);
            // 刷新文件树
            if (result.stats?.filesModified?.length > 0) {
                loadFileTree(state.projectPath);
            }
        } else {
            addChatMessage('assistant', `❌ **流水线失败:** ${result.error || '未知错误'}`);
            if (result.buildResult?.output) {
                addChatMessage('assistant', `📋 构建输出:\n\`\`\`\n${result.buildResult.output.slice(0, 500)}\n\`\`\``);
            }
        }
    } catch (err) {
        addChatMessage('assistant', `❌ Orchestrator 异常: ${err?.message || err}`);
    }
    // 清理事件监听
    window.api.onOrchestratorPhase?.(() => {});
    window.api.onOrchestratorTaskProgress?.(() => {});
}
let toastQueue = [];
let activeToasts = [];
const MAX_VISIBLE_TOASTS = 2;
function showToast(text, type = 'info', duration = 3000) {
    const id = crypto.randomUUID();
    toastQueue.push({ id, text, type, duration });
    processToastQueue();
}
function processToastQueue() {
    if (activeToasts.length >= MAX_VISIBLE_TOASTS || toastQueue.length === 0)
        return;
    const toast = toastQueue.shift();
    activeToasts.push(toast.id);
    renderToast(toast);
}
function renderToast(toast) {
    const container = document.getElementById('toast-container');
    const icons = { success: '✅', warn: '⚠️', error: '❌', info: 'i️' };
    const el = document.createElement('div');
    el.className = `toast-item toast-${toast.type}`;
    el.id = `toast-${toast.id}`;
    el.innerHTML = `
    <span class="toast-icon">${icons[toast.type]}</span>
    <span class="toast-msg">${toast.text}</span>
    ${toast.action ? `<button class="toast-action">${toast.action.label}</button>` : ''}
    <span class="toast-close">✕</span>
  `;
    container.appendChild(el);
    // 关闭按钮
    el.querySelector('.toast-close')?.addEventListener('click', () => dismissToast(toast.id));
    el.querySelector('.toast-action')?.addEventListener('click', () => { toast.action?.callback(); dismissToast(toast.id); });
    // 自动消失
    setTimeout(() => dismissToast(toast.id), toast.duration);
}
function dismissToast(id) {
    const el = document.getElementById(`toast-${id}`);
    if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateX(40px)';
        el.style.transition = 'all 0.2s ease';
        setTimeout(() => el.remove(), 200);
    }
    activeToasts = activeToasts.filter(t => t !== id);
    processToastQueue();
}
// 保留 showMiniToast 别名(兼容旧代码)
function showMiniToast(msg, duration = 2000) {
    showToast(msg, 'info', duration);
}
// ─────────────────────────────────────────
// AI 代码生成 & 插入(Monaco 集成)
// ─────────────────────────────────────────
/** 提取 Markdown 代码块内容 */
function extractCodeBlocks(text) {
    const blocks = [];
    const fenceRegex = /```(?:[a-zA-Z+]+)?\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = fenceRegex.exec(text)) !== null) {
        blocks.push(match[1].trim());
    }
    if (blocks.length === 0) {
        return text.replace(/^[`*#>\-\s]+/gm, '').trim();
    }
    return blocks.join('\n\n');
}
/** 构建滑动窗口上下文(最近 N 轮对话 + 当前文件上下文)*/
function buildSlidingWindowContext(chatHistory, maxRounds = 5, maxFileChars = 4000) {
    const recent = chatHistory.filter(m => m.role !== 'system').slice(-maxRounds * 2);
    const messages = recent.map(m => ({ role: m.role, content: m.content }));
    if (editor && state.openFiles.length > 0 && state.activeFileIndex >= 0) {
        const file = state.openFiles[state.activeFileIndex];
        const content = editor.getValue();
        if (content.length > 0) {
            const snippet = content.length > maxFileChars
                ? content.slice(0, maxFileChars) + '\n\n... (已截断)'
                : content;
            messages.unshift({
                role: 'system',
                content: `当前正在编辑文件: ${file.path}\n\n${snippet}`,
            });
        }
    }
    return messages;
}
// ── 打字指示器(AI 响应时显示动画点)──
function showTypingIndicator() {
    hideTypingIndicator();
    const container = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'typing-indicator';
    indicator.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    container.appendChild(indicator);
    container.scrollTop = container.scrollHeight;
}
function hideTypingIndicator() {
    document.getElementById('typing-indicator')?.remove();
}
// ── AI 模型状态指示器 ──
function updateModelIndicator() {
    const dot = document.getElementById('ai-model-dot');
    const name = document.getElementById('ai-model-name');
    const cfg = state.config;
    if (!dot || !name)
        return;
    if (!cfg.apiKey) {
        dot.className = 'ai-model-dot offline';
        name.textContent = '未配置';
        return;
    }
    const meta = modelListCache?.find(m => m.id === cfg.model && m.provider === cfg.provider);
    const displayName = meta?.name || cfg.model || '未知模型';
    name.textContent = displayName;
    dot.className = 'ai-model-dot';
}
/** 错误降级:返回缓存的模板提示 */
function getFallbackResponse() {
    return '// 网络异常,请检查 API 配置后重试\n// 提示:设置 → 模型服务商 → 测试连接';
}
// ── Diff 预览 ──
let diffState = null;
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function computeLineDiff(original, modified) {
    const maxLen = Math.max(original.length, modified.length);
    const oResult = [];
    const mResult = [];
    for (let i = 0; i < maxLen; i++) {
        const ol = original[i];
        const ml = modified[i];
        if (ol === undefined) {
            oResult.push('<div class="diff-empty"></div>');
            mResult.push(`<div class="diff-added">+ ${escapeHtml(ml)}</div>`);
        }
        else if (ml === undefined) {
            oResult.push(`<div class="diff-removed">- ${escapeHtml(ol)}</div>`);
            mResult.push('<div class="diff-empty"></div>');
        }
        else if (ol === ml) {
            oResult.push(`<div class="diff-unchanged">  ${escapeHtml(ol)}</div>`);
            mResult.push(`<div class="diff-unchanged">  ${escapeHtml(ml)}</div>`);
        }
        else {
            oResult.push(`<div class="diff-removed">- ${escapeHtml(ol)}</div>`);
            mResult.push(`<div class="diff-added">+ ${escapeHtml(ml)}</div>`);
        }
    }
    return { o: oResult, m: mResult };
}
function showDiffModal(originalText, modifiedText, selection, editor) {
    diffState = { selection, insertText: modifiedText, editor };
    const modal = document.getElementById('diff-modal');
    const diff = computeLineDiff(originalText.split('\n'), modifiedText.split('\n'));
    document.getElementById('diff-original-content').innerHTML = diff.o.join('');
    document.getElementById('diff-modified-content').innerHTML = diff.m.join('');
    modal.style.display = 'flex';
    document.getElementById('diff-accept').focus();
}
function acceptDiff() {
    if (!diffState)
        return;
    diffState.editor.executeEdits('tcide-ai', [{ range: diffState.selection, text: diffState.insertText, forceMoveMarkers: true }]);
    closeDiffModal();
    showMiniToast('✓ 变更已应用');
}
function closeDiffModal() {
    diffState = null;
    document.getElementById('diff-modal').style.display = 'none';
}
// 暴露到全局(供 HTML onclick 使用)
window.acceptDiff = acceptDiff;
window.closeDiffModal = closeDiffModal;
/** AI 生成代码并插入到编辑器 */
async function aiGenerateAndInsert(ed, prompt, selection, asComment = false) {
    if (!state.config.apiKey && state.config.provider !== 'ollama') {
        showMiniToast('请先在设置中配置 API Key');
        return;
    }
    showMiniToast('AI 正在生成...');
    const session = ensureSession();
    const messages = buildSlidingWindowContext(session.chatHistory, 5, 4000);
    messages.push({ role: 'user', content: prompt });
    try {
        const result = await window.api.sendToAI(messages, { model: state.config.model });
        const code = extractCodeBlocks(result);
        const originalText = ed.getModel()?.getValueInRange(selection) || '';
        const insertText = asComment ? `// [AI] ${code.split('\n').join('\n// ')}` : code;
        // 有原始选中文本 → Diff 预览;无原文(空选择)→ 直接插入
        if (originalText.trim() && originalText !== insertText) {
            showDiffModal(originalText, insertText, selection, ed);
        }
        else {
            ed.executeEdits('tcide-ai', [{
                    range: selection,
                    text: insertText,
                    forceMoveMarkers: true,
                }]);
            showMiniToast('✓ 代码已插入');
        }
    }
    catch (err) {
        showMiniToast(`生成失败: ${err.message}`);
    }
}
// Settings code already embedded above - this comment prevents duplicate declarations
// ─────────────────────────────────────────
// AI 面板 - Settings
// ─────────────────────────────────────────
async function loadConfig() {
    try {
        const config = await window.api.getModelConfig();
        if (config) {
            state.config.provider = config.provider || 'deepseek';
            state.config.baseUrl = config.baseUrl || 'https://api.deepseek.com/v1';
            state.config.apiKey = config.apiKey || '';
            state.config.model = config.model || 'deepseek-v4-pro';
            state.config.builderModel = config.builderModel || 'deepseek-reasoner';
            state.config.coderModel = config.coderModel || 'deepseek-v4-pro';
            updateSettingsUI();
            updateModelListSelection();
            updateModelIndicator();
            // 已配置 API 则隐藏快速配置按钮
            if (config.apiKey) {
                document.querySelectorAll('.quick-btn[data-action^="config-"]').forEach(b => b.classList.add('hidden'));
            }
            // 加载已保存的 API 配置列表
            await loadSavedApiConfigs();
        }
    }
    catch { /* ignore */ }
}
function updateSettingsUI() {
    const providerSelect = document.getElementById('cfg-provider');
    if (providerSelect)
        providerSelect.value = state.config.provider;
    const baseUrlInput = document.getElementById('cfg-base-url');
    if (baseUrlInput)
        baseUrlInput.value = state.config.baseUrl;
    const apiKey = document.getElementById('cfg-api-key');
    const modelInput = document.getElementById('cfg-model');
    if (apiKey)
        apiKey.value = state.config.apiKey;
    if (modelInput)
        modelInput.value = state.config.model;
    // 更新 provider 下拉 → 自动填充默认 baseUrl
    updateProviderDefaults();
    // 显示模型元数据
    updateModelMetaDisplay();
}
let modelListCache = [];
async function loadModelList() {
    try {
        modelListCache = await window.api.listModelMeta();
        renderModelList();
        populateModelSelector();
        updateModelIndicator();
    }
    catch (err) {
        console.error('[Settings] 加载模型列表失败:', err);
        modelListCache = [];
    }
}
function renderModelList() {
    const container = document.getElementById('model-list-container');
    if (!container)
        return;
    if (modelListCache.length === 0) {
        container.innerHTML = '<div class="model-list-empty">暂无已注册模型</div>';
        return;
    }
    // 按 provider 分组
    const groups = new Map();
    for (const m of modelListCache) {
        const list = groups.get(m.provider) || [];
        list.push(m);
        groups.set(m.provider, list);
    }
    const providerIcons = {
        deepseek: '🐋', huoshan: '🌋', ollama: '🦙', anthropic: '🧠', custom: '⚙️',
    };
    let html = '';
    for (const [provider, models] of groups) {
        const icon = providerIcons[provider] || '🔌';
        html += `<div class="provider-section"><div class="provider-section-title">${icon} ${provider}</div>`;
        for (const m of models) {
            const isActive = state.config.provider === m.provider && state.config.model === m.id;
            const costStr = `¥${m.cost.input.toFixed(1)}/${m.cost.output.toFixed(1)} 每1M`;
            html += `<div class="model-item ${isActive ? 'active' : ''}"
        data-provider="${m.provider}" data-model="${m.id}"
        onclick="void(0)">
        <span class="model-icon">${m.reasoning ? '🧠' : icon}</span>
        <span class="model-name">${m.name}</span>
        <span class="model-provider">${costStr} | ${m.contextWindow >= 1000000 ? (m.contextWindow / 1000000).toFixed(0) + 'M' : (m.contextWindow / 1000).toFixed(0) + 'K'} ctx</span>
        <span class="model-status">${isActive ? '✓' : '-'}</span>
      </div>`;
        }
        html += '</div>';
    }
    container.innerHTML = html;
    // 绑定点击事件
    container.querySelectorAll('.model-item[data-model]').forEach(item => {
        item.addEventListener('click', () => {
            const el = item;
            selectBuiltinModel(el.dataset.provider || 'deepseek', el.dataset.model || 'deepseek-v4-pro');
        });
    });
}
function updateModelListSelection() {
    const items = document.querySelectorAll('.model-item[data-model]');
    items.forEach(item => {
        const el = item;
        if (el.dataset.provider === state.config.provider && el.dataset.model === state.config.model) {
            el.classList.add('active');
        }
        else {
            el.classList.remove('active');
        }
    });
}
function selectBuiltinModel(provider, model) {
    // 从注册表查找模型元数据
    const meta = modelListCache.find(m => m.provider === provider && m.id === model);
    state.config.provider = provider;
    state.config.model = model;
    // 默认 baseUrl(后续可在自定义 Tab 中覆盖)
    const defaultBaseUrls = {
        deepseek: 'https://api.deepseek.com/v1',
        huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
        ollama: 'http://localhost:11434',
        anthropic: 'https://api.anthropic.com',
        custom: '',
    };
    state.config.baseUrl = defaultBaseUrls[provider] || state.config.baseUrl;
    state.config.builderModel = meta?.reasoning ? model : (meta ? model : model);
    state.config.coderModel = model;
    // 更新 UI
    document.getElementById('cfg-provider').value = provider;
    document.getElementById('cfg-base-url').value = state.config.baseUrl;
    updateProviderDefaults();
    updateModelListSelection();
    updateModelMetaDisplay();
    switchSettingsSubTab('custom');
    // 火山引擎特殊提示
    if (provider === 'huoshan') {
        showToast('⚠️ 火山引擎需要推理接入点ID,请在火山方舟控制台创建接入点后填写', 'warning');
    }
}
function switchSettingsSubTab(tab) {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.settings-tab-content').forEach(t => t.classList.add('hidden'));
    const targetTab = document.querySelector(`[data-settings-tab="${tab}"]`);
    targetTab?.classList.add('active');
    document.getElementById(`settings-${tab}`)?.classList.remove('hidden');
    // 切换到版本记录 Tab 时渲染时间线
    if (tab === 'changelog')
        renderChangelog();
    if (tab === 'services')
        renderServiceToggles();
    if (tab === 'dream')
        renderDreamJournal();
}
// ─────────────────────────────────────────
// 梦境日志渲染
// ─────────────────────────────────────────
const dreamTypeEmoji = {
    pattern: '🔁', lesson: '📖', stack: '🧱',
    workflow: '🔄', insight: '💡', preference: '⭐'
};
async function renderDreamJournal() {
    const list = document.getElementById('dream-journal-list');
    const cards = document.getElementById('dream-memory-cards');
    const countEl = document.getElementById('mem-card-count');
    const statusEl = document.getElementById('dream-status');

    if (list) {
        try {
            const journal = await window.api.dreamGetJournal?.(10) || [];
            if (journal.length) {
                list.innerHTML = journal.map(j => {
                    const d = new Date(j.startedAt);
                    const timeStr = d.toLocaleString('zh-CN');
                    const dMs = `${((j.stats?.durationMs || 0) / 1000).toFixed(1)}s`;
                    const cardEmoji = j.artifacts?.length ? '✨' : '💤';
                    const cardPreview = j.artifacts?.slice(0, 3).map(a => a.topic).join(', ') || '无洞察';
                    const errorMsg = j.error ? ` <span style="color:#f44336">⚠${j.error.slice(0,30)}</span>` : '';
                    return `<div style="background:rgba(255,255,255,0.03);border-radius:6px;padding:8px 10px;font-size:11px">
          <div style="display:flex;align-items:center;gap:8px">
            <span>${cardEmoji}</span>
            <span style="font-weight:600;color:var(--text-primary)">梦境 #${j.dreamId?.slice(-6) || '?'}</span>
            <span style="font-size:10px;color:var(--text-secondary);margin-left:auto">${timeStr}</span>
          </div>
          <div style="margin-top:4px;color:var(--text-secondary);display:flex;gap:8px">
            <span>📊 ${j.stats?.inputCount || 0}条</span>
            <span>📝 ${j.stats?.cardsCreated || 0}卡</span>
            <span>⏱ ${dMs}</span>
            ${errorMsg}
          </div>
          <div style="margin-top:2px;font-size:10px;color:var(--text-secondary)">${cardPreview}</div>
        </div>`;
                }).join('');
            } else {
                list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:24px;font-size:12px">📖 暂无梦境记录。打开项目运行一会儿，或点击「🌙 手动做梦」立即触发。</div>';
            }
        } catch { list.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px">加载失败</div>'; }
    }

    if (cards) {
        try {
            const memories = await window.api.dreamGetExpertMemory?.(null) || [];
            if (countEl) countEl.textContent = memories.length;
            if (memories.length) {
                cards.innerHTML = memories.slice(-20).reverse().map(m => {
                    const d = new Date(m.createdAt);
                    const emoji = dreamTypeEmoji[m.type] || '📌';
                    return `<div style="background:rgba(255,255,255,0.02);border-left:2px solid var(--tc-orange);border-radius:0 4px 4px 0;padding:6px 10px;font-size:11px">
          <div style="display:flex;align-items:center;gap:6px">
            <span>${emoji}</span>
            <span style="color:var(--text-primary);font-weight:500">${m.topic}</span>
            <span style="font-size:9px;color:var(--text-secondary);margin-left:auto">${d.toLocaleDateString('zh-CN')}</span>
          </div>
          <div style="margin-top:2px;color:var(--text-secondary);font-size:10px">${m.summary || ''}</div>
          ${m.tags?.length ? `<div style="margin-top:2px;display:flex;gap:3px;flex-wrap:wrap">${m.tags.slice(0,6).map(t => `<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(255,165,0,0.08);color:var(--tc-orange)">#${t}</span>`).join('')}</div>` : ''}
        </div>`;
                }).join('');
            } else {
                cards.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px;font-size:11px">暂无记忆卡，触发一次做梦生成</div>';
            }
        } catch { cards.innerHTML = '<div style="text-align:center;color:var(--text-secondary);padding:16px">加载失败</div>'; }
    }

    if (statusEl) {
        try {
            const should = await window.api.dreamShouldDream?.();
            statusEl.textContent = should ? '🌙 可以做梦' : '💤 待命中';
            statusEl.style.background = should ? 'rgba(255,165,0,0.15)' : 'rgba(255,255,255,0.05)';
        } catch {}
    }
}
document.getElementById('btn-dream-trigger')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-dream-trigger');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 做梦...'; }
    showToast('🌙 开始做梦...', 'info');
    try {
        const result = await window.api.dreamTrigger?.();
        if (result?.skipped) showToast('已跳过: ' + result.reason, 'info');
        else if (result) {
            showToast(`✨ 梦境完成！生成 ${result.stats?.cardsCreated || 0} 张记忆卡`, 'success', 3000);
            renderDreamJournal();
        }
    } catch (e) { showToast('做梦失败', 'error'); }
    if (btn) { btn.disabled = false; btn.textContent = '🌙 手动做梦'; }
});
// ── 监听做梦完毕事件 ──
window.api.onDreamComplete?.((result) => {
    if (result?.stats?.cardsCreated > 0) {
        showToast(`🧠 梦境引擎：发现 ${result.stats.cardsCreated} 条新洞察`, 'info', 5000);
    }
});
// ─────────────────────────────────────────
// 版本记录
// ─────────────────────────────────────────
const VERSION_HISTORY = [
    {
        version: 'v1.0.0',
        date: '2026-05-26',
        emoji: '🐯',
        title: '虎猫诞生 - 个人专属 AI 编程 IDE',
        features: [
            'Electron 三进程架构(Main / Renderer / Preload)',
            'Monaco Editor 集成,23 种语言高亮',
            'AI 双 Agent 引擎:Builder 需求拆分 + Coder 代码执行',
            'DeepSeek / Ollama / Anthropic / 自定义 OpenAI 多模型支持',
            '文件树 + 拖拽面板 + 右键菜单',
            'SQLite 项目索引 & Schema 理解',
            '暗色主题(Trae 风格)+ 虎猫品牌',
            '三栏布局:文件树 / 编辑器 / AI 面板',
        ],
        philosophy: '把 AI 工程师装进 IDE。不是又一个套壳 ChatGPT,而是让 AI 真正理解项目上下文,规划、编码、验证一条龙。'
    },
    {
        version: 'v0.11.0',
        date: '2026-05-28',
        emoji: '🐅',
        title: '全面升级 - 双主题 / Git 集成 / 文件预览 / 终端',
        features: [
            '🎨 白虎/老虎双主题一键切换,Monaco 编辑器联动',
            '🔀 Git 面板:Status / Diff 行标记 / 一键 Stage→Commit→Push',
            '📄 文件预览增强:PDF(Blob URL) / DOCX(EOCD) / HTML双模式 / SVG / Hex查看器',
            '💬 对话管理:删除(二次确认) / 重命名 / 会话持久化到 .tcide/chat',
            '🖥️ xterm.js 多标签终端,独立命令历史',
            '🤖 AI 自动读取协议 / /file 大纲 / /lines N-M / 禁止话术清单',
            '🔌 火山方舟 Coding Plan 适配 + ark- 密钥',
            '💾 自动保存(2s 去抖)+ 状态栏脏标记',
            '🏗️ 架构分析器:依赖分析 + 代码异味检测',
            '📂 文件监听(递归 + 500ms 去抖)+ 右键重命名',
            '🐛 修复:图标路径 / DOC 二进制提取 / CSP 策略 / 编码乱码',
        ],
        philosophy: '从"能跑"到"好用"。每一个细节都打磨过--文件预览、Git 流程、对话体验、主题切换。让工具适配人,而不是人适应工具。'
    },
    {
        version: 'v0.12.0',
        date: '2026-05-30',
        emoji: '🐆',
        title: '专业进化 - 代码大纲 / 命令面板 / Zen Mode / 终端流式',
        features: [
            '📋 代码大纲面板(Ctrl+Shift+O):6 语言符号提取、树形渲染、关键字过滤',
            '⌨️ 命令面板(Ctrl+Shift+P):21 内置命令、模糊搜索、快捷键提示',
            '🧘 Zen Mode(Ctrl+Shift+Z):GPU 加速动画、全屏专注、迷你状态栏',
            '🖥️ 终端流式输出:spawn 替代 exec、xterm.js 增量渲染',
            '🧠 上下文管理器:CLAUDE.md 编码规范、静态记忆文件、Token 管控',
            '🐛 修复:file:// 协议兼容、构建管线重建、IPC 流式改造',
        ],
        philosophy: '专注力是程序员最稀缺的资源。Zen Mode + 命令面板,让工具退到幕后,代码走到台前。'
    },
    {
        version: 'v0.13.0',
        date: '2026-05-30',
        emoji: '🐅',
        title: '智能加持 — 项目搜索 / 欢迎页 / 通知系统',
        features: [
            '🔍 项目级搜索(Ctrl+Shift+F):跨文件文本搜索、正则支持、类型过滤',
            '🌳 文件树搜索(Ctrl+F):树中快速过滤、Escape 清除',
            '🏠 欢迎页:最近项目列表、一键打开、新建/打开快捷入口',
            '🔔 Toast 通知系统:成功/错误/警告/信息、右下角弹出',
            '🐛 修复:图标路径 / DOC 提取 / CSP 策略 / 编码乱码',
        ],
        philosophy: '不只是编辑器,而是有判断力的 AI 搭档。角色切换让 AI 适配场景,模板系统消灭重复劳动。'
    },
    {
        version: 'v0.14.0',
        date: '2026-05-30',
        emoji: '🐉',
        title: '专业完备 — LSP 多语言 / Emmet / Snippets / MCP 工具',
        features: [
            '🧠 LSP 语言服务:TS/JS 内置 + Python pyright + 5 语言自动检测',
            '⚠️ Problems 面板:实时诊断、按严重度排序、点击跳转、活动栏 Badge',
            '⚡ Emmet 展开:Tab 触发、HTML/CSS/JSX、自建内联解析器',
            '📦 Snippets 系统:50+ 预置片段(7 语言)、补全提示、分类查看',
            '🔧 MCP 工具集成:9 内置工具(read/write/search/run/git)、AI function calling',
            '🌿 Git 分支切换:下拉选择、切换自动刷新文件树',
            '⌨️ 快捷键编辑器:可视化 CRUD、冲突检测、持久化',
            '🔀 Git Blame:行内作者标注、悬停详情',
            '✏️ 对话内联重命名:双击编辑、Enter 保存、Escape 取消',
        ],
        philosophy: '从 Hackable 到 Professional。LSP 让代码理解不再靠猜,Emmet 让 HTML 飞起来,MCP 让 AI 真正能动手。'
    },
    {
        version: 'v0.15.0',
        date: '2026-05-30',
        emoji: '🐲',
        title: '全模块交付 — P0/P1/P2/P3 十八模块一次投产',
        features: [
            '🏗️ P0八核心: DebugManager断点调试 / LintManager语法检查 / SemanticChunker大文件分片 / ContextTrimmer上下文瘦身 / AutoHeal自愈引擎 / BatchModifier批量修改 / PerfOptimizer性能监控 / 快捷键配置',
            '🧠 P1四智能: GitIntelligence智能提交 / ProjectMemory对话记忆 / VectorIndexer向量索引 / SemanticCompletion上下文补全',
            '⚙️ P2三工程: AgentOrchestrator编排调度 / WarehouseAnalyzer架构分析 / UnattendedRunner沙箱执行',
            '📊 P3三质量: EntropyEvaluator熵值评估 / EntropyController健康监控 / SmartTrimmer智能修剪',
            '🔌 57个IPC通道全通 + 397行Preload桥接',
            '📂 图片/视频/音频预览支持',
            '📋 版本记录时间线面板',
            '🏷️ 活动栏图标+功能名称垂直布局',
            '🧹 对话多选: 全选 / 删除所选 / 清空全部',
            '🐛 修复: 图片关闭残留 / 版本记录点不开',
        ],
        philosophy: '从Demo到生产。18个模块一次交付，57个IPC通道全部接通。不是功能堆砌，而是系统化的工程能力。'
    },
    {
        version: 'v0.15.1',
        date: '2026-05-30',
        emoji: '🐯',
        title: '体验打磨 — 聊天修复 / 思考动画 / 代码折叠 / 保存提示',
        features: [
            '🐯 虎猫思考动画: 发送后弹跳虎猫 + 阶段指示(分析中→工具调用→深度思考)',
            '📊 AI统计栏: 实时显示工具调用次数 + 深度思考次数',
            '📦 长代码块(>10行)自动折叠为~8行,展开/收起按钮',
            '💾 关闭修改文件时弹出保存/不保存确认',
            '🔧 MCP工具开关视觉反馈(active状态CSS)',
            '🐛 修复: AI回复内容丢失(stopStreaming顺序错误)',
            '🐛 修复: 用户消息重复(sendToAI冗余push)',
            '🐛 修复: AI回复频繁中断(max_tokens默认8192)',
            '🐛 修复: Chunker异常兜底(IO/编码错误降级为行分片)',
            '🎨 showConfirm支持自定义按钮文字和取消回调',
        ],
        philosophy: '细节决定体验。思考动画让等待可感知，代码折叠让聊天不臃肿，保存提示减少误操作。每一个小改进都在让AI真正成为可靠的编程伙伴。'
    },
    {
        version: 'v0.16.0',
        date: '2026-05-31',
        emoji: '🚀',
        title: 'Agent 觉醒 — UI 重构 / 多 Agent 全流水线',
        features: [
            '🎛️ Agent 模式选择器: 对话/工具/构建/流水线 四模式一键切换',
            '📊 Pipeline 实时面板: 阶段进度动画(构建→开发→审查→验证)、任务卡片、计时器',
            '🔧 MCP 工具模式: sendToAI 根据开关自动路由到 function calling',
            '🧱 构建模式: 直接输入需求自动拆解执行',
            '🚀 流水线模式: 全流程接入 UI，并行开发池 + 审查 + 构建',
            '📦 长代码块折叠: >10 行自动折叠、展开/收起按钮',
            '⌨️ 快捷键编辑器: 34 条命令可视化编辑、持久化',
            '🩺 自诊断引擎: console.log 残留/any 类型/重复代码检测',
            '🌐 CSP 放宽: 允许 CDN 加载',
            '🧹 Changelog 清理: 移除虚构功能，写实每一版本',
        ],
        philosophy: 'AI 不再是聊天框里的摆设。构建模式拆解需求，流水线并行执行，工具模式真正读写文件——这是虎猫从对话助手到自主 Agent 的质变。'
    },
    {
        version: 'v0.17.0',
        date: '2026-05-31',
        emoji: '🧠',
        title: '自主进化 — 做梦引擎 / 15 服务全接线 / 中文本地化',
        features: [
            '🧠 自主做梦引擎: 后台消化操作日志→聚类分析→专家记忆卡、空闲自动触发',
            '📋 梦境日志面板: 查看梦记录时间线 + 专家记忆卡列表',
            '⚡ 15 个智能服务全量接线: Lint/Debug/Git/Warehouse/Perf/Entropy...',
            '🎛️ 智能服务管理: 设置页 15 个独立开关',
            '🇨🇳 全面中文本地化: 模式选择器、流水线面板、设置页、欢迎页',
            '📊 状态栏扩展: RAM 用量 + 健康度指数实时显示',
            '🔢 版本号重置: 1.x → 0.1x，回归实事求是的版本节奏',
        ],
        philosophy: 'AI 要学会从你的操作中学习。做梦引擎每晚凝练当天的编码经验，把碎片化的操作日志变成结构化的专家知识。虎猫不只是工具，而是会成长的编程搭档。'
    },
];
function renderChangelog() {
    const container = document.getElementById('changelog-timeline');
    if (!container)
        return;
    let html = '';
    VERSION_HISTORY.slice().reverse().forEach((v, i) => {
        const isLatest = i === 0;
        html += `
    <div class="changelog-entry ${isLatest ? 'changelog-entry-latest' : ''}">
      <div class="changelog-dot">
        <span class="changelog-emoji">${v.emoji}</span>
      </div>
      <div class="changelog-card">
        <div class="changelog-card-header">
          <span class="changelog-version">${v.version}</span>
          ${isLatest ? '<span class="changelog-badge">最新</span>' : ''}
          <span class="changelog-date">${v.date}</span>
        </div>
        <h4 class="changelog-title">${v.title}</h4>
        <ul class="changelog-features">
          ${v.features.map(f => `<li>${f}</li>`).join('')}
        </ul>
        <div class="changelog-philosophy">
          <span class="changelog-philosophy-label">💡 设计理念</span>
          <p>${v.philosophy}</p>
        </div>
      </div>
    </div>`;
    });
    container.innerHTML = html;
}
/** Provider 切换时自动填充默认 baseUrl + 协议 */
function updateProviderDefaults() {
    const provider = document.getElementById('cfg-provider')?.value || state.config.provider;
    const defaultBaseUrls = {
        deepseek: 'https://api.deepseek.com/v1',
        huoshan: 'https://ark.cn-beijing.volces.com/api/v3',
        ollama: 'http://localhost:11434',
        anthropic: 'https://api.anthropic.com',
        custom: '',
    };
    const defaultProtocols = {
        deepseek: 'openai-compatible',
        huoshan: 'openai-compatible',
        ollama: 'ollama',
        anthropic: 'anthropic',
        custom: 'openai-compatible',
    };
    const baseUrlInput = document.getElementById('cfg-base-url');
    const protocolSelect = document.getElementById('cfg-api-protocol');
    // 仅当 baseUrl 为空或用户未手动改过时才自动填充
    if (baseUrlInput && (!baseUrlInput.value || baseUrlInput.value === state.config.baseUrl)) {
        baseUrlInput.value = defaultBaseUrls[provider] || '';
    }
    if (protocolSelect) {
        protocolSelect.value = defaultProtocols[provider] || 'openai-compatible';
    }
    // 更新文档链接
    const docsLink = document.getElementById('link-provider-docs');
    const apiKeyLink = document.getElementById('link-get-api-key');
    const links = {
        deepseek: { docs: 'https://platform.deepseek.com/docs', apiKey: 'https://platform.deepseek.com/api_keys' },
        huoshan: { docs: 'https://console.volcengine.com/ark', apiKey: 'https://console.volcengine.com/ark' },
        ollama: { docs: 'https://ollama.com/models', apiKey: 'http://localhost:11434' },
        anthropic: { docs: 'https://docs.anthropic.com', apiKey: 'https://console.anthropic.com' },
        custom: { docs: 'https://platform.openai.com/docs', apiKey: 'https://platform.openai.com/api-keys' },
    };
    const link = links[provider] || links.deepseek;
    if (docsLink)
        docsLink.href = link.docs;
    if (apiKeyLink)
        apiKeyLink.href = link.apiKey;
    // ── 动态更新模型 ID 输入提示 ──
    const modelInput = document.getElementById('cfg-model');
    const modelHint = document.getElementById('hint-model-id');
    const hints = {
        deepseek: { placeholder: '如:deepseek-chat、deepseek-reasoner', hint: '在 DeepSeek 平台的 API Keys 页面查看可用模型' },
        huoshan: { placeholder: 'ep-20240601xxxxxxxx-xxxxx', hint: '⚠️ 火山引擎需要推理接入点ID(endpoint ID),不是模型名。在火山方舟控制台 → 推理接入 → 创建接入点后获取。每个模型需单独创建接入点。' },
        ollama: { placeholder: '如:qwen2.5:7b、codellama', hint: '运行 ollama list 查看本地已拉取的模型' },
        anthropic: { placeholder: '如:claude-sonnet-4-20250514', hint: '在 Anthropic Console 创建 API Key,模型名可查文档' },
        custom: { placeholder: '如:gpt-4o、qwen-max', hint: '自定义 OpenAI 兼容接口,填入服务商提供的模型名称' },
    };
    const hint = hints[provider] || hints.custom;
    if (modelInput)
        modelInput.placeholder = hint.placeholder;
    if (modelHint) {
        modelHint.textContent = hint.hint;
        modelHint.className = provider === 'huoshan' ? 'input-hint input-hint-warn' : 'input-hint';
    }
    updateModelMetaDisplay();
}
/** 显示当前选中模型的元数据 */
async function updateModelMetaDisplay() {
    const provider = state.config.provider;
    const model = state.config.model;
    if (!model)
        return;
    try {
        const meta = await window.api.getModelMeta(provider, model);
        const ctxEl = document.getElementById('meta-context');
        const maxTokEl = document.getElementById('meta-max-tokens');
        const costEl = document.getElementById('meta-cost');
        const reasoningBadge = document.getElementById('meta-reasoning-badge');
        if (meta) {
            if (ctxEl)
                ctxEl.textContent = meta.contextWindow >= 1000000
                    ? `${(meta.contextWindow / 1000000).toFixed(0)}M tokens`
                    : `${(meta.contextWindow / 1000).toFixed(0)}K tokens`;
            if (maxTokEl)
                maxTokEl.textContent = `${(meta.maxTokens / 1000).toFixed(0)}K tokens`;
            if (costEl)
                costEl.textContent = `¥${meta.cost.input}/${meta.cost.output} 每1M tokens`;
            if (reasoningBadge)
                reasoningBadge.style.display = meta.reasoning ? 'inline' : 'none';
        }
        else {
            if (ctxEl)
                ctxEl.textContent = '未知';
            if (maxTokEl)
                maxTokEl.textContent = '未知';
            if (costEl)
                costEl.textContent = '未知(默认 ¥0.3/0.6)';
            if (reasoningBadge)
                reasoningBadge.style.display = 'none';
        }
    }
    catch { /* ignore */ }
}
// 测试连接
async function testConfig() {
    const provider = document.getElementById('cfg-provider').value;
    const apiKey = document.getElementById('cfg-api-key').value;
    const model = document.getElementById('cfg-model').value;
    if (!apiKey) {
        showConfigStatus('请先填写 API 密钥', 'error');
        return;
    }
    if (!model) {
        if (provider === 'huoshan' && apiKey.startsWith('ark-')) {
            // 火山方舟 endpoint key 无需 model
        }
        else {
            showConfigStatus('请先填写模型 ID', 'error');
            return;
        }
    }
    const btn = document.getElementById('btn-test-config');
    btn.disabled = true;
    btn.textContent = '测试中...';
    showConfigStatus('正在连接...', 'info');
    try {
        const baseUrl = getEffectiveBaseUrl();
        const testResult = await window.api.testModelConnection({
            provider, baseUrl, apiKey, model
        });
        if (testResult.success) {
            showConfigStatus(`连接成功!${testResult.message || ''}`, 'success');
        }
        else {
            showConfigStatus(`连接失败: ${testResult.message}`, 'error');
        }
    }
    catch (err) {
        showConfigStatus(`连接异常: ${err.message}`, 'error');
    }
    finally {
        btn.disabled = false;
        btn.textContent = '测试连接';
    }
}
function getEffectiveBaseUrl() {
    return document.getElementById('cfg-base-url').value || 'https://api.deepseek.com/v1';
}
async function saveConfig() {
    const provider = document.getElementById('cfg-provider').value;
    const apiKey = document.getElementById('cfg-api-key').value;
    const model = document.getElementById('cfg-model').value;
    const baseUrl = getEffectiveBaseUrl();
    // 验证必填项
    if (!apiKey || apiKey.trim() === '') {
        showConfigStatus('API 密钥不能为空', 'error');
        return;
    }
    if (!model || model.trim() === '') {
        if (provider === 'huoshan' && apiKey.startsWith('ark-')) {
            // 火山方舟 endpoint key 自带端点,model 可为空
        }
        else {
            showConfigStatus('模型 ID 不能为空', 'error');
            return;
        }
    }
    if (provider === 'custom' && (!baseUrl || baseUrl.trim() === '')) {
        showConfigStatus('自定义接口的 Base URL 不能为空', 'error');
        return;
    }
    // 保存配置
    state.config = {
        provider,
        baseUrl,
        apiKey: apiKey.trim(),
        model: model.trim(),
        builderModel: state.config.builderModel,
        coderModel: state.config.coderModel,
    };
    try {
        await window.api.saveModelConfig(state.config);
        // 同时保存到已保存列表
        await saveToApiConfigs(state.config);
        showConfigStatus('配置已保存,切换到「模型服务商」选择要使用的模型', 'success');
        updateModelListSelection();
        updateModelIndicator();
        document.querySelectorAll('.quick-btn[data-action^="config-"]').forEach(b => b.classList.add('hidden'));
    }
    catch (err) {
        showConfigStatus(`保存失败: ${err.message}`, 'error');
    }
}
let savedApiConfigs = [];
let activeApiConfigId = '';
async function loadSavedApiConfigs() {
    try {
        const data = await window.api.getApiConfigs?.();
        if (data) {
            savedApiConfigs = data.configs || [];
            activeApiConfigId = data.activeId || '';
            renderSavedConfigs();
        }
    }
    catch { /* ignore */ }
}
async function saveApiConfigs() {
    try {
        await window.api.saveApiConfigs?.({ configs: savedApiConfigs, activeId: activeApiConfigId });
    }
    catch { /* ignore */ }
}
async function saveToApiConfigs(cfg) {
    // 检查是否已存在同 provider+model 的配置
    const existing = savedApiConfigs.findIndex(c => c.provider === cfg.provider && c.apiKey === cfg.apiKey && c.model === cfg.model);
    const newConfig = {
        id: crypto.randomUUID(),
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        label: `${getProviderLabel(cfg.provider)} · ${cfg.model || '默认'}`,
        createdAt: Date.now(),
    };
    if (existing >= 0) {
        savedApiConfigs[existing] = { ...savedApiConfigs[existing], ...newConfig, id: savedApiConfigs[existing].id };
    }
    else {
        savedApiConfigs.push(newConfig);
    }
    activeApiConfigId = newConfig.id;
    await saveApiConfigs();
    renderSavedConfigs();
}
function renderSavedConfigs() {
    const list = document.getElementById('saved-configs-list');
    if (!list)
        return;
    if (savedApiConfigs.length === 0) {
        list.innerHTML = '<div class="saved-configs-empty">暂无已保存的配置 — 填写上方表单并点击保存</div>';
        return;
    }
    const providerIcons = {
        deepseek: '🧠', huoshan: '🌋', ollama: '🦙', anthropic: '🔷', custom: '🔌'
    };
    list.innerHTML = savedApiConfigs.map(c => {
        const isActive = c.id === activeApiConfigId;
        const masked = c.apiKey.slice(0, 6) + '···' + c.apiKey.slice(-4);
        return `
      <div class="saved-config-item${isActive ? ' active' : ''}" data-config-id="${c.id}">
        <span class="sci-icon">${providerIcons[c.provider] || '🔌'}</span>
        <div class="sci-info" onclick="">
          <span class="sci-label">${c.label}</span>
          <span class="sci-meta">${masked} · ${c.baseUrl.slice(0, 30) + '...'}</span>
        </div>
        <div class="sci-actions">
          ${isActive ? '<span style="font-size:10px;color:var(--tc-orange)">✓ 当前</span>' : `<button class="sci-activate-btn" data-config-id="${c.id}" title="使用此配置">⚡</button>`}
          <button class="sci-delete-btn" data-config-id="${c.id}" title="删除">✕</button>
        </div>
      </div>`;
    }).join('');
    // 点击项 → 激活
    list.querySelectorAll('.saved-config-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target;
            if (target.closest('.sci-delete-btn') || target.closest('.sci-activate-btn'))
                return;
            const id = item.dataset.configId;
            activateApiConfig(id);
        });
    });
    // 激活按钮
    list.querySelectorAll('.sci-activate-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.configId;
            activateApiConfig(id);
        });
    });
    // 删除按钮
    list.querySelectorAll('.sci-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.configId;
            deleteApiConfig(id);
        });
    });
}
async function activateApiConfig(id) {
    const cfg = savedApiConfigs.find(c => c.id === id);
    if (!cfg)
        return;
    activeApiConfigId = id;
    state.config = {
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        builderModel: state.config.builderModel,
        coderModel: state.config.coderModel,
    };
    await window.api.saveModelConfig(state.config);
    await saveApiConfigs();
    updateSettingsUI();
    updateModelListSelection();
    updateModelIndicator();
    renderSavedConfigs();
    showToast(`已切换到: ${cfg.label}`, 'success');
}
async function deleteApiConfig(id) {
    const cfg = savedApiConfigs.find(c => c.id === id);
    if (!cfg)
        return;
    showConfirm(`删除「${cfg.label}」?`, async () => {
        savedApiConfigs = savedApiConfigs.filter(c => c.id !== id);
        if (activeApiConfigId === id)
            activeApiConfigId = savedApiConfigs[0]?.id || '';
        await saveApiConfigs();
        renderSavedConfigs();
        showToast('已删除', 'success');
    });
}
function getProviderLabel(p) {
    const m = { deepseek: 'DeepSeek', huoshan: '火山方舟', ollama: 'Ollama', anthropic: 'Anthropic', custom: '自定义' };
    return m[p] || p;
}
function showConfigStatus(msg, type) {
    const el = document.getElementById('cfg-status');
    el.textContent = msg;
    el.className = `cfg-status show ${type}`;
    clearTimeout(showConfigStatus.timer);
    showConfigStatus.timer = setTimeout(() => { el.className = 'cfg-status'; }, 5000);
}
function switchToSettingsTab() {
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ai-tab-content').forEach(t => t.classList.add('hidden'));
    const settingsTab = document.querySelector('.ai-tab[data-tab="settings"]');
    if (settingsTab)
        settingsTab.classList.add('active');
    document.getElementById('tab-settings')?.classList.remove('hidden');
    loadConfig();
}
function switchToChatTab() {
    document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.ai-tab-content').forEach(t => t.classList.add('hidden'));
    const chatTab = document.querySelector('.ai-tab[data-tab="chat"]');
    if (chatTab)
        chatTab.classList.add('active');
    document.getElementById('tab-chat')?.classList.remove('hidden');
}
// 初始化设置面板事件
function initSettingsEvents() {
    // 设置 Tab 切换
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.settingsTab || 'providers';
            switchSettingsSubTab(tabName);
        });
    });
    // Provider 切换 → 自动填充默认值
    document.getElementById('cfg-provider')?.addEventListener('change', updateProviderDefaults);
    // 模型 ID 变更 → 自动显示元数据
    document.getElementById('cfg-model')?.addEventListener('input', () => {
        state.config.model = document.getElementById('cfg-model').value;
        updateModelMetaDisplay();
    });
    // 添加自定义模型
    document.getElementById('btn-add-model')?.addEventListener('click', () => {
        switchSettingsSubTab('custom');
        // 清空表单准备新建
        document.getElementById('cfg-api-key').value = '';
        document.getElementById('cfg-model').value = '';
    });
    // 测试连接
    document.getElementById('btn-test-config')?.addEventListener('click', testConfig);
    // 保存配置
    document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);
    // 导出配置
    document.getElementById('btn-export-config')?.addEventListener('click', async () => {
        try {
            const result = await window.api.exportConfig();
            if (result.success) {
                showToast(`配置已导出到 ${result.path}`, 'success');
            }
        }
        catch (err) {
            showToast(`导出失败: ${err.message}`, 'error');
        }
    });
    // 导入配置
    document.getElementById('btn-import-config')?.addEventListener('click', async () => {
        try {
            const imported = await window.api.importConfig();
            if (!imported)
                return; // 用户取消
            // 应用导入的配置(保留当前 API Key)
            if (imported.provider)
                state.config.provider = imported.provider;
            if (imported.baseUrl)
                state.config.baseUrl = imported.baseUrl;
            if (imported.model)
                state.config.model = imported.model;
            if (imported.builderModel)
                state.config.builderModel = imported.builderModel;
            if (imported.coderModel)
                state.config.coderModel = imported.coderModel;
            updateSettingsUI();
            updateModelListSelection();
            updateModelIndicator();
            await saveConfig();
            showToast('配置已导入并保存', 'success');
        }
        catch (err) {
            showToast(`导入失败: ${err.message}`, 'error');
        }
    });
}
function renderTaskProgress(tasks) {
    const container = document.getElementById('task-list');
    container.innerHTML = '';
    for (const task of tasks) {
        const item = document.createElement('div');
        item.className = `task-item ${task.status}`;
        item.innerHTML = `
      <div class="task-id">#${task.taskId}</div>
      <div class="task-desc">${task.message}</div>
      ${task.retryCount > 0 ? `<div class="task-status">重试 ${task.retryCount} 次</div>` : ''}
    `;
        container.appendChild(item);
    }
}
let termSessions = [];
let activeTermId = -1;
let termIdCounter = 0;
function initTerminal() {
    if (terminalInitialized)
        return;
    terminalInitialized = true;
    addTerminalSession('终端 1');
    renderTerminalTabs();
    document.getElementById('btn-terminal-add')?.addEventListener('click', () => {
        addTerminalSession(`终端 ${termIdCounter + 1}`);
        renderTerminalTabs();
    });
}
function addTerminalSession(name) {
    const id = ++termIdCounter;
    const container = document.getElementById('terminal-container');
    // 创建独立的容器
    const termEl = document.createElement('div');
    termEl.className = 'term-instance';
    termEl.style.cssText = 'width:100%;height:100%;position:absolute;top:0;left:0;display:none';
    container.appendChild(termEl);
    const term = new xterm_1.Terminal({
        theme: { background: '#0C0C0C', foreground: '#CCCCCC', cursor: '#CCCCCC' },
        fontFamily: "'JetBrains Mono', 'Consolas', monospace",
        fontSize: 13,
        lineHeight: 1.2,
        cursorBlink: false,
        scrollback: 1000,
    });
    const fa = new xterm_addon_fit_1.FitAddon();
    term.loadAddon(fa);
    term.open(termEl);
    let cmdBuf = '';
    term.onData((data) => {
        if (data === '\r') {
            const cmd = cmdBuf.trim();
            if (cmd && state.projectPath) {
                term.writeln(`\r\n$ ${cmd}`);
                execInTerminal(term, cmd, state.projectPath);
                cmdBuf = '';
            }
        }
        else {
            cmdBuf += data;
        }
    });
    const session = { id, name, terminal: term, fitAddon: fa, cmdBuffer: cmdBuf, container: termEl };
    termSessions.push(session);
    if (activeTermId < 0)
        activateTerminal(id);
    return id;
}
function activateTerminal(id) {
    for (const s of termSessions) {
        s.container.style.display = s.id === id ? 'block' : 'none';
    }
    activeTermId = id;
    const active = termSessions.find(s => s.id === id);
    if (active) {
        try {
            active.fitAddon.fit();
        }
        catch { }
    }
    renderTerminalTabs();
}
function closeTerminal(id) {
    const idx = termSessions.findIndex(s => s.id === id);
    if (idx < 0)
        return;
    const session = termSessions[idx];
    session.terminal.dispose();
    session.container.remove();
    termSessions.splice(idx, 1);
    if (activeTermId === id) {
        if (termSessions.length > 0) {
            activateTerminal(termSessions[termSessions.length - 1].id);
        }
        else {
            activeTermId = -1;
            addTerminalSession('终端 1');
            activateTerminal(termIdCounter);
        }
    }
    renderTerminalTabs();
}
function renderTerminalTabs() {
    const list = document.getElementById('terminal-tabs-list');
    if (!list)
        return;
    list.innerHTML = termSessions.map(s => `
    <div class="terminal-tab ${s.id === activeTermId ? 'active' : ''}" data-term-id="${s.id}">
      <span>${s.name}</span>
      <span class="terminal-tab-close" data-close="${s.id}">&times;</span>
    </div>
  `).join('');
    list.querySelectorAll('.terminal-tab').forEach(el => {
        const id = parseInt(el.dataset.termId || '0');
        el.addEventListener('click', (e) => {
            if (e.target.dataset.close) {
                e.stopPropagation();
                closeTerminal(parseInt(e.target.dataset.close || '0'));
            }
            else {
                activateTerminal(id);
            }
        });
    });
}
async function execInTerminal(term, cmd, cwd) {
    try {
        const result = await window.api.execCommand(cmd, cwd);
        if (result.stdout)
            term.writeln(result.stdout);
        if (result.stderr)
            term.writeln(`\x1b[31m${result.stderr}\x1b[0m`);
        if (result.exitCode !== 0)
            term.writeln(`\x1b[33m[exit ${result.exitCode}]\x1b[0m`);
        term.writeln('');
    }
    catch (err) {
        term.writeln(`\x1b[31mError: ${err.message}\x1b[0m`);
    }
}
function fitActiveTerminal() {
    const active = termSessions.find(s => s.id === activeTermId);
    if (active) {
        try {
            active.fitAddon.fit();
        }
        catch { }
    }
}
// ─────────────────────────────────────────
// 拖拽调整器
// ─────────────────────────────────────────
function setupResizers() {
    const sidebarResizer = document.getElementById('sidebar-resizer');
    const aiPanelResizer = document.getElementById('ai-panel-resizer');
    const sidebar = document.getElementById('sidebar');
    const aiPanel = document.getElementById('ai-panel');
    let isResizing = false;
    let resizerType = null;
    sidebarResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizerType = 'sidebar';
        e.preventDefault();
    });
    aiPanelResizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        resizerType = 'ai';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isResizing)
            return;
        if (resizerType === 'sidebar') {
            const newWidth = Math.max(120, Math.min(600, e.clientX));
            sidebar.style.width = `${newWidth}px`;
            state.sidebarWidth = newWidth;
        }
        else if (resizerType === 'ai') {
            const newWidth = Math.max(280, Math.min(window.innerWidth * 0.6, window.innerWidth - e.clientX));
            aiPanel.style.width = `${newWidth}px`;
            state.aiPanelWidth = newWidth;
        }
        editor?.layout();
    });
    document.addEventListener('mouseup', () => {
        isResizing = false;
        resizerType = null;
    });
    // ═══ HTML 错误控制台拖拽调整高度 ═══
    const errConsole = document.getElementById('html-error-console');
    if (errConsole) {
        // 默认给个合适高度
        errConsole.style.maxHeight = '150px';
        errConsole.style.height = 'auto';
        // 拖拽手柄
        const errHandle = document.createElement('div');
        errHandle.className = 'error-console-handle';
        errConsole.prepend(errHandle);
        let errStartY = 0, errStartH = 0, errDragging = false;
        errHandle.addEventListener('mousedown', (e) => {
            errDragging = true;
            errStartY = e.clientY;
            errStartH = errConsole.offsetHeight;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!errDragging)
                return;
            const delta = errStartY - e.clientY;
            const h = Math.max(60, Math.min(450, errStartH + delta));
            errConsole.style.maxHeight = h + 'px';
            errConsole.style.height = h + 'px';
            editor?.layout();
        });
        document.addEventListener('mouseup', () => {
            errDragging = false;
        });
    }
}
// ─────────────────────────────────────────
// 上下文菜单
// ─────────────────────────────────────────
let contextMenuTarget = null;
function showContextMenu(e, node) {
    contextMenuTarget = node;
    const menu = document.getElementById('context-menu');
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.classList.remove('hidden');
}
function hideContextMenu() {
    document.getElementById('context-menu').classList.add('hidden');
}
async function handleContextAction(action) {
    if (!contextMenuTarget)
        return;
    const { path, isDirectory } = contextMenuTarget;
    hideContextMenu();
    switch (action) {
        case 'new-file':
            newFileDialog();
            break;
        case 'new-folder': {
            const dirName = prompt('文件夹名:');
            if (dirName && contextMenuTarget) {
                const targetDir = contextMenuTarget.isDirectory ? path : path.substring(0, path.replace(/\\/g, '/').lastIndexOf('/'));
                const newPath = (targetDir || state.projectPath || '') + '/' + dirName;
                try {
                    await window.api.createDir?.(newPath);
                    if (state.projectPath)
                        await loadFileTree(state.projectPath);
                    showToast('文件夹已创建', 'success');
                }
                catch (err) {
                    showToast(`创建失败: ${err.message}`, 'error');
                }
            }
            break;
        }
        case 'delete':
            if (confirm(`确定删除 ${contextMenuTarget.name || path}?`)) {
                await window.api.deleteFile(path);
                if (state.projectPath)
                    await loadFileTree(state.projectPath);
            }
            break;
        case 'copy-path':
            navigator.clipboard.writeText(path);
            break;
        case 'show-in-folder':
            await window.api.showItemInFolder(path);
            break;
        case 'rename': {
            const newName = prompt('新名称:', contextMenuTarget?.name || '');
            if (newName && newName !== contextMenuTarget?.name && contextMenuTarget) {
                const dir = path.replace(/[\\/][^\\/]+$/, '');
                const newPath = dir + '/' + newName;
                try {
                    await window.api.renameFile(path, newPath);
                    if (state.projectPath)
                        await loadFileTree(state.projectPath);
                    showToast('已重命名', 'success');
                }
                catch (err) {
                    showToast(`重命名失败: ${err.message}`, 'error');
                }
            }
            break;
        }
        case 'restore-snapshot': {
            // 恢复 AI 修改前的文件快照
            const snapshots = await window.api.listSnapshots(state.projectPath || '', path);
            if (!snapshots || snapshots.length === 0) {
                showToast('未找到该文件的快照记录', 'info');
                break;
            }
            const latest = snapshots[snapshots.length - 1];
            await window.api.restoreSnapshot(latest.id);
            // 如果当前编辑器中是该文件,更新内容
            const openEntry = state.openFiles.find(f => f.path === path);
            if (openEntry) {
                try {
                    const restored = await window.api.readFile(path);
                    if (editor)
                        editor.setValue(restored);
                }
                catch { /* ignore */ }
            }
            showToast('已恢复至 AI 修改前版本', 'info');
            break;
        }
    }
}
// ─────────────────────────────────────────
// 全局事件绑定
// ─────────────────────────────────────────
function setupEventListeners() {
    // 项目打开
    window.api.on('project-opened', async (_event, projectPath) => {
        state.projectPath = projectPath;
        hideWelcomePage();
        await loadFileTree(state.projectPath);
        // 记录到最近项目
        window.api.addRecentProject?.(state.projectPath).catch(() => { });
        // 📋 加载 AI 行为规则(CLAUDE.md)
        try {
            const rules = await window.api.getProjectRules(state.projectPath);
            window.api.setProjectRules(rules);
        }
        catch (_) { /* 无规则文件,使用内置默认 */ }
        // P0: 初始化上下文瘦身 + 自愈引擎
        initP0ProjectServices(state.projectPath);
        // 清除欢迎消息
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        const welcome = document.createElement('div');
        welcome.className = 'welcome-message';
        welcome.innerHTML = `
      <div class="welcome-icon">🤖</div>
      <div class="welcome-text">
        <h3>虎猫</h3>
        <p>项目已加载:${path.basename(state.projectPath)}</p>
        <div class="quick-actions">
          <button class="quick-btn" data-action="new-feature">新增功能</button>
          <button class="quick-btn" data-action="refactor">代码重构</button>
          <button class="quick-btn" data-action="fix-bug">修复 Bug</button>
        </div>
      </div>
    `;
        container.appendChild(welcome);
    });
    // AI 流式响应
    window.api.on('ai-stream-chunk', (_event, chunk) => {
        const text = chunk;
        // 检测工具调用 JSON (来自 ai:send-with-tools)
        if (text.startsWith('{') && text.includes('"type":"tool_')) {
            try {
                const toolMsg = JSON.parse(text);
                if (toolMsg.type === 'tool_call') {
                    addToolCallMessage(toolMsg.name, toolMsg.args, toolMsg.id);
                }
                else if (toolMsg.type === 'tool_result') {
                    updateToolCallResult(toolMsg.id, toolMsg.result, toolMsg.error);
                }
                return;
            }
            catch { /* not JSON, regular text */ }
        }
        appendStreamChunk(text);
    });
    window.api.on('ai-stream-end', () => {
        hideTypingIndicator();
        const session = ensureSession();
        const content = state.currentStreamContent;
        stopStreaming();
        session.chatHistory.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content,
            timestamp: Date.now(),
        });
        state.currentStreamContent = '';
        // ── 检测 AI 分段读取请求 ──
        const readMatches = content.match(/\/read\s+(\d+)\s*-\s*(\d+)/g);
        if (readMatches && readMatches.length > 0 && state.activeFileIndex >= 0) {
            const lastMatch = readMatches[readMatches.length - 1];
            const m = lastMatch.match(/\/read\s+(\d+)\s*-\s*(\d+)/);
            if (m) {
                const start = parseInt(m[1]);
                const end = parseInt(m[2]);
                confirmAiRead(start, end);
            }
        }
        // ── 持久化聊天记录 ──
        saveSessionsToDisk();
    });
    window.api.on('ai-stream-error', (_event, error) => {
        hideTypingIndicator();
        appendStreamChunk(`\n\n**错误**: ${error}`);
        stopStreaming();
    });
    // 任务进度
    window.api.on('task-progress', (_event, progress) => {
        const p = progress;
        const taskList = document.getElementById('task-list');
        let taskEl = taskList.querySelector(`[data-task-id="${p.taskId}"]`);
        if (!taskEl) {
            taskEl = document.createElement('div');
            taskEl.className = `task-item ${p.status}`;
            taskEl.dataset.taskId = p.taskId;
            taskEl.innerHTML = `
        <div class="task-id">#${p.taskId}</div>
        <div class="task-desc">${p.message}</div>
      `;
            taskList.appendChild(taskEl);
        }
        taskEl.className = `task-item ${p.status}`;
        taskEl.querySelector('.task-desc').textContent = p.message;
    });
    // Orchestrator 实时事件 → Pipeline 面板
    window.api.onOrchestratorPhase?.((d) => {
        const phase = d?.phase;
        const data = d?.data;
        if (phase === 'builder_done' && Array.isArray(data)) {
            // 显示任务列表
            data.forEach((t, i) => {
                addPipelineTask(t.id || `o${i}`, t.desc || t.id, (t.files || []).join(', '));
            });
            setPipelinePhase('coder');
        } else if (phase === 'coder') {
            setPipelinePhase('coder');
        } else if (phase === 'reviewer') {
            setPipelinePhase('reviewer');
        } else if (phase === 'tester') {
            setPipelinePhase('tester');
        } else if (phase === 'error') {
            showPipelineSummary(false, data);
        }
    });
    window.api.onOrchestratorTaskProgress?.((data) => {
        updatePipelineTask(data.taskId, data.status === 'coding' || data.status === 'fixing' ? 'running' : data.status);
    });
    // 菜单操作
    window.api.on('menu-action', (_event, action) => {
        switch (action) {
            case 'toggle-ai-panel':
                document.getElementById('ai-panel').classList.toggle('hidden');
                document.getElementById('ai-panel-resizer').classList.toggle('hidden');
                editor?.layout();
                break;
            case 'zen-mode':
                document.body.classList.toggle('zen-mode');
                editor?.layout();
                break;
            case 'toggle-terminal':
                toggleTerminal();
                break;
            case 'send-to-builder':
                sendToAI();
                break;
            case 'abort-task':
                stopStreaming();
                break;
            case 'clear-chat':
                document.getElementById('chat-messages').innerHTML = '';
                ensureSession().chatHistory = [];
                break;
            case 'open-settings':
                switchToSettingsTab();
                break;
            case 'show-about':
                document.getElementById('about-dialog')?.classList.toggle('hidden');
                break;
            case 'save':
                saveCurrentFile();
                break;
            case 'new-file':
                newFileDialog();
                break;
        }
    });
    // 全局快捷键
    document.addEventListener('keydown', (e) => {
        // ── Diff 预览弹窗快捷键 ──
        if (diffState) {
            if (e.key === 'Enter') {
                e.preventDefault();
                acceptDiff();
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                closeDiffModal();
                return;
            }
        }
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && e.key === 'o') {
            e.preventDefault();
            openProjectDialog();
        }
        else if (ctrl && e.key === 'n') {
            e.preventDefault();
            newFileDialog();
        }
        else if (ctrl && e.key === 's') {
            e.preventDefault();
            saveCurrentFile();
        }
        else if (ctrl && e.shiftKey && e.key === 'M') {
            e.preventDefault();
            document.body.classList.toggle('zen-mode');
            editor?.layout();
        }
        else if (ctrl && e.key === '\\') {
            e.preventDefault();
            document.getElementById('ai-panel').classList.toggle('hidden');
            editor?.layout();
        }
        else if (ctrl && e.key === 'Enter') {
            e.preventDefault();
            sendToAI();
        }
        else if (e.key === 'Escape' && state.isStreaming) {
            stopStreaming();
        }
        else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'B') {
            // Builder 模式:直接输入需求
            e.preventDefault();
            const builderInput = document.getElementById('chat-input');
            builderInput.focus();
            builderInput.placeholder = 'Builder 模式 - 在此输入你的需求...';
            showToast('🧱 Builder 模式激活', 'info');
        }
        else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'C') {
            // Coder 模式:输入代码指令
            e.preventDefault();
            const coderInput = document.getElementById('chat-input');
            coderInput.focus();
            coderInput.placeholder = 'Coder 模式 - 在此输入代码指令...';
            showToast('🔧 Coder 模式激活', 'info');
        }
        else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'P') {
            // 命令面板
            e.preventDefault();
            openCommandPalette();
        }
        else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'F') {
            // 项目级搜索
            e.preventDefault();
            openSearchPanel();
        }
        else if (ctrl && e.key === '`') {
            // 切换终端
            e.preventDefault();
            toggleTerminal();
        }
        else if (ctrl && e.key === 'w') {
            // 关闭当前标签页
            e.preventDefault();
            if (state.openFiles.length > 0) {
                const idx = state.activeFileIndex >= 0 ? state.activeFileIndex : state.openFiles.length - 1;
                closeFile(idx);
            }
        }
        else if (ctrl && e.key === 'Tab') {
            // 切换下一个标签页
            e.preventDefault();
            if (state.openFiles.length > 1) {
                const next = (state.activeFileIndex + 1) % state.openFiles.length;
                switchToFile(next);
            }
        }
        else if (ctrl && e.shiftKey && e.key === 'Tab') {
            // 切换上一个标签页
            e.preventDefault();
            if (state.openFiles.length > 1) {
                const prev = (state.activeFileIndex - 1 + state.openFiles.length) % state.openFiles.length;
                switchToFile(prev);
            }
        }
        else if (ctrl && e.key === 'p') {
            // 快速打开文件:触发全局搜索
            e.preventDefault();
            openSearchPanel();
        }
        else if (ctrl && e.shiftKey && e.key.toUpperCase() === 'X') {
            // 终止 AI 任务
            e.preventDefault();
            stopStreaming();
            window.api.abortTask?.();
            showToast('⏹ 已终止 AI 任务', 'info');
        }
    });
    // Chat 输入框自动高度
    const chatInput = document.getElementById('chat-input');
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, 150) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.shiftKey)) {
            e.preventDefault();
            sendToAI();
        }
    });
    // AI Tab 切换
    document.querySelectorAll('.ai-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            document.querySelectorAll('.ai-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.ai-tab-content').forEach(c => c.classList.add('hidden'));
            tab.classList.add('active');
            document.getElementById(`tab-${tabName}`)?.classList.remove('hidden');
        });
    });
    // 快捷按钮
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const action = btn.dataset.action;
            const chatInput = document.getElementById('chat-input');
            if (action === 'config-deepseek') {
                // 快速配置 DeepSeek:切到设置并预填
                switchToSettingsTab();
                const provEl = document.getElementById('cfg-provider');
                const baseEl = document.getElementById('cfg-base-url');
                if (provEl)
                    provEl.value = 'deepseek';
                if (baseEl)
                    baseEl.value = 'https://api.deepseek.com/v1';
                updateProviderDefaults();
                if (baseEl)
                    baseEl.focus();
                showToast('已切换到 DeepSeek,请在下方填入 API Key', 'info');
            }
            else if (action === 'config-ollama') {
                switchToSettingsTab();
                const provEl = document.getElementById('cfg-provider');
                const baseEl = document.getElementById('cfg-base-url');
                if (provEl)
                    provEl.value = 'ollama';
                if (baseEl)
                    baseEl.value = 'http://localhost:11434';
                const modelEl = document.getElementById('cfg-model');
                if (modelEl)
                    modelEl.value = 'llama3.2';
                updateProviderDefaults();
                showToast('已切换到 Ollama,请确保本地服务已启动', 'info');
            }
            else {
                const prompts = {
                    'open-project': '',
                    'new-feature': '新增一个功能模块',
                    'refactor': '帮我重构这段代码',
                    'fix-bug': '修复一个 bug',
                };
                chatInput.value = prompts[action || ''] || '';
                chatInput.focus();
            }
        });
    });
    // ── Gradle 快捷按钮 ──
    document.querySelectorAll('.gradle-badge').forEach(badge => {
        badge.addEventListener('click', async () => {
            const task = badge.dataset.gradle;
            if (!task || !state.projectPath)
                return;
            showToast('正在执行 gradle ' + task + '...', 'info');
            const result = await window.api.gradleExec(state.projectPath, task);
            const exitOk = result.exitCode === 0;
            addChatMessage('system', 'Gradle ' + task + (exitOk ? ' ✅ 完成' : ' ❌ 失败(exit ' + result.exitCode + ')') + '\n\n' + result.output.slice(-2000));
        });
    });
    // ── 帮助图标 ──
    document.getElementById('status-help')?.addEventListener('click', () => {
        document.getElementById('help-dialog')?.classList.toggle('hidden');
    });
    document.querySelector('.help-close')?.addEventListener('click', () => {
        document.getElementById('help-dialog')?.classList.add('hidden');
    });
    // 点击遮罩层关闭
    document.getElementById('help-dialog')?.addEventListener('click', (e) => {
        if (e.target.id === 'help-dialog') {
            e.target.classList.add('hidden');
        }
    });
    // 设置保存
    document.getElementById('btn-save-config')?.addEventListener('click', saveConfig);
    // 发送按钮
    document.getElementById('btn-send')?.addEventListener('click', sendToAI);
    document.getElementById('btn-abort')?.addEventListener('click', stopStreaming);
    // ── 输入框键盘:Ctrl+Enter 发送,Shift+Enter 换行 ──
    document.getElementById('chat-input')?.addEventListener('keydown', (e) => {
        const ke = e;
        if (ke.key === 'Enter' && ke.ctrlKey) {
            e.preventDefault();
            sendToAI();
        }
        else if (ke.key === 'Enter' && !ke.shiftKey) {
            // Plain Enter also sends (in addition to Ctrl+Enter)
            // Shift+Enter is the only newline path
            e.preventDefault();
            sendToAI();
        }
    });
    // 新建文件/文件夹
    document.getElementById('btn-new-file')?.addEventListener('click', newFileDialog);
    document.getElementById('btn-new-folder')?.addEventListener('click', () => {
        const dirName = prompt('文件夹名:');
        if (dirName && state.projectPath) {
            const newPath = state.projectPath.replace(/\\/g, '/') + '/' + dirName;
            window.api.createDir(newPath).then(() => {
                loadFileTree(state.projectPath);
                showToast('文件夹已创建', 'success');
            }).catch((err) => showToast(`创建失败: ${err.message}`, 'error'));
        }
    });
    // 系统操作按钮
    document.getElementById('btn-open-terminal')?.addEventListener('click', () => window.api.openTerminal(state.projectPath || undefined));
    document.getElementById('btn-open-browser')?.addEventListener('click', () => {
        const url = prompt('输入 URL (默认 http://localhost:3000):', 'http://localhost:3000');
        if (url)
            window.api.openBrowser(url);
    });
    document.getElementById('btn-open-folder')?.addEventListener('click', () => window.api.openFolder(state.projectPath || undefined));
    // 折叠全部
    document.getElementById('btn-collapse-all')?.addEventListener('click', () => {
        document.querySelectorAll('.tree-children').forEach(el => el.remove());
        document.querySelectorAll('.arrow.open').forEach(el => el.classList.remove('open'));
    });
    // ═══ 活动栏:视图切换 ═══
    document.querySelectorAll('.activity-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (!view)
                return;
            // 更新按钮激活状态
            document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // 切换视图面板
            document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
            const searchBar = document.getElementById('sidebar-search-explorer');
            if (view === 'explorer') {
                document.getElementById('file-tree')?.classList.remove('hidden');
                if (searchBar)
                    searchBar.classList.remove('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('EXPLORER');
            }
            else if (view === 'search') {
                document.getElementById('file-tree')?.classList.remove('hidden');
                if (searchBar)
                    searchBar.classList.remove('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('SEARCH');
                document.getElementById('file-tree-search')?.focus();
            }
            else if (view === 'git') {
                document.getElementById('git-panel')?.classList.remove('hidden');
                if (searchBar)
                    searchBar.classList.add('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('GIT');
                refreshGitPanel();
            }
            else if (view === 'arch') {
                document.getElementById('arch-panel')?.classList.remove('hidden');
                if (searchBar)
                    searchBar.classList.add('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('ARCH');
                refreshArchPanel();
            }
            else if (view === 'debug') {
                const debugContainer = document.getElementById('debug-panel');
                if (debugContainer) debugContainer.classList.remove('hidden');
                if (searchBar) searchBar.classList.add('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('DEBUG');
                document.getElementById('file-tree')?.classList.add('hidden');
                document.getElementById('git-panel')?.classList.add('hidden');
                document.getElementById('arch-panel')?.classList.add('hidden');
                if (debugPanelInstance) debugPanelInstance.toggle(true);
            }
            else if (view === 'problems') {
                document.getElementById('problems-panel')?.classList.remove('hidden');
                if (searchBar) searchBar.classList.add('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('问题');
                document.getElementById('file-tree')?.classList.add('hidden');
                document.getElementById('git-panel')?.classList.add('hidden');
                document.getElementById('arch-panel')?.classList.add('hidden');
                refreshFileDiagnostics();
            }
            else if (view === 'settings') {
                // settings 打开设置弹窗,保持当前视图
                switchToSettingsTab();
                // 恢复激活状态到 explorer
                document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('.activity-btn[data-view="explorer"]')?.classList.add('active');
            }
        });
    });

    // ═══ 主题切换(白虎 / 老虎) ═══
    // ── 初始化所有智能服务 ──
    function initAllServices() {
        if (!state.projectPath) return;
        const p = state.projectPath;
        // 逐个初始化，失败不影响其他
        window.api.memoryInit?.(p).catch(() => {});
        window.api.gitintelInit?.(p).catch(() => {});
        window.api.warehouseInit?.(p).catch(() => {});
        window.api.completionInit?.(p).catch(() => {});
        window.api.entropyInit?.(p).catch(() => {});
        window.api.smartTrimmerInit?.(p).catch(() => {});
        showToast('智能服务已初始化', 'info', 1500);
    }
    // ── Lint：文件切换时自动检查 ──
    let lintEnabled = true;
    let lintLastFile = null;
    async function autoLintFile(filePath) {
        if (!lintEnabled || !state.projectPath || !filePath || filePath === lintLastFile) return;
        lintLastFile = filePath;
        try {
            const result = await window.api.lintFile?.(filePath, state.projectPath);
            if (result?.diagnostics?.length) {
                const panel = document.getElementById('problems-list');
                const empty = document.getElementById('problems-empty');
                if (panel && empty) {
                    empty.classList.add('hidden');
                    panel.classList.remove('hidden');
                    const icons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
                    panel.innerHTML = result.diagnostics.map(d => {
                        const fname = filePath.split(/[/\\]/).pop();
                        return `<div class="problem-item problem-${d.severity || 'warning'}" style="padding:4px 8px;font-size:11px;border-bottom:1px solid var(--border-subtle);cursor:pointer" onclick="editor.revealLine(${d.line || 1})">
        <span style="color:var(--text-secondary)">${fname}:${d.line || ''}</span>
        <span style="margin-left:6px">${icons[d.severity] || '•'} ${d.message || d.rule || ''}</span>
      </div>`;
                    }).join('');
                    const badge = document.getElementById('problems-badge');
                    if (badge) { badge.textContent = result.diagnostics.length; badge.classList.remove('hidden'); }
                }
            }
        } catch { /* lint tool not installed */ }
    }
    // Auto-lint on file switch (debounced)
    let lintTimer = null;
    const origSwitchToFile = switchToFile;
    switchToFile = function(index) {
        origSwitchToFile(index);
        if (lintTimer) clearTimeout(lintTimer);
        const f = state.openFiles[index];
        if (f) lintTimer = setTimeout(() => autoLintFile(f.path), 500);
    };
    // ── GitIntelligence：智能提交消息 ──
    async function generateSmartCommitMessage() {
        if (!state.projectPath) return showToast('请先打开项目', 'warning');
        const input = document.getElementById('git-commit-input');
        if (!input) return;
        input.placeholder = '🤖 AI 正在生成提交信息...';
        try {
            const msg = await window.api.gitintelGenerateCommitMessage(state.projectPath, { style: 'conventional' });
            if (msg) {
                input.value = msg;
                input.placeholder = '输入提交信息...';
                showToast('AI 已生成提交信息', 'success');
            }
        } catch (e) {
            input.placeholder = '输入提交信息...';
            showToast('智能提交信息生成失败', 'warning');
        }
    }
    // ── WarehouseAnalyzer：架构分析面板 ──
    async function refreshArchPanel() {
        const container = document.getElementById('arch-panel');
        if (!container || !state.projectPath) return;
        container.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-secondary)">⏳ 正在分析项目结构...</div>';
        try {
            const result = await window.api.warehouseAnalyzeAll?.();
            if (!result) { container.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-secondary)">未找到分析数据</div>'; return; }
            let html = '<div style="padding:8px 12px;font-size:11px">';
            if (result.modules?.length) {
                html += '<div style="font-weight:600;margin-bottom:6px;color:var(--tc-orange)">📦 模块 (' + result.modules.length + ')</div>';
                result.modules.slice(0, 20).forEach(m => {
                    html += '<div style="padding:2px 0;color:var(--text-primary)">' + (m.name || m.path || '?') + ' <span style="color:var(--text-secondary);font-size:10px">' + (m.fileCount || '') + '文件</span></div>';
                });
            }
            if (result.dependencies?.length) {
                html += '<div style="font-weight:600;margin:10px 0 6px;color:var(--tc-orange)">🔗 依赖关系 (' + result.dependencies.length + ')</div>';
                result.dependencies.slice(0, 15).forEach(d => {
                    html += '<div style="padding:2px 0;font-size:10px"><span style="color:var(--text-primary)">' + (d.from || '?') + '</span> → <span style="color:var(--text-secondary)">' + (d.to || '?') + '</span></div>';
                });
            }
            html += '</div>';
            container.innerHTML = html;
        } catch { container.innerHTML = '<div style="padding:16px;font-size:12px;color:var(--text-secondary)">分析失败</div>'; }
    }
    // Progress listener
    window.api.onWarehouseProgress?.((data) => {
        const container = document.getElementById('arch-panel');
        if (container) container.innerHTML = `<div style="padding:16px;font-size:12px;color:var(--text-secondary)">⏳ 分析中: ${data.percent || 0}%</div>`;
    });
    // ── Entropy + SmartTrimmer 健康面板 ──
    window.api.onEntropyProgress?.((data) => {
        document.getElementById('health-score')?.replaceChildren(`健康度: ${data.entropy || '?'}`);
    });
    // ── PerfOptimizer ──
    async function updatePerfStatus() {
        try {
            const m = await window.api.perfGetMetrics?.();
            const el = document.getElementById('perf-status');
            if (el && m) el.textContent = `RAM:${((m.heapUsed||0)/1024/1024).toFixed(0)}MB`;
        } catch {}
    }
    setInterval(updatePerfStatus, 5000);
    // ── ContextTrimmer 状态更新 ──
    let trimmerStats = { trimmed: 0, archived: 0 };
    setInterval(async () => {
        try { const s = await window.api.smartTrimmerGetArchiveSummary?.(); if (s) trimmerStats = s; } catch {}
    }, 30000);
    // ── UnattendedRunner ──
    async function runInSandbox(taskDesc, files) {
        if (!state.projectPath) return showToast('请先打开项目', 'warning');
        try {
            const result = await window.api.unattendedRun?.(state.projectPath, taskDesc, files);
            if (result?.success) showToast('沙箱执行完成', 'success', 3000);
            else showToast('沙箱执行失败: ' + (result?.error || '未知'), 'error');
        } catch (e) { showToast('沙箱执行异常', 'error'); }
    }
    // ── AutoHeal：自动修复文档 ──
    window.api.onAutoHealFix?.(() => {}); // 预留监听
    // ── Problems 刷新按钮 ──
    document.getElementById('btn-problems-refresh')?.addEventListener('click', () => {
        refreshFileDiagnostics();
        showToast('已刷新诊断', 'info', 1500);
    });
    const themeBtn = document.getElementById('btn-toggle-theme');
    function applyEditorTheme(isLight) {
        if (editor) {
            monaco.editor.setTheme(isLight ? 'trae-light' : 'trae-dark');
        }
    }
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const isLight = document.documentElement.classList.toggle('theme-light');
            themeBtn.setAttribute('title', isLight ? '切换为老虎(暗色)' : '切换为白虎(亮色)');
            applyEditorTheme(isLight);
            try {
                localStorage.setItem('tcide-theme', isLight ? 'light' : 'dark');
            }
            catch { }
        });
        try {
            if (localStorage.getItem('tcide-theme') === 'light') {
                document.documentElement.classList.add('theme-light');
                themeBtn.setAttribute('title', '切换为老虎(暗色)');
                applyEditorTheme(true);
            }
        }
        catch { }
    }
    // ═══ Git 面板 ═══
    async function refreshGitPanel() {
        const statusList = document.getElementById('git-status-list');
        const branchEl = document.getElementById('git-branch-name');
        if (!statusList || !state.projectPath) {
            if (statusList)
                statusList.innerHTML = '<div class="git-empty">请先打开项目</div>';
            return;
        }
        statusList.innerHTML = '<div class="git-empty">加载中...</div>';
        try {
            const status = await window.api.getGitStatus(state.projectPath);
            if (!status.success) {
                statusList.innerHTML = '<div class="git-empty">非 Git 仓库或无变更</div>';
                return;
            }
            if (branchEl)
                branchEl.textContent = status.branch;
            // ── 分支列表 ──
            const branchSelect = document.getElementById('git-branch-select');
            if (branchSelect) {
                try {
                    const branchesRes = await window.api.gitListBranches(state.projectPath);
                    if (branchesRes.success && branchesRes.branches) {
                        branchSelect.innerHTML = branchesRes.branches.map(b => `<option value="${b.name}" ${b.current ? 'selected' : ''}>${b.current ? '● ' : '  '}${b.name}</option>`).join('');
                        branchSelect.classList.remove('hidden');
                        branchEl?.classList.add('hidden');
                    }
                }
                catch {
                    branchEl?.classList.remove('hidden');
                    if (branchSelect)
                        branchSelect.classList.add('hidden');
                }
            }
            if (status.files.length === 0) {
                statusList.innerHTML = '<div class="git-empty">✓ 工作区干净</div>';
            }
            else {
                statusList.innerHTML = status.files.map(f => {
                    const iconMap = { M: '📝', A: '➕', D: '🗑️', R: '📋', '??': '🆕', '!': '⚠️', 'U': '⚠️' };
                    const statusCode = f.status || '??';
                    const icon = iconMap[statusCode] || '📄';
                    const cssClass = statusCode === 'M' ? 'modified' : statusCode === 'A' ? 'added' : statusCode === 'D' ? 'deleted' : statusCode === '??' ? 'untracked' : '';
                    return `<div class="git-status-item"><span class="status-icon ${cssClass}">${icon}</span><span class="status-path">${f.path}</span></div>`;
                }).join('');
            }
        }
        catch {
            statusList.innerHTML = '<div class="git-empty">Git 状态读取失败</div>';
        }
    }
    document.getElementById('btn-git-pull')?.addEventListener('click', async () => {
        if (!state.projectPath)
            return;
        showToast('正在拉取...', 'info');
        const result = await window.api.pull(state.projectPath);
        if (result.success) {
            showToast('拉取成功', 'success');
            refreshGitPanel();
        }
        else {
            showToast(`拉取失败: ${result.error}`, 'error');
        }
    });
    document.getElementById('btn-git-commit')?.addEventListener('click', () => {
        document.getElementById('git-commit-area')?.classList.toggle('hidden');
        // P1: 智能 Commit Message — AI 自动生成
        generateSmartCommitMessage();
    });
    document.getElementById('btn-git-do-commit')?.addEventListener('click', async () => {
        if (!state.projectPath)
            return;
        const msgInput = document.getElementById('git-commit-message');
        const msg = msgInput?.value?.trim();
        if (!msg) {
            showToast('请输入提交信息', 'warn');
            return;
        }
        showToast('正在提交...', 'info');
        // Stage all first
        await window.api.stageAll(state.projectPath);
        const commitResult = await window.api.commit(state.projectPath, msg);
        if (commitResult.success) {
            showToast('提交成功', 'success');
            // Auto push
            const pushResult = await window.api.push(state.projectPath);
            if (pushResult.success)
                showToast('已推送到远程', 'success');
            else
                showToast(`推送失败: ${pushResult.error}`, 'warn');
            msgInput.value = '';
            document.getElementById('git-commit-area')?.classList.add('hidden');
            refreshGitPanel();
        }
        else {
            showToast(`提交失败: ${commitResult.error}`, 'error');
        }
    });
    document.getElementById('btn-git-push')?.addEventListener('click', async () => {
        if (!state.projectPath)
            return;
        showToast('正在推送...', 'info');
        const result = await window.api.push(state.projectPath);
        if (result.success) {
            showToast('推送成功', 'success');
        }
        else {
            showToast(`推送失败: ${result.error}`, 'error');
        }
    });
    // ── 分支切换 ──
    document.getElementById('git-branch-select')?.addEventListener('change', async (e) => {
        const sel = e.target.value;
        if (!state.projectPath || !sel)
            return;
        showToast(`切换到 ${sel}...`, 'info');
        const result = await window.api.gitCheckout(sel, state.projectPath);
        if (result.success) {
            showToast(`已切换到 ${sel}`, 'success');
            // 刷新整个项目
            document.querySelectorAll('.tree-item').forEach(el => el.classList.remove('selected'));
            refreshGitPanel();
            // 通知文件变更
            try {
                window.api.onFileChanged?.((_path) => { });
            }
            catch { }
            if (window.api.watchProject) {
                window.api.watchProject(state.projectPath, true);
            }
        }
        else {
            showToast(`切换失败: ${result.error}`, 'error');
            refreshGitPanel();
        }
    });
    // ═══ 架构分析面板 ═══
    async function refreshArchPanel() {
        const overview = document.getElementById('arch-overview');
        const depsEl = document.getElementById('arch-deps');
        const smellsEl = document.getElementById('arch-smells');
        if (!overview || !state.projectPath) {
            if (overview)
                overview.innerHTML = '<div class="arch-empty">请先打开项目</div>';
            return;
        }
        overview.innerHTML = '<div class="arch-empty">正在分析依赖... ⏳</div>';
        if (depsEl)
            depsEl.classList.add('hidden');
        if (smellsEl)
            smellsEl.classList.add('hidden');
        try {
            const arch = await window.api.analyzeArchitecture(state.projectPath);
            // 语言颜色
            const langColors = {
                kotlin: '#7F52FF', java: '#b07219', typescript: '#3178c6', javascript: '#f7df1e',
                python: '#3572A5', go: '#00ADD8', rust: '#dea584', xml: '#0060ac',
                markdown: '#083fa1', json: '#292929', css: '#563d7c', html: '#e34c26',
                yaml: '#cb171e', toml: '#9c4221', shell: '#89e051', gradle: '#02303a',
            };
            const totalLang = Object.values(arch.languages).reduce((a, b) => a + b, 0);
            const langBar = Object.entries(arch.languages).map(([lang, count]) => {
                const pct = ((count / totalLang) * 100).toFixed(1);
                const color = langColors[lang] || '#666';
                return `<div class="arch-lang-segment" style="width:${pct}%;background:${color}" title="${lang}"></div>`;
            }).join('');
            const langLegend = Object.entries(arch.languages).map(([lang, count]) => {
                const color = langColors[lang] || '#666';
                return `<span class="arch-lang-item"><span class="arch-lang-dot" style="background:${color}"></span>${lang}:${count}</span>`;
            }).join('');
            // 概览
            overview.innerHTML = `
        <div class="arch-stats">
          <div class="arch-stat"><div class="stat-value">${arch.totalFiles}</div><div class="stat-label">文件数</div></div>
          <div class="arch-stat"><div class="stat-value">${(arch.totalLines / 1000).toFixed(1)}k</div><div class="stat-label">总行数</div></div>
          <div class="arch-stat"><div class="stat-value">${(arch.totalSize / 1024 / 1024).toFixed(1)}MB</div><div class="stat-label">总大小</div></div>
          <div class="arch-stat"><div class="stat-value">${arch.nodes.filter((n) => n.type === 'file').length}</div><div class="stat-label">源文件</div></div>
        </div>
        <div class="arch-lang-bar">${langBar}</div>
        <div class="arch-lang-legend">${langLegend}</div>
        ${arch.entryPoints.length > 0 ? `
          <div class="arch-entry-points">
            <div style="font-size:11px;color:var(--text-dim);margin-bottom:2px">入口点:</div>
            ${arch.entryPoints.slice(0, 5).map((e) => `<div class="arch-entry-item">${e}</div>`).join('')}
          </div>
        ` : ''}
      `;
            // 依赖图(Top 15 被依赖最多的文件)
            const fileNodes = arch.nodes.filter((n) => n.type === 'file').sort((a, b) => b.depCount - a.depCount).slice(0, 15);
            if (fileNodes.length > 0 && depsEl) {
                depsEl.classList.remove('hidden');
                const depGraph = document.getElementById('arch-dep-graph');
                if (depGraph) {
                    depGraph.innerHTML = fileNodes.map((n) => `
            <div class="arch-dep-item">
              <span class="dep-from">${n.name}</span>
              <span class="dep-arrow">←</span>
              <span class="dep-to">${n.exports.slice(0, 3).join(', ') || '(无导出)'}</span>
              <span class="dep-count">${n.depCount} 引用</span>
            </div>
          `).join('');
                }
            }
            // 代码异味
            if (arch.smells.length > 0 && smellsEl) {
                smellsEl.classList.remove('hidden');
                const smellList = document.getElementById('arch-smell-list');
                if (smellList) {
                    smellList.innerHTML = arch.smells.slice(0, 30).map((s) => `
            <div class="arch-smell-item">
              <span class="arch-smell-icon ${s.severity}">${s.severity === 'error' ? '🔴' : '🟡'}</span>
              <div>
                <div class="arch-smell-text">${s.message}</div>
                <div class="arch-smell-file">${s.file}:${s.line}</div>
              </div>
            </div>
          `).join('');
                }
            }
        }
        catch (err) {
            overview.innerHTML = `<div class="arch-empty">分析失败: ${err.message}</div>`;
        }
    }
    document.getElementById('btn-arch-refresh')?.addEventListener('click', refreshArchPanel);
    // 上下文菜单
    document.addEventListener('click', hideContextMenu);
    document.querySelectorAll('.ctx-item').forEach(item => {
        item.addEventListener('click', () => {
            handleContextAction(item.dataset.action || '');
        });
    });
    // ── 附件按钮 ──
    document.getElementById('btn-attach')?.addEventListener('click', openAttachDialog);
    // ── 拖拽上传 ──
    const chatArea = document.getElementById('tab-chat');
    chatArea.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
    chatArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const files = e.dataTransfer?.files;
        if (!files)
            return;
        for (let i = 0; i < files.length; i++) {
            const f = files[i];
            if (!f.path)
                continue; // 跳过无路径的文件
            const ext = f.name.toLowerCase().slice(f.name.lastIndexOf('.'));
            const isImg = IMG_EXTS.has(ext);
            const maxSize = isImg ? MAX_IMG_SIZE : MAX_FILE_SIZE;
            if (f.size > maxSize) {
                showToast(`文件 "${f.name}" 超过限制`, 'warn');
                continue;
            }
            const meta = {
                id: crypto.randomUUID(), name: f.name, path: f.path,
                size: f.size, type: isImg ? 'image' : 'file',
                mime: isImg ? 'image/' + ext.slice(1) : 'text/plain',
            };
            if (isImg) {
                try {
                    meta.dataUrl = await window.api.readFileAsDataURL(f.path);
                }
                catch (_) { }
            }
            attachments.push(meta);
        }
        renderAttachmentBar();
    });
    // ── 终端切换按钮 ──
    document.getElementById('status-panel-toggle')?.addEventListener('click', toggleTerminal);
    // ── 模型快速切换 ──
    document.getElementById('quick-model-select')?.addEventListener('change', onQuickModelChange);
    // ═══ v1.2 新交互 ═══
    // ── Activity Bar ──
    document.querySelectorAll('.activity-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (view === 'explorer') {
                document.getElementById('sidebar').style.display = '';
                showToast('资源管理器', 'info');
            }
            else if (view === 'search') {
                openSearchPanel();
            }
            else if (view === 'settings') {
                switchToSettingsTab();
            }
        });
    });
    // ── Panel 标签切换 ──
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const panelName = tab.dataset.panel;
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const content = document.getElementById(`panel-${panelName}`);
            if (content) {
                content.classList.add('active');
                if (panelName === 'terminal') {
                    setTimeout(() => fitActiveTerminal(), 50);
                }
            }
        });
    });
    // ── Panel 关闭按钮 ──
    document.getElementById('btn-panel-close')?.addEventListener('click', toggleTerminal);
    // ── Panel 拖拽调整器 ──
    let panelResizeY = 0;
    let panelStartHeight = 0;
    const panelResizer = document.getElementById('panel-resizer');
    const panelArea = document.getElementById('panel-area');
    panelResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        panelResizeY = e.clientY;
        panelStartHeight = panelArea.offsetHeight;
        panelResizer.classList.add('dragging');
        const onMouseMove = (ev) => {
            const delta = panelResizeY - ev.clientY;
            const newHeight = Math.max(80, Math.min(500, panelStartHeight + delta));
            panelArea.style.height = newHeight + 'px';
            editor?.layout();
            fitActiveTerminal();
        };
        const onMouseUp = () => {
            panelResizer.classList.remove('dragging');
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });
    // ── AI 面板:新建对话 ──
    document.getElementById('btn-new-chat')?.addEventListener('click', () => {
        const welcome = document.getElementById('ai-welcome');
        if (welcome)
            welcome.style.display = '';
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        createSession();
        switchSession(state.currentSessionId);
        // 切回聊天视图
        document.getElementById('chat-list-view').classList.add('hidden');
        document.getElementById('chat-content-view').classList.remove('hidden');
        showToast('新对话已创建', 'success');
    });
    // ── AI 面板:对话历史 ──
    document.getElementById('btn-chat-history')?.addEventListener('click', () => {
        const listView = document.getElementById('chat-list-view');
        const contentView = document.getElementById('chat-content-view');
        listView.classList.toggle('hidden');
        contentView.classList.toggle('hidden');
        renderChatList();
    });
    document.getElementById('btn-back-to-chat')?.addEventListener('click', () => {
        document.getElementById('chat-list-view').classList.add('hidden');
        document.getElementById('chat-content-view').classList.remove('hidden');
    });
    // ── AI 欢迎页提示词芯片 ──
    document.querySelectorAll('.ai-prompt-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const prompt = chip.dataset.prompt;
            if (prompt) {
                const input = document.getElementById('chat-input');
                input.value = prompt;
                input.focus();
            }
        });
    });
    // ── Header 模型选择器 ──
    document.getElementById('model-select-header')?.addEventListener('change', (e) => {
        const model = e.target.value;
        if (model) {
            state.config.model = model;
            document.getElementById('chat-footer-model').textContent = model;
            // 同步更新旧的选择器
            const quickSelect = document.getElementById('quick-model-select');
            if (quickSelect)
                quickSelect.value = model;
        }
    });
    // ── 标签页拖拽排序 ──
    document.getElementById('editor-tabs')?.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedTab)
            return;
        const tabs = document.getElementById('editor-tabs');
        const tab = e.target.closest('.tab-item');
        if (tab && tab !== draggedTab) {
            const rect = tab.getBoundingClientRect();
            const isAfter = e.clientX > rect.left + rect.width / 2;
            if (isAfter) {
                tab.after(draggedTab);
            }
            else {
                tab.before(draggedTab);
            }
        }
    });
    document.getElementById('editor-tabs')?.addEventListener('drop', () => {
        if (draggedTab) {
            draggedTab.classList.remove('dragging');
            draggedTab.draggable = false;
            draggedTab = null;
            // 同步 openFiles 数组顺序
            syncOpenFilesOrder();
        }
    });
    // ── 输出通道选择 ──
    document.getElementById('output-channel')?.addEventListener('change', (e) => {
        const channel = e.target.value;
        const output = document.getElementById('output-content');
        output.textContent = `等待 ${channel === 'build' ? '构建' : channel === 'ai' ? 'AI 执行' : '主进程'} 输出...`;
    });
    document.getElementById('btn-clear-output')?.addEventListener('click', () => {
        document.getElementById('output-content').textContent = '';
    });
}
async function openProjectDialog() {
    const path = await window.api.openProject();
    if (path) {
        state.projectPath = path;
        await loadFileTree(path);
        loadSessionsFromDisk();
        // 🔀 更新 Git 分支状态栏
        try {
            const gitResult = await window.api.getGitBranch(path);
            const gitEl = document.getElementById('status-git');
            if (gitResult && gitResult.success && gitEl) {
                gitEl.textContent = '🔀 ' + gitResult.branch;
                gitEl.style.display = '';
            }
            else if (gitEl) {
                gitEl.style.display = 'none';
            }
        }
        catch (_) { /* 非 Git 项目 */ }
        // 👁 启动文件监听
        window.api.watchProject(path, true);
        window.api.onFileChanged(() => {
            if (state.projectPath)
                loadFileTree(state.projectPath);
        });
        // 📋 加载 AI 行为规则(CLAUDE.md)
        try {
            const rules = await window.api.getProjectRules(path);
            window.api.setProjectRules(rules);
        }
        catch (_) { /* 无规则文件,使用内置默认 */ }
        // ⏯ 检查断点续做
        try {
            const session = await window.api.getTaskSession(path);
            if (session && session.tasksJson) {
                const tasks = JSON.parse(session.tasksJson);
                if (Array.isArray(tasks) && tasks.length > 0) {
                    const pending = tasks.filter((t) => t.status !== 'done');
                    if (pending.length > 0) {
                        addChatMessage('system', '⏯ 检测到 ' + pending.length + ' 个未完成的任务(上次中断于 ' + new Date(session.updatedAt).toLocaleString() + '),输入"继续"以恢复。');
                        state.pendingTasks = tasks;
                    }
                }
            }
        }
        catch (_) { /* 无会话 */ }
        // P0: 初始化上下文瘦身 + 自愈引擎
        initP0ProjectServices(path);
    }
}
async function newFileDialog() {
    if (!state.projectPath) {
        alert('请先打开项目 (Ctrl+O)');
        return;
    }
    const name = prompt('文件名:');
    if (!name)
        return;
    const filePath = `${state.projectPath}/${name}`;
    try {
        await window.api.writeFile(filePath, '');
        await loadFileTree(state.projectPath);
        openFile(filePath, name);
    }
    catch (err) {
        alert(`创建失败: ${err.message}`);
    }
}
async function saveCurrentFile() {
    if (state.activeFileIndex < 0)
        return;
    const file = state.openFiles[state.activeFileIndex];
    try {
        await window.api.writeFile(file.path, file.content);
        file.dirty = false;
        const dirtyEl = document.getElementById('status-dirty');
        if (dirtyEl)
            dirtyEl.style.display = 'none';
        renderEditorTabs();
    }
    catch (err) {
        alert(`保存失败: ${err.message}`);
    }
}
const commandRegistry = [
    { id: 'new-file', label: '新建文件', category: '文件', shortcut: 'Ctrl+N', action: () => newFileDialog() },
    { id: 'new-folder', label: '新建文件夹', category: '文件', shortcut: 'Ctrl+Shift+N', action: () => { /* TODO */ showToast('请使用文件树操作', 'info'); } },
    { id: 'save', label: '保存文件', category: '文件', shortcut: 'Ctrl+S', action: () => saveCurrentFile() },
    { id: 'open-project', label: '打开项目', category: '文件', shortcut: 'Ctrl+O', action: () => openProjectDialog() },
    { id: 'search-global', label: '全局搜索', category: '搜索', shortcut: 'Ctrl+Shift+F', action: () => openSearchPanel() },
    { id: 'goto-line', label: '跳转到行...', category: '搜索', shortcut: 'Ctrl+G', action: () => { const n = prompt('行号:'); if (n)
            editor?.revealLine(parseInt(n)); } },
    { id: 'ai-generate', label: 'AI 生成代码', category: 'AI', shortcut: 'Ctrl+Shift+I', action: () => editor?.getAction('tcide-ai-insert')?.run() },
    { id: 'ai-explain', label: 'AI 解释代码', category: 'AI', shortcut: 'Ctrl+Shift+E', action: () => editor?.getAction('tcide-ai-explain')?.run() },
    { id: 'ai-refactor', label: 'AI 重构代码', category: 'AI', action: () => editor?.getAction('tcide-ai-refactor')?.run() },
    { id: 'ai-tests', label: 'AI 生成测试', category: 'AI', action: () => editor?.getAction('tcide-ai-tests')?.run() },
    { id: 'ai-fix', label: 'AI 修复 Bug', category: 'AI', action: () => editor?.getAction('tcide-ai-fix')?.run() },
    { id: 'ai-docs', label: 'AI 生成文档注释', category: 'AI', action: () => editor?.getAction('tcide-ai-docs')?.run() },
    { id: 'ai-builder', label: 'Builder 架构模式', category: 'AI', shortcut: 'Ctrl+Shift+B', action: () => { document.getElementById('chat-input')?.focus(); showToast('Builder 模式激活', 'info'); } },
    { id: 'open-terminal', label: '打开终端', category: '系统', shortcut: 'Ctrl+Shift+T', action: () => window.api.openTerminal(state.projectPath || undefined) },
    { id: 'open-browser', label: '打开浏览器测试', category: '系统', shortcut: 'Ctrl+Shift+U', action: () => { const url = prompt('输入 URL (默认 localhost:3000):', 'http://localhost:3000'); if (url)
            window.api.openBrowser(url); } },
    { id: 'open-folder', label: '在文件管理器打开', category: '系统', shortcut: 'Ctrl+Shift+O', action: () => window.api.openFolder(state.projectPath || undefined) },
    { id: 'open-system-file', label: '用默认程序打开当前文件', category: '系统', action: () => { const f = state.openFiles[state.activeFileIndex]; if (f)
            window.api.openSystemFile(f.path); } },
    { id: 'ai-coder', label: 'Coder 编程模式', category: 'AI', shortcut: 'Ctrl+Shift+C', action: () => { document.getElementById('chat-input')?.focus(); showToast('Coder 模式激活', 'info'); } },
    { id: 'task-loop', label: '/task 任务循环', category: 'AI', action: () => { document.getElementById('chat-input').value = '/task '; document.getElementById('chat-input')?.focus(); } },
    { id: 'toggle-ai', label: '切换 AI 面板', category: '视图', shortcut: 'Ctrl+\\', action: () => { document.getElementById('ai-panel').classList.toggle('hidden'); editor?.layout(); } },
    { id: 'zen-mode', label: 'Zen 专注模式', category: '视图', shortcut: 'Ctrl+Shift+M', action: () => { document.body.classList.toggle('zen-mode'); editor?.layout(); updateZenStatusBar(); } },
    { id: 'toggle-terminal', label: '切换终端', category: '视图', shortcut: 'Ctrl+`', action: () => toggleTerminal() },
    { id: 'open-settings', label: '打开设置', category: '设置', shortcut: 'Ctrl+,', action: () => switchToSettingsTab() },
    { id: 'show-help', label: '快捷键速查', category: '帮助', action: () => document.getElementById('help-dialog')?.classList.remove('hidden') },
    { id: 'show-about', label: '关于 TCIDE', category: '帮助', action: () => document.getElementById('about-dialog')?.classList.toggle('hidden') },
    { id: 'abort-task', label: '终止 AI 任务', category: 'AI', shortcut: 'Esc', action: () => { stopStreaming(); window.api.abortTask?.(); } },
    { id: 'show-problems', label: '查看代码问题', category: '视图', shortcut: 'Ctrl+Shift+P', action: () => { document.querySelector('.activity-btn[data-view="problems"]')?.click(); } },
    { id: 'show-debug', label: '调试面板', category: '视图', shortcut: 'Ctrl+Shift+D', action: () => { document.querySelector('.activity-btn[data-view="debug"]')?.click(); } },
    { id: 'format-file', label: '格式化当前文件', category: '编辑', shortcut: 'Shift+Alt+F', action: async () => { const f = state.openFiles[state.activeFileIndex]; if (f && state.projectPath) { const r = await window.api.formatFile(f.path, state.projectPath); if (r.success) { f.content = r.formatted; if (editor) editor.setValue(r.formatted); showToast('已格式化', 'success'); } else { showToast('格式化失败: ' + (r.error || 'Prettier 未安装'), 'warning'); } } } },
    { id: 'fix-all-lint', label: '一键修复 Lint 问题', category: '编辑', action: async () => { if (state.projectPath) { const results = await window.api.lintFixAll(state.projectPath); const fixed = results.filter(r => r.fixed).length; showToast(`已修复 ${fixed}/${results.length} 个文件`, fixed === results.length ? 'success' : 'warning'); } } },
    { id: 'batch-search', label: '批量搜索替换', category: '编辑', shortcut: 'Ctrl+Shift+H', action: () => { openSearchPanel(); document.getElementById('search-replace')?.classList.remove('hidden'); } },
];
// ═══ 快捷键编辑器 ═══
let customShortcuts = {};
try { customShortcuts = JSON.parse(localStorage.getItem('tcide-shortcuts') || '{}'); } catch {}
function renderShortcutsEditor() {
    const tbody = document.getElementById('shortcuts-tbody');
    if (!tbody) return;
    const categories = [...new Set(commandRegistry.map(c => c.category))];
    let html = '';
    categories.forEach(cat => {
        const cmds = commandRegistry.filter(c => c.category === cat);
        html += `<tr><td colspan="3" style="color:var(--tc-orange);font-size:11px;font-weight:600;padding:6px 0 2px 0">📂 ${cat}</td></tr>`;
        cmds.forEach(cmd => {
            const sid = customShortcuts[cmd.id] || cmd.shortcut || '';
            html += `<tr>
        <td style="padding:4px 8px;font-size:12px">${cmd.label}</td>
        <td style="padding:4px 8px"><kbd style="background:var(--bg-secondary);padding:2px 6px;border-radius:3px;font-size:11px">${sid || '—'}</kbd></td>
        <td style="padding:4px 8px"><button class="edit-shortcut-btn" data-cmd-id="${cmd.id}" style="background:transparent;border:1px solid var(--border-subtle);border-radius:4px;color:var(--text-secondary);cursor:pointer;font-size:11px;padding:2px 8px">✏️ 编辑</button></td>
      </tr>`;
        });
    });
    tbody.innerHTML = html;
    // Bind edit buttons
    tbody.querySelectorAll('.edit-shortcut-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const cmdId = btn.dataset.cmdId;
            const cmd = commandRegistry.find(c => c.id === cmdId);
            if (!cmd) return;
            const current = customShortcuts[cmdId] || cmd.shortcut || '';
            const newKey = prompt(`${cmd.label}\n当前快捷键: ${current || '无'}\n输入新快捷键 (如 Ctrl+Shift+K):`, current);
            if (newKey === null) return; // cancelled
            if (newKey === '') {
                delete customShortcuts[cmdId];
                showToast(`已清除 ${cmd.label} 快捷键`, 'info');
            } else {
                customShortcuts[cmdId] = newKey;
                showToast(`${cmd.label} → ${newKey}`, 'success');
            }
            localStorage.setItem('tcide-shortcuts', JSON.stringify(customShortcuts));
            renderShortcutsEditor();
        });
    });
}
document.getElementById('btn-shortcuts-reset')?.addEventListener('click', () => {
    if (confirm('确定恢复所有快捷键为默认值？')) {
        customShortcuts = {};
        localStorage.removeItem('tcide-shortcuts');
        renderShortcutsEditor();
        showToast('已恢复默认快捷键', 'info');
    }
});
document.getElementById('btn-shortcuts-editor')?.addEventListener('click', () => {
    renderShortcutsEditor();
    document.getElementById('shortcuts-modal')?.classList.remove('hidden');
});
document.querySelector('#shortcuts-modal .modal-close')?.addEventListener('click', () => {
    document.getElementById('shortcuts-modal')?.classList.add('hidden');
});
let cmdPaletteSelectedIdx = 0;
// ═══ 自诊断引擎 ═══
function runSelfDiagnostic(file) {
    if (!file || !file.content) return [];
    const issues = [];
    const lines = file.content.split('\n');
    const lang = file.language || '';
    // 通用规则
    lines.forEach((line, i) => {
        const ln = i + 1;
        if (line.includes('console.log') && !line.includes('//'))
            issues.push({ file: file.name, line: ln, severity: 'warning', message: 'console.log 残留', rule: 'no-console-log' });
        if (line.includes('debugger') && !line.includes('//'))
            issues.push({ file: file.name, line: ln, severity: 'error', message: 'debugger 语句残留', rule: 'no-debugger' });
        if (line.match(/:\s*any\b/) && (lang === 'typescript' || lang === 'ts'))
            issues.push({ file: file.name, line: ln, severity: 'warning', message: '使用了 any 类型', rule: 'no-explicit-any' });
        if (line.match(/TODO|FIXME|HACK/) && !line.includes('//'))
            issues.push({ file: file.name, line: ln, severity: 'info', message: `待办标记: ${line.match(/TODO|FIXME|HACK/)[0]}`, rule: 'todo-comment' });
        if (line.length > 200)
            issues.push({ file: file.name, line: ln, severity: 'info', message: `行过长 (${line.length} 字符)`, rule: 'max-line-length' });
        if (line.match(/var\s+\w+/) && (lang === 'typescript' || lang === 'javascript' || lang === 'ts' || lang === 'js'))
            issues.push({ file: file.name, line: ln, severity: 'info', message: '建议使用 const/let 替代 var', rule: 'no-var' });
    });
    // 重复代码检测（简易）
    const lineMap = new Map();
    lines.forEach(line => {
        const trimmed = line.trim();
        if (trimmed.length > 10 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
            lineMap.set(trimmed, (lineMap.get(trimmed) || 0) + 1);
        }
    });
    lineMap.forEach((count, text) => {
        if (count >= 3) {
            issues.push({ file: file.name, line: lines.findIndex(l => l.includes(text)) + 1, severity: 'warning', message: `疑似重复代码 (出现 ${count} 次): ${text.slice(0, 60)}${text.length > 60 ? '...' : ''}`, rule: 'duplicate-code' });
        }
    });
    return issues;
}
function renderDiagnosticResults(issues) {
    const panel = document.getElementById('problems-list');
    const empty = document.getElementById('problems-empty');
    if (!panel || !empty) return;
    if (issues.length === 0) {
        empty.classList.remove('hidden');
        panel.classList.add('hidden');
        empty.innerHTML = '<p>✅ 未检测到代码问题</p>';
        return;
    }
    empty.classList.add('hidden');
    panel.classList.remove('hidden');
    const severityOrder = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
    const icons = { error: '❌', warning: '⚠️', info: 'ℹ️' };
    panel.innerHTML = issues.slice(0, 50).map(i => `<div class="problem-item problem-${i.severity}" style="padding:4px 8px;font-size:11px;border-bottom:1px solid var(--border-subtle)">
    <span style="color:var(--text-secondary)">${i.file}:${i.line}</span>
    <span style="margin-left:6px">${icons[i.severity] || '•'} ${i.message}</span>
  </div>`).join('');
    if (issues.length > 50) panel.innerHTML += `<div style="padding:4px 8px;font-size:11px;color:var(--text-secondary)">... 还有 ${issues.length - 50} 个问题</div>`;
    // Update badge
    const badge = document.getElementById('problems-badge');
    if (badge) { badge.textContent = issues.length; badge.classList.remove('hidden'); }
}
let cmdPaletteFiltered = [];
function openCommandPalette() {
    document.getElementById('command-palette').classList.remove('hidden');
    const input = document.getElementById('cmd-palette-input');
    input.value = '';
    cmdPaletteSelectedIdx = 0;
    cmdPaletteFiltered = [...commandRegistry];
    renderCommandPaletteResults();
    setTimeout(() => input.focus(), 50);
}
function closeCommandPalette() {
    document.getElementById('command-palette').classList.add('hidden');
}
function renderCommandPaletteResults() {
    const container = document.getElementById('cmd-palette-results');
    const groups = new Map();
    for (const cmd of cmdPaletteFiltered) {
        const list = groups.get(cmd.category) || [];
        list.push(cmd);
        groups.set(cmd.category, list);
    }
    let html = '';
    let idx = 0;
    for (const [cat, cmds] of groups) {
        html += `<div class="cmd-palette-category">${cat}</div>`;
        for (const cmd of cmds) {
            html += `<div class="cmd-palette-item${idx === cmdPaletteSelectedIdx ? ' selected' : ''}" data-idx="${idx}">
        <span class="cmd-label">${cmd.label}</span>
        ${cmd.shortcut ? `<span class="cmd-shortcut">${cmd.shortcut}</span>` : ''}
      </div>`;
            idx++;
        }
    }
    if (cmdPaletteFiltered.length === 0) {
        html = '<div class="cmd-palette-category">无匹配命令</div>';
    }
    container.innerHTML = html;
    // 绑定点击
    container.querySelectorAll('.cmd-palette-item').forEach(item => {
        item.addEventListener('click', () => {
            const i = parseInt(item.dataset.idx);
            if (i >= 0 && i < cmdPaletteFiltered.length) {
                cmdPaletteFiltered[i].action();
                closeCommandPalette();
            }
        });
    });
}
function filterCommandPalette(query) {
    const q = query.toLowerCase();
    cmdPaletteFiltered = commandRegistry.filter(c => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c.shortcut?.toLowerCase().includes(q)));
    cmdPaletteSelectedIdx = 0;
    renderCommandPaletteResults();
}
function initCommandPalette() {
    document.getElementById('cmd-palette-input')?.addEventListener('input', (e) => {
        filterCommandPalette(e.target.value);
    });
    document.getElementById('cmd-palette-input')?.addEventListener('keydown', (e) => {
        const ke = e;
        if (ke.key === 'Escape') {
            closeCommandPalette();
            return;
        }
        if (ke.key === 'Enter') {
            if (cmdPaletteFiltered[cmdPaletteSelectedIdx]) {
                cmdPaletteFiltered[cmdPaletteSelectedIdx].action();
            }
            closeCommandPalette();
            return;
        }
        if (ke.key === 'ArrowDown') {
            e.preventDefault();
            cmdPaletteSelectedIdx = Math.min(cmdPaletteSelectedIdx + 1, cmdPaletteFiltered.length - 1);
            renderCommandPaletteResults();
        }
        if (ke.key === 'ArrowUp') {
            e.preventDefault();
            cmdPaletteSelectedIdx = Math.max(cmdPaletteSelectedIdx - 1, 0);
            renderCommandPaletteResults();
        }
    });
    document.getElementById('cmd-palette-backdrop')?.addEventListener('click', closeCommandPalette);
}
// ─────────────────────────────────────────
// 欢迎页
// ─────────────────────────────────────────
let recentProjects = [];
async function loadRecentProjects() {
    try {
        recentProjects = await window.api.getRecentProjects?.() || [];
    }
    catch {
        recentProjects = [];
    }
}
function renderWelcomePage() {
    const welcome = document.getElementById('welcome-page');
    const recentList = document.getElementById('welcome-recent-list');
    const recentSection = document.getElementById('welcome-recent');
    if (recentProjects.length > 0) {
        recentSection.classList.remove('hidden');
        recentList.innerHTML = recentProjects.slice(0, 10).map(p => {
            const time = formatRelativeTime(p.lastOpened);
            return `<div class="welcome-recent-item" data-path="${p.path}">
        <span class="recent-name">📁 ${p.name}</span>
        <span class="recent-path" title="${p.path}">${p.path}</span>
        <span class="recent-time">${time}</span>
      </div>`;
        }).join('');
        recentList.querySelectorAll('.welcome-recent-item').forEach(item => {
            item.addEventListener('click', async () => {
                const p = item.dataset.path;
                state.projectPath = p;
                await loadFileTree(p);
                welcome.classList.add('hidden');
                loadSessionsFromDisk();
                showToast(`已打开 ${p.split(/[\\/]/).pop()}`, 'success');
            });
        });
    }
    else {
        recentSection.classList.add('hidden');
    }
}
function formatRelativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 3600000)
        return '刚刚';
    if (diff < 86400000)
        return `${Math.floor(diff / 3600000)} 小时前`;
    if (diff < 604800000)
        return `${Math.floor(diff / 86400000)} 天前`;
    return new Date(ts).toLocaleDateString('zh-CN');
}
function showWelcomePage() {
    document.getElementById('welcome-page').classList.remove('hidden');
    document.getElementById('editor-tabs').style.display = 'none';
    document.getElementById('monaco-container').style.display = 'none';
    renderWelcomePage();
}
function hideWelcomePage() {
    document.getElementById('welcome-page').classList.add('hidden');
    document.getElementById('editor-tabs').style.display = '';
    document.getElementById('monaco-container').style.display = '';
}
// ─────────────────────────────────────────
// 贪吃蛇 Demo 项目
// ─────────────────────────────────────────
const SNAKE_GAME_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🐍 贪吃蛇 · 虎猫 TCIDE</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: #1a1a2e; font-family: 'Segoe UI', system-ui, sans-serif; color: #e0e0e0; }
.header { text-align: center; margin-bottom: 12px; }
.header h1 { font-size: 26px; color: #ff8c00; }
.header p { font-size: 12px; color: #888; margin-top: 4px; }
canvas { border: 2px solid #ff8c00; border-radius: 8px; background: #16213e; box-shadow: 0 0 20px rgba(255,140,0,0.2); }
.score-board { display: flex; justify-content: space-between; width: 420px; margin-top: 12px; font-size: 15px; }
.score-board span { color: #ff8c00; font-weight: 700; }
.controls { margin-top: 12px; display: flex; gap: 8px; }
.btn { padding: 8px 18px; border: 1px solid #ff8c00; border-radius: 6px; background: transparent; color: #ff8c00; cursor: pointer; font-size: 13px; transition: all 0.2s; }
.btn:hover { background: #ff8c00; color: #1a1a2e; }
.btn-primary { background: #ff8c00; color: #1a1a2e; font-weight: 700; }
.game-over-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; display: none; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.75); border-radius: 8px; }
.game-over-overlay.show { display: flex; }
.game-over-overlay h2 { color: #ff4444; font-size: 28px; margin-bottom: 10px; }
.game-over-overlay p { color: #ccc; margin-bottom: 14px; }
.game-container { position: relative; }
.hint { margin-top: 10px; font-size: 11px; color: #555; }
</style>
</head>
<body>
<div class="header"><h1>🐍 贪吃蛇</h1><p>方向键控制 · P 暂停 · 空格开始</p></div>
<div class="game-container">
<canvas id="canvas" width="400" height="400"></canvas>
<div class="game-over-overlay" id="gameOver"><h2>游戏结束</h2><p>得分：<span id="finalScore">0</span></p><button class="btn btn-primary" onclick="startGame()">重新开始</button></div>
</div>
<div class="score-board"><div>🍎 得分：<span id="score">0</span></div><div>🏆 最高：<span id="highScore">0</span></div><div>⚡ 速度：<span id="speed">1</span>x</div></div>
<div class="controls"><button class="btn btn-primary" onclick="startGame()">▶ 开始</button><button class="btn" onclick="togglePause()">⏯ 暂停</button><button class="btn" onclick="resetHighScore()">🔄 重置</button></div>
<div class="hint">🚀 由虎猫 TCIDE AI 生成 · 右键预览查看效果</div>
<script>
const canvas=document.getElementById('canvas'),ctx=canvas.getContext('2d'),GRID=20,COLS=canvas.width/GRID,ROWS=canvas.height/GRID;
let snake,food,direction,nextDirection,score,highScore,gameLoop,speed,running,paused;
function init(){highScore=parseInt(localStorage.getItem('snake-hs')||'0');document.getElementById('highScore').textContent=highScore;}
function startGame(){snake=[{x:10,y:10},{x:9,y:10},{x:8,y:10}];direction={x:1,y:0};nextDirection={x:1,y:0};score=0;speed=120;running=true;paused=false;document.getElementById('score').textContent='0';document.getElementById('speed').textContent='1';document.getElementById('gameOver').classList.remove('show');spawnFood();if(gameLoop)clearInterval(gameLoop);gameLoop=setInterval(gameTick,speed);}
function spawnFood(){do{food={x:Math.floor(Math.random()*COLS),y:Math.floor(Math.random()*ROWS)};}while(snake.some(s=>s.x===food.x&&s.y===food.y));}
function gameTick(){if(!running||paused)return;direction={...nextDirection};const head={x:snake[0].x+direction.x,y:snake[0].y+direction.y};if(head.x<0||head.x>=COLS||head.y<0||head.y>=ROWS||snake.some(s=>s.x===head.x&&s.y===head.y))return endGame();snake.unshift(head);if(head.x===food.x&&head.y===food.y){score+=10;document.getElementById('score').textContent=score;spawnFood();if(score%50===0){speed=Math.max(40,speed-15);clearInterval(gameLoop);gameLoop=setInterval(gameTick,speed);document.getElementById('speed').textContent=Math.round((120/speed)*10)/10;}}else{snake.pop();}draw();}
function draw(){ctx.fillStyle='#16213e';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle='#1a2332';ctx.lineWidth=0.5;for(let x=0;x<canvas.width;x+=GRID){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,canvas.height);ctx.stroke();}for(let y=0;y<canvas.height;y+=GRID){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(canvas.width,y);ctx.stroke();}snake.forEach((s,i)=>{ctx.fillStyle=i===0?'#ff8c00':'hsl('+(120+i*5)+',70%,50%)';ctx.fillRect(s.x*GRID+1,s.y*GRID+1,GRID-2,GRID-2);});ctx.fillStyle='#ff4444';ctx.beginPath();ctx.arc(food.x*GRID+GRID/2,food.y*GRID+GRID/2,GRID/2-1,0,Math.PI*2);ctx.fill();}
function endGame(){running=false;clearInterval(gameLoop);if(score>highScore){highScore=score;localStorage.setItem('snake-hs',highScore.toString());document.getElementById('highScore').textContent=highScore;}document.getElementById('finalScore').textContent=score.toString();document.getElementById('gameOver').classList.add('show');draw();}
function togglePause(){if(!running)return;paused=!paused;}
function resetHighScore(){highScore=0;localStorage.removeItem('snake-hs');document.getElementById('highScore').textContent='0';}
document.addEventListener('keydown',e=>{if(!running)return;const km={ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1},ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},w:{x:0,y:-1},W:{x:0,y:-1},s:{x:0,y:1},S:{x:0,y:1},a:{x:-1,y:0},A:{x:-1,y:0},d:{x:1,y:0},D:{x:1,y:0}};const nd=km[e.key];if(nd&&!(nd.x===-direction.x&&nd.y===-direction.y))nextDirection=nd;if(e.key==='p'||e.key==='P')togglePause();if(e.key===' '){e.preventDefault();startGame();}});
init();draw();
</script>
</body>
</html>`;
function createSnakeDemo() {
    if (!editor)
        return;
    const model = editor.getModel();
    if (!model)
        return;
    model.setValue(SNAKE_GAME_HTML);
    monaco.editor.setModelLanguage(model, 'html');
    // 同时更新 openFiles 中的条目
    const existingIdx = state.openFiles.findIndex(f => f.path === 'virtual://snake.html');
    if (existingIdx >= 0) {
        state.openFiles[existingIdx].content = SNAKE_GAME_HTML;
        state.activeFileIndex = existingIdx;
    }
    else {
        state.openFiles.push({ name: 'snake.html', path: 'virtual://snake.html', content: SNAKE_GAME_HTML, language: 'html', dirty: false, isAI: true });
        state.activeFileIndex = state.openFiles.length - 1;
    }
    switchToFile(state.activeFileIndex);
    renderTabs();
    hideWelcomePage();
    showToast('🐍 贪吃蛇已加载！右键选择「👁 预览」查看效果', 'success');
}
// ─────────────────────────────────────────
// 首次启动欢迎 README
// ─────────────────────────────────────────
const FIRST_LAUNCH_README = `# 🐅 欢迎使用虎猫 TCIDE v1.1.0

**个人专属超级 AI 编程 IDE**

---

## 🚀 快速开始

### 1️⃣ 配置 AI 模型
点击右上角 ⚙️ **设置** → 选择服务商 → 填入 API Key

支持：**DeepSeek** | **火山方舟** | **Ollama** | **自定义 OpenAI**

### 2️⃣ 打开项目文件夹
点击 **📂 打开项目** 或拖拽文件夹到界面

TCIDE 会自动索引项目文件，理解项目结构

### 3️⃣ 开始对话
在右侧 AI 面板输入需求，AI 会帮你：
- \`/task 需求描述\` — 自动拆分任务 → 编码 → 编译
- 选中代码 → 右键 AI 菜单 → 解释/修复/重构
- 自由对话获取编程建议

---

## 🐍 试试贪吃蛇 Demo

点击左侧 **🐍 贪吃蛇 Demo** 按钮，一键打开一个完整的 HTML5 贪吃蛇游戏！

在编辑区右键 → **👁 预览** 可以在侧边栏玩游戏。

---

## ⌨️ 常用快捷键

| 快捷键 | 功能 |
|--------|------|
| \`Ctrl+P\` | 快速打开文件 |
| \`Ctrl+W\` | 关闭当前文件 |
| \`Ctrl+Tab\` | 切换文件标签 |
| \`Ctrl+J\` | 打开底部面板 |
| \`Ctrl+,\` | 打开设置 |
| \`Ctrl+Shift+I\` | AI 面板 |
| \`Ctrl+N\` | 新建文件 |

---

## 🎨 主题切换

点击左下角 **☀️** 按钮在 🐯 老虎（暗色）和 🐅 白虎（亮色）之间切换。

---

## 📖 更多

- **版本记录**：设置 → 📋 版本记录
- **键盘快捷键**：按 \`?\` 查看帮助
- **GitHub**：https://github.com/Guanist/TCIDE

> 💡 内置 Builder + Coder 双 Agent 引擎，用对话驱动完整项目开发。
> 试试在 AI 面板说：「帮我做一个 ToDo 应用」！
`;
function showFirstLaunchReadme() {
    // 只在没有项目和文件打开时显示
    if (state.projectPath)
        return;
    if (!editor)
        return;
    const model = editor.getModel();
    if (!model)
        return;
    if (model.getValue().trim() !== '')
        return; // 编辑器已有内容，不覆盖
    model.setValue(FIRST_LAUNCH_README);
    monaco.editor.setModelLanguage(model, 'markdown');
    state.openFiles = [{
            name: 'Welcome.md',
            path: 'virtual://welcome.md',
            content: FIRST_LAUNCH_README,
            language: 'markdown',
            dirty: false,
            isAI: true,
        }];
    state.activeFileIndex = 0;
    renderTabs();
}
function initWelcomePage() {
    document.getElementById('welcome-open-project')?.addEventListener('click', () => openProjectDialog());
    document.getElementById('welcome-new-project')?.addEventListener('click', () => {
        openProjectDialog().then(() => {
            if (state.projectPath)
                newFileDialog();
        });
    });
    document.getElementById('welcome-snake-demo')?.addEventListener('click', () => {
        createSnakeDemo();
    });
    loadRecentProjects().then(() => renderWelcomePage());
    if (!state.projectPath)
        showWelcomePage();
}
function parseOutlineSymbols(code, language) {
    const lines = code.split('\n');
    const symbols = [];
    const lang = language.toLowerCase();
    if (['kotlin', 'java', 'typescript', 'javascript', 'go', 'rust', 'python'].includes(lang)) {
        // 通用:匹配 fun/function/def/func/fn 定义
        const funcRegex = /^\s*(?:fun\s+|function\s+|def\s+|func\s+|fn\s+|public\s+(?:fun\s+|function\s+)?|private\s+(?:fun\s+|function\s+)?|protected\s+(?:fun\s+|function\s+)?|suspend\s+fun\s+)([\w]+)\s*\(/;
        const classRegex = /^\s*(?:class\s+|interface\s+|object\s+|enum\s+class\s+|data\s+class\s+|sealed\s+class\s+)([\w]+)/;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let match = classRegex.exec(line);
            if (match) {
                symbols.push({ name: match[1], kind: 'class', line: i + 1, level: 1, children: [] });
                continue;
            }
            match = funcRegex.exec(line);
            if (match) {
                const indent = line.match(/^\s*/)?.[0].length || 0;
                const level = indent > 4 ? 3 : indent > 0 ? 2 : 1;
                symbols.push({ name: match[1], kind: 'function', line: i + 1, level, children: [] });
            }
        }
    }
    // Markdown 标题
    if (lang === 'markdown') {
        const headingRegex = /^(#{1,6})\s+(.+)/;
        for (let i = 0; i < lines.length; i++) {
            const match = headingRegex.exec(lines[i]);
            if (match) {
                symbols.push({ name: match[2], kind: 'heading', line: i + 1, level: match[1].length, children: [] });
            }
        }
    }
    // JSON keys
    if (lang === 'json') {
        const keyRegex = /^\s*"([^"]+)"\s*:/;
        for (let i = 0; i < lines.length; i++) {
            const match = keyRegex.exec(lines[i]);
            if (match) {
                const indent = lines[i].match(/^\s*/)?.[0].length || 0;
                const level = Math.min(Math.floor(indent / 2) + 1, 4);
                symbols.push({ name: match[1], kind: 'property', line: i + 1, level, children: [] });
            }
        }
    }
    return symbols;
}
function renderOutline() {
    const tree = document.getElementById('outline-tree');
    const filter = document.getElementById('outline-filter').value.toLowerCase();
    if (!editor || state.activeFileIndex < 0) {
        tree.innerHTML = '<div class="outline-empty">打开文件以查看大纲</div>';
        return;
    }
    const code = editor.getValue();
    const lang = state.openFiles[state.activeFileIndex]?.language || 'plaintext';
    const symbols = parseOutlineSymbols(code, lang);
    if (symbols.length === 0) {
        tree.innerHTML = '<div class="outline-empty">未检测到符号</div>';
        return;
    }
    const filtered = filter ? symbols.filter(s => s.name.toLowerCase().includes(filter)) : symbols;
    if (filtered.length === 0) {
        tree.innerHTML = '<div class="outline-empty">无匹配符号</div>';
        return;
    }
    const icons = { class: '📦', function: 'ƒ', heading: '#', property: '•' };
    tree.innerHTML = filtered.map(s => `<div class="outline-item level-${s.level}" data-line="${s.line}">
      <span class="outline-icon">${icons[s.kind] || '·'}</span>
      <span class="outline-name">${s.name}</span>
      <span class="outline-detail">:${s.line}</span>
    </div>`).join('');
    tree.querySelectorAll('.outline-item').forEach(item => {
        item.addEventListener('click', () => {
            const line = parseInt(item.dataset.line);
            editor?.revealLineInCenter(line);
            editor?.setPosition({ lineNumber: line, column: 1 });
            editor?.focus();
        });
    });
}
function initOutline() {
    document.getElementById('outline-filter')?.addEventListener('input', renderOutline);
    // 监听编辑器内容变化,更新大纲
    editor?.onDidChangeModelContent(() => {
        if (!document.getElementById('tab-outline')?.classList.contains('hidden')) {
            renderOutline();
        }
    });
}
// ─────────────────────────────────────────
// 文件树搜索
// ─────────────────────────────────────────
function filterFileTree(query) {
    const items = document.querySelectorAll('.tree-item');
    const q = query.toLowerCase();
    let anyVisible = false;
    items.forEach(item => {
        const name = item.querySelector('.name')?.textContent?.toLowerCase() || '';
        if (!q || name.includes(q)) {
            item.style.display = '';
            anyVisible = true;
        }
        else {
            item.style.display = 'none';
        }
    });
    // 隐藏/显示折叠的子容器
    document.querySelectorAll('.tree-children').forEach(el => {
        el.style.display = q ? 'none' : '';
    });
    document.getElementById('btn-clear-search').classList.toggle('hidden', !q);
}
function initFileTreeSearch() {
    const searchInput = document.getElementById('file-tree-search');
    searchInput?.addEventListener('input', () => filterFileTree(searchInput.value));
    document.getElementById('btn-clear-search')?.addEventListener('click', () => {
        searchInput.value = '';
        filterFileTree('');
    });
}
// ─────────────────────────────────────────
// 项目搜索面板
// ─────────────────────────────────────────
function openSearchPanel() {
    document.getElementById('search-panel').classList.remove('hidden');
    document.getElementById('search-input').focus();
}
function closeSearchPanel() {
    document.getElementById('search-panel').classList.add('hidden');
}
async function executeSearch() {
    const query = document.getElementById('search-input').value;
    if (!query || !state.projectPath)
        return;
    const container = document.getElementById('search-results');
    container.innerHTML = '<div class="search-empty"><span class="loading-spinner"></span> 搜索中...</div>';
    try {
        const results = await window.api.searchInProject?.(state.projectPath, query) || [];
        if (results.length === 0) {
            container.innerHTML = '<div class="search-empty">未找到匹配结果</div>';
            return;
        }
        container.innerHTML = results.slice(0, 100).map((r) => {
            const relPath = r.file.replace(state.projectPath, '').replace(/^[\\/]/, '');
            return `<div class="search-result-item" data-file="${r.file}" data-line="${r.line}">
        <span class="search-result-file">${relPath}</span>
        <span class="search-result-line">${r.line}:</span>
        <span class="search-result-text">${r.text.slice(0, 120)}</span>
      </div>`;
        }).join('');
        container.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', async () => {
                const el = item;
                const file = el.dataset.file;
                const line = parseInt(el.dataset.line);
                const name = file.split(/[\\/]/).pop();
                await openFile(file, name);
                editor?.revealLineInCenter(line);
                editor?.setPosition({ lineNumber: line, column: 1 });
            });
        });
    }
    catch {
        container.innerHTML = '<div class="search-empty">搜索出错</div>';
    }
}
function initSearchPanel() {
    document.getElementById('search-input')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')
            executeSearch();
    });
    document.getElementById('btn-search-next')?.addEventListener('click', executeSearch);
    document.getElementById('btn-search-close')?.addEventListener('click', closeSearchPanel);
    document.getElementById('btn-toggle-replace')?.addEventListener('click', () => {
        document.getElementById('search-replace').classList.toggle('hidden');
    });
}
// ─────────────────────────────────────────
// 标签页右键菜单
// ─────────────────────────────────────────
let tabContextTargetIndex = -1;
function showTabContextMenu(e, tabIndex) {
    tabContextTargetIndex = tabIndex;
    const menu = document.getElementById('tab-context-menu');
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.classList.remove('hidden');
    e.preventDefault();
    e.stopPropagation();
}
function hideTabContextMenu() {
    document.getElementById('tab-context-menu').classList.add('hidden');
}
async function handleTabContextAction(action) {
    hideTabContextMenu();
    if (tabContextTargetIndex < 0)
        return;
    const file = state.openFiles[tabContextTargetIndex];
    if (!file)
        return;
    switch (action) {
        case 'tab-close':
            closeFile(tabContextTargetIndex);
            break;
        case 'tab-close-others':
            state.openFiles = [file];
            state.activeFileIndex = 0;
            renderEditorTabs();
            switchToFile(0);
            break;
        case 'tab-close-right':
            state.openFiles = state.openFiles.slice(0, tabContextTargetIndex + 1);
            if (state.activeFileIndex > tabContextTargetIndex)
                state.activeFileIndex = tabContextTargetIndex;
            renderEditorTabs();
            break;
        case 'tab-copy-path':
            navigator.clipboard.writeText(file.path);
            showToast('路径已复制', 'success');
            break;
        case 'tab-reveal':
            await window.api.showItemInFolder(file.path);
            break;
        case 'tab-close-all':
            state.openFiles = [];
            state.activeFileIndex = -1;
            renderEditorTabs();
            editor?.setModel(null);
            break;
        case 'tab-split-right':
            showToast('分屏编辑功能即将上线', 'info');
            break;
    }
}
function initTabContextMenu() {
    document.addEventListener('click', hideTabContextMenu);
    document.querySelectorAll('#tab-context-menu .ctx-item').forEach(item => {
        item.addEventListener('click', () => {
            handleTabContextAction(item.dataset.action || '');
        });
    });
}
// ─────────────────────────────────────────
// 面包屑导航
// ─────────────────────────────────────────
function updateBreadcrumb() {
    const bar = document.getElementById('breadcrumb-bar');
    const pathEl = document.getElementById('breadcrumb-path');
    const symbolEl = document.getElementById('breadcrumb-symbol');
    if (state.activeFileIndex < 0 || !state.projectPath) {
        bar.classList.add('hidden');
        return;
    }
    const file = state.openFiles[state.activeFileIndex];
    const relPath = file.path.replace(state.projectPath, '').replace(/^[\\/]/, '');
    const parts = relPath.split(/[\\/]/);
    pathEl.innerHTML = parts.map((p, i) => {
        if (i === parts.length - 1)
            return `<span style="color:var(--text-primary)">📄 ${p}</span>`;
        return `<span>📁 ${p}</span><span class="breadcrumb-sep">›</span>`;
    }).join('');
    // 当前光标所在符号
    if (editor) {
        const pos = editor.getPosition();
        if (pos) {
            const line = editor.getModel()?.getLineContent(pos.lineNumber) || '';
            const match = line.match(/(?:fun|function|def|func|fn|class|interface|object)\s+(\w+)/);
            symbolEl.textContent = match ? ` › ${match[1]}() :${pos.lineNumber}` : ` :${pos.lineNumber}`;
        }
    }
    bar.classList.remove('hidden');
}
// ─────────────────────────────────────────
// 终端切换
// ─────────────────────────────────────────
function toggleTerminal() {
    const panel = document.getElementById('panel-area');
    const resizer = document.getElementById('panel-resizer');
    const toggle = document.getElementById('status-panel-toggle');
    const isVisible = !panel.classList.contains('hidden');
    if (isVisible) {
        panel.classList.add('hidden');
        resizer.classList.add('hidden');
        toggle?.classList.remove('panel-visible');
    }
    else {
        panel.classList.remove('hidden');
        resizer.classList.remove('hidden');
        toggle?.classList.add('panel-visible');
        // 自动初始化终端(如果还没创建)
        initTerminal();
        setTimeout(() => fitActiveTerminal(), 100);
    }
    editor?.layout();
}
// ─────────────────────────────────────────
// 标签拖拽:同步文件顺序
// ─────────────────────────────────────────
function syncOpenFilesOrder() {
    const tabs = document.getElementById('editor-tabs').querySelectorAll('.tab-item');
    const newOrder = [];
    tabs.forEach(tab => {
        const idx = parseInt(tab.dataset.fileIndex || '0');
        if (idx >= 0 && idx < state.openFiles.length) {
            newOrder.push(state.openFiles[idx]);
        }
    });
    if (newOrder.length === state.openFiles.length) {
        state.openFiles = newOrder;
        state.activeFileIndex = 0; // 保持第一个为活跃
    }
}
// ─────────────────────────────────────────
// 对话历史列表
// ─────────────────────────────────────────
function renderChatList() {
    const list = document.getElementById('chat-list');
    if (state.chatSessions.length === 0) {
        list.innerHTML = '<div class="chat-list-empty">暂无对话</div>';
        return;
    }
    list.innerHTML = state.chatSessions.map(session => {
        const isActive = session.id === state.currentSessionId;
        const firstName = session.chatHistory.find(m => m.role === 'user');
        const autoTitle = firstName
            ? firstName.content.slice(0, 40) + (firstName.content.length > 40 ? '...' : '')
            : session.name;
        const title = session.customName ? session.name : autoTitle;
        const time = new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
        const msgCount = session.chatHistory.length;
        return `
      <div class="chat-list-item${isActive ? ' active' : ''}" data-session-id="${session.id}">
        <span class="chat-list-title">${title}</span>
        <span class="chat-list-meta">${msgCount > 0 ? msgCount + ' 条' : '新对话'} · ${time}</span>
        <div class="chat-list-actions">
          <button class="chat-list-rename" data-session-id="${session.id}" title="重命名">✎</button>
          <button class="chat-list-delete" data-session-id="${session.id}" title="删除">×</button>
        </div>
      </div>`;
    }).join('');
    // 点击切换
    list.querySelectorAll('.chat-list-item').forEach(item => {
        item.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList.contains('chat-list-delete') || target.classList.contains('chat-list-rename'))
                return;
            const id = item.dataset.sessionId;
            switchSession(id);
        });
        // 双击标题 → 重命名
        item.addEventListener('dblclick', (e) => {
            const target = e.target;
            if (target.classList.contains('chat-list-delete'))
                return;
            e.preventDefault();
            e.stopPropagation();
            const id = item.dataset.sessionId;
            renameSession(id);
        });
    });
    // 删除按钮
    list.querySelectorAll('.chat-list-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.sessionId;
            deleteSession(id);
        });
    });
    // 重命名按钮
    list.querySelectorAll('.chat-list-rename').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.sessionId;
            renameSession(id);
        });
    });
}
// ─────────────────────────────────────────
// Zen Mode 状态栏同步
// ─────────────────────────────────────────
function updateZenStatusBar() {
    const lang = document.getElementById('zen-language');
    const pos = document.getElementById('zen-position');
    if (editor) {
        const p = editor.getPosition();
        if (p)
            pos.textContent = `行 ${p.lineNumber}, 列 ${p.column}`;
    }
    if (state.activeFileIndex >= 0) {
        lang.textContent = state.openFiles[state.activeFileIndex]?.language || '';
    }
}
// ─────────────────────────────────────────
// 初始化入口
// ─────────────────────────────────────────
async function init() {
    console.log('[Renderer] PersonalIDE initializing...');
    initMonaco();
    setupEventListeners();
    setupResizers();
    await loadConfig();
    loadModelList(); // 异步加载模型注册表
    // ── 会话恢复（必须在其他初始化之前）──
    await restoreLastSession();
    // 清理历史重复消息（旧版 streamToAI 产生的双份用户消息）
    deduplicateChatHistory();
    // 如果没有会话则初始化首个
    ensureSession();
    // v1.1 新功能初始化
    initCommandPalette();
    initWelcomePage();
    initOutline();
    initFileTreeSearch();
    initSearchPanel();
    initTabContextMenu();
    initTerminal();
    // ── 会话恢复已在上面完成 ──
    // 编辑器光标变化时更新面包屑和 Zen 状态栏
    editor?.onDidChangeCursorPosition(() => {
        updateBreadcrumb();
        updateZenStatusBar();
    });
    // ── 定期自动保存会话 ──
    setInterval(() => { saveSession(); saveSessionsToDisk(); }, 30_000); // 每 30 秒
    window.addEventListener('beforeunload', () => { saveSession(); saveSessionsToDisk(); });
    console.log('[Renderer] PersonalIDE ready');
}
init().catch(console.error);
// ─────────────────────────────────────────
// 会话持久化
// ─────────────────────────────────────────
let _savePending = false;
async function saveSession() {
    if (_savePending)
        return;
    _savePending = true;
    try {
        // 收集编辑器滚动位置
        const scrollPositions = {};
        for (const f of state.openFiles) {
            if (f.path && editor) {
                scrollPositions[f.path] = {
                    scrollTop: editor.getScrollTop(),
                    scrollLeft: editor.getScrollLeft(),
                };
            }
        }
        await window.api.saveSession({
            projectPath: state.projectPath,
            openFiles: state.openFiles.map(f => ({
                path: f.path, name: f.name, language: f.language,
            })),
            activeFileIndex: state.activeFileIndex,
            chatSessions: state.chatSessions.map(s => ({
                id: s.id, name: s.name,
                chatHistory: s.chatHistory.map(m => ({
                    id: m.id, role: m.role, content: m.content, timestamp: m.timestamp,
                })),
                createdAt: s.createdAt, updatedAt: s.updatedAt, projectPath: s.projectPath,
            })),
            currentSessionId: state.currentSessionId,
            scrollPositions,
        });
    }
    catch (err) {
        // 静默失败
    }
    finally {
        _savePending = false;
    }
}
async function restoreLastSession() {
    try {
        const saved = await window.api.restoreSession();
        if (!saved || !saved.projectPath)
            return;
        console.log('[Session] 恢复上次会话...', saved.timestamp ? new Date(saved.timestamp).toLocaleString() : '');
        // 恢复项目
        state.projectPath = saved.projectPath;
        await loadFileTree(saved.projectPath);
        hideWelcomePage();
        // 恢复 AI 会话
        if (saved.chatSessions && saved.chatSessions.length > 0) {
            state.chatSessions = saved.chatSessions.map(s => ({
                id: s.id, name: s.name, customName: s.customName,
                chatHistory: s.chatHistory || [],
                createdAt: s.createdAt, updatedAt: s.updatedAt,
                projectPath: s.projectPath,
            }));
            state.currentSessionId = saved.currentSessionId || state.chatSessions[0]?.id || '';
            // 恢复对话 UI
            if (state.currentSessionId) {
                renderChatList();
                switchSession(state.currentSessionId);
            }
        }
        // 恢复打开的文件
        if (saved.openFiles && saved.openFiles.length > 0) {
            for (let i = 0; i < saved.openFiles.length; i++) {
                const f = saved.openFiles[i];
                try {
                    if (f.language === 'pdf') {
                        const { base64 } = await window.api.readPdfBase64(f.path);
                        const byteChars = atob(base64);
                        const byteNums = new Array(byteChars.length);
                        for (let i = 0; i < byteChars.length; i++)
                            byteNums[i] = byteChars.charCodeAt(i);
                        const byteArr = new Uint8Array(byteNums);
                        const pdfDataUrl = 'data:application/pdf;base64,' + base64;
                        state.openFiles.push({ path: f.path, name: f.name, content: pdfDataUrl, dirty: false, language: 'pdf' });
                    }
                    else if (f.language === 'markdown') {
                        // DOCX 文本提取
                        try {
                            const text = await window.api.readDocxText(f.path);
                            state.openFiles.push({ path: f.path, name: f.name, content: text, dirty: false, language: 'markdown' });
                        }
                        catch {
                            // 可能是普通 md 文件
                            const content = await window.api.readFile(f.path);
                            state.openFiles.push({ path: f.path, name: f.name, content, dirty: false, language: f.language });
                        }
                    }
                    else {
                        const content = await window.api.readFile(f.path);
                        state.openFiles.push({ path: f.path, name: f.name, content, dirty: false, language: f.language || detectLanguage(f.name) });
                    }
                }
                catch {
                    // 文件可能已被删除,跳过
                }
            }
            if (state.openFiles.length > 0) {
                const activeIdx = Math.min(saved.activeFileIndex, state.openFiles.length - 1);
                if (activeIdx >= 0) {
                    switchToFile(activeIdx);
                }
                renderEditorTabs();
                // 恢复滚动位置
                const savedScroll = saved.scrollPositions?.[state.openFiles[activeIdx]?.path];
                if (savedScroll && editor) {
                    setTimeout(() => {
                        editor?.setScrollPosition(savedScroll);
                    }, 100);
                }
            }
        }
        showToast('已恢复上次工作状态', 'info');
    }
    catch (err) {
        console.error('[Session] 恢复失败:', err);
    }
}
// 辅助:path.basename polyfill
const path = { basename: (p) => p.split(/[\\/]/).pop() || p };
// 状态栏 Git 分支点击:复制分支名
const statusGitEl = document.getElementById('status-git');
if (statusGitEl) {
    statusGitEl.addEventListener('click', () => {
        const text = statusGitEl.textContent || '';
        if (text.length > 2) {
            navigator.clipboard.writeText(text.replace('🔀 ', '')).catch(() => { });
            showToast('分支名已复制', 'info');
        }
    });
}
// ─────────────────────────────────────────
// 用量统计面板
// ─────────────────────────────────────────
async function loadUsageData() {
    try {
        const [today, total, byProject, byDate] = await Promise.all([
            window.api.getUsageToday(),
            window.api.getUsageTotal(),
            window.api.getUsageByProject(),
            window.api.getUsageByDate(30),
        ]);
        // 今日卡片
        const todayTokens = document.getElementById('usage-today-tokens');
        const todayCost = document.getElementById('usage-today-cost');
        if (todayTokens)
            todayTokens.textContent = formatTokenCount(today.totalTokens);
        if (todayCost)
            todayCost.textContent = `${today.costRmb.toFixed(4)} 元`;
        // 累计卡片
        const totalTokens = document.getElementById('usage-total-tokens');
        const totalCost = document.getElementById('usage-total-cost');
        if (totalTokens)
            totalTokens.textContent = formatTokenCount(total.totalTokens);
        if (totalCost)
            totalCost.textContent = `${total.costRmb.toFixed(4)} 元`;
        // 项目列表
        renderUsageProjectList(byProject);
        // 柱状图
        renderUsageChart(byDate);
    }
    catch (err) {
        console.error('[Usage] 加载失败:', err);
    }
}
function formatTokenCount(n) {
    if (n >= 1_000_000)
        return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `${(n / 1_000).toFixed(1)}K`;
    return `${n}`;
}
function renderUsageProjectList(projects) {
    const container = document.getElementById('usage-project-list');
    if (!container)
        return;
    if (projects.length === 0) {
        container.innerHTML = '<div class="usage-empty">暂无数据</div>';
        return;
    }
    container.innerHTML = projects.map(p => {
        const name = p.projectName || p.projectPath.split(/[\\/]/).pop() || '未命名';
        return `<div class="usage-project-item">
      <span class="usage-project-name" title="${p.projectPath}">${name}</span>
      <span class="usage-project-stats">${formatTokenCount(p.totalTokens)} tokens / ${p.costRmb.toFixed(4)} 元</span>
    </div>`;
    }).join('');
}
function renderUsageChart(days) {
    const container = document.getElementById('usage-chart-bars');
    if (!container)
        return;
    if (days.length === 0) {
        container.innerHTML = '<div class="usage-empty" style="width:100%;text-align:center;">暂无数据</div>';
        return;
    }
    const maxTokens = Math.max(...days.map(d => d.totalTokens), 1);
    container.innerHTML = days.map(d => {
        const h = Math.max(2, (d.totalTokens / maxTokens) * 100);
        const tip = `${d.date}\n${formatTokenCount(d.totalTokens)} tokens\n${d.costRmb.toFixed(4)} 元`;
        return `<div class="usage-chart-bar" style="height:${h}%" data-tip="${tip.replace(/"/g, '&quot;')}"></div>`;
    }).join('');
}
// 状态栏用量更新
async function updateStatusBarUsage() {
    try {
        const today = await window.api.getUsageToday();
        const el = document.getElementById('status-usage');
        if (el) {
            el.textContent = `${formatTokenCount(today.totalTokens)} tokens / ${today.costRmb.toFixed(4)} 元`;
            el.title = `今日用量\n请求次数: ${today.requestCount}\n耗时: ${(today.durationMs / 1000).toFixed(1)}s`;
        }
    }
    catch { /* ignore */ }
}
// 余额不足弹窗
function showBalanceWarning(detail) {
    const dialog = document.getElementById('balance-warning-dialog');
    const msg = document.getElementById('balance-warning-msg');
    if (msg)
        msg.textContent = `API 余额不足或欠费,请充值后继续使用。\n\n详情:${detail}`;
    if (dialog)
        dialog.classList.remove('hidden');
}
// ═══════════════════════════════════════════════
// P0: Lint Integration — Monaco markers + Problems panel
// ═══════════════════════════════════════════════
let lintDiagnosticsByFile = new Map();

function triggerLintForFile(filePath) {
    if (!state.projectPath) return;
    const lang = filePath ? filePath.split('.').pop()?.toLowerCase() : '';
    if (!lang) return;
    const supported = ['js','jsx','ts','tsx','mjs','cjs','json','css','scss','less','html','vue','py','go','rs','java','kt','yml','yaml','md','sql'];
    if (!supported.includes(lang)) return;
    window.api.lintFile(filePath, state.projectPath).catch(() => {});
}

function applyLintDiagnostics(filePath, diagnostics) {
    lintDiagnosticsByFile.set(filePath, diagnostics);
    // Monaco markers
    if (editor) {
        const model = editor.getModel();
        if (model) {
            const modelPath = model.uri?.fsPath || model.uri?.path;
            if (modelPath === filePath || modelPath?.replace(/\\/g, '/') === filePath?.replace(/\\/g, '/')) {
                const markers = diagnostics.map(d => ({
                    severity: d.severity === 'error' ? monaco.MarkerSeverity.Error :
                              d.severity === 'warning' ? monaco.MarkerSeverity.Warning :
                              monaco.MarkerSeverity.Info,
                    message: `${d.ruleId ? `[${d.ruleId}] ` : ''}${d.message}${d.fix ? ' (可自动修复)' : ''}`,
                    startLineNumber: d.line || 1,
                    startColumn: d.column || 1,
                    endLineNumber: d.endLine || d.line || 1,
                    endColumn: d.endColumn || 100,
                    source: d.source || 'lint',
                }));
                monaco.editor.setModelMarkers(model, 'tcide-lint', markers);
            }
        }
    }
    // Problems panel
    updateProblemsPanel();
    updateStatusBarLint();
}

function updateProblemsPanel() {
    const panelList = document.getElementById('problems-list');
    if (!panelList) return;
    const allDiags = [];
    for (const [fp, diags] of lintDiagnosticsByFile) {
        for (const d of diags) {
            allDiags.push({ filePath: fp, ...d });
        }
    }
    if (allDiags.length === 0) {
        panelList.innerHTML = '<div class="problems-empty">✓ 未检测到代码问题</div>';
        // 也清空底部面板的问题列表
        const bottomPanel = document.getElementById('panel-problems');
        if (bottomPanel) {
            const empty = bottomPanel.querySelector('.problems-empty');
            const list = bottomPanel.querySelector('.problems-list');
            if (empty) empty.classList.remove('hidden');
            if (list) { list.classList.add('hidden'); list.innerHTML = ''; }
        }
        return;
    }
    // 按严重程度排序
    allDiags.sort((a, b) => {
        const sev = { error: 0, warning: 1, info: 2 };
        return (sev[a.severity] || 2) - (sev[b.severity] || 2);
    });
    const icons = { error: '🔴', warning: '🟡', info: '🔵', hint: '💡' };
    panelList.innerHTML = allDiags.map(d => {
        const fileName = (d.filePath || '').replace(/^.*[/\\]/, '');
        return `<div class="problem-item" data-file="${d.filePath || ''}" data-line="${d.line || 1}" style="padding:3px 8px;cursor:pointer;font-size:11px;border-bottom:1px solid var(--border-color);display:flex;gap:6px;align-items:flex-start;" onclick="document.querySelector('#problems-panel')?.classList.toggle('hidden')">
            <span style="flex-shrink:0;">${icons[d.severity] || '⚪'}</span>
            <span style="flex:1;min-width:0;">
                <span style="font-weight:600;">${fileName}:${d.line}</span>
                <span style="color:var(--fg-secondary);margin-left:4px;">${d.message?.substring(0, 120) || ''}</span>
            </span>
        </div>`;
    }).join('');
    // 点击跳转到文件+行
    panelList.querySelectorAll('.problem-item').forEach(el => {
        el.addEventListener('click', async () => {
            const fp = el.dataset.file;
            const line = parseInt(el.dataset.line) || 1;
            if (fp) {
                const name = fp.replace(/^.*[/\\]/, '');
                const existing = state.openFiles.findIndex(f => f.path === fp);
                if (existing >= 0) {
                    switchToFile(existing);
                } else {
                    await openFile(fp, name);
                }
                if (editor) {
                    editor.revealLineInCenter(line);
                    editor.setPosition({ lineNumber: line, column: 1 });
                }
                // 自动关闭问题面板
                document.getElementById('problems-panel')?.classList.add('hidden');
            }
        });
    });
    // 同步到底部面板
    const bottomPanel = document.getElementById('panel-problems');
    if (bottomPanel) {
        const empty = bottomPanel.querySelector('.problems-empty');
        const list = bottomPanel.querySelector('.problems-list');
        if (empty) empty.classList.add('hidden');
        if (list) { list.classList.remove('hidden'); list.innerHTML = panelList.innerHTML; }
    }
}

function updateStatusBarLint() {
    let totalErrors = 0, totalWarnings = 0;
    for (const diags of lintDiagnosticsByFile.values()) {
        for (const d of diags) {
            if (d.severity === 'error') totalErrors++;
            else totalWarnings++;
        }
    }
    // 活动栏角标
    const badge = document.getElementById('problems-badge');
    if (badge) {
        const total = totalErrors + totalWarnings;
        badge.textContent = total > 99 ? '99+' : String(total);
        badge.classList.toggle('hidden', total === 0);
        if (totalErrors > 0) {
            badge.style.background = '#e51400';
        } else if (totalWarnings > 0) {
            badge.style.background = '#cca700';
        }
    }
    // 底部面板标签角标
    const panelBadge = document.querySelector('#panel-tabs .panel-badge');
    if (panelBadge) {
        const total = totalErrors + totalWarnings;
        panelBadge.textContent = total > 99 ? '99+' : String(total);
        panelBadge.classList.toggle('hidden', total === 0);
    }
    // 状态栏
    let el = document.getElementById('status-lint');
    if (!el) {
        el = document.createElement('span');
        el.id = 'status-lint';
        el.className = 'status-item';
        el.style.cssText = 'cursor:pointer;';
        el.title = '点击查看问题面板';
        el.onclick = () => {
            const panel = document.getElementById('panel-area');
            if (panel) panel.classList.remove('hidden');
            const tab = document.querySelector('.panel-tab[data-panel="problems"]');
            if (tab) tab.click();
        };
        const spacer = document.getElementById('status-position');
        if (spacer) spacer.before(el);
    }
    if (totalErrors > 0) {
        el.innerHTML = `🔴 ${totalErrors} ⚠ ${totalWarnings}`;
        el.style.color = '#f44747';
    } else if (totalWarnings > 0) {
        el.innerHTML = `⚠ ${totalWarnings}`;
        el.style.color = '#cca700';
    } else {
        el.innerHTML = '✓ 0';
        el.style.color = '#6a9955';
    }
}

// ═══════════════════════════════════════════════
// P0: Debug Panel Integration
// ═══════════════════════════════════════════════
let debugPanelInstance = null;
let debugPanelMounted = false;

function mountDebugPanel() {
    if (debugPanelMounted) return;
    try {
        if (typeof DebugPanel === 'undefined') {
            console.warn('[Debug Panel] debug-panel.js 未加载');
            return;
        }
        // 创建调试面板容器
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        let debugContainer = document.getElementById('debug-panel');
        if (!debugContainer) {
            debugContainer = document.createElement('div');
            debugContainer.id = 'debug-panel';
            debugContainer.className = 'view-panel hidden';
            sidebar.appendChild(debugContainer);
        }
        debugPanelInstance = new DebugPanel();
        debugPanelInstance.init(monaco, editor, debugContainer, window.api);
        // 监听调试事件
        if (window.api.onDebugEvent) {
            window.api.onDebugEvent((data) => {
                if (debugPanelInstance) {
                    debugPanelInstance.handleDebugEvent(data.sessionId, data);
                }
            });
        }
        // 添加调试活动按钮
        const activityBar = document.getElementById('activity-bar');
        if (activityBar) {
            const debugBtn = document.createElement('button');
            debugBtn.className = 'activity-btn';
            debugBtn.dataset.view = 'debug';
            debugBtn.title = '调试 (Ctrl+Shift+D)';
            debugBtn.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m14.5 2 4.5 4.5-4.5 4.5"/><path d="M19 6.5H9a4 4 0 0 0 0 8h1"/><path d="m9.5 22-4.5-4.5 4.5-4.5"/><path d="M5 17.5h10a4 4 0 0 0 0-8h-1"/></svg>';
            debugBtn.addEventListener('click', () => {
                // 切换视图
                document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden'));
                document.querySelectorAll('.activity-btn').forEach(b => b.classList.remove('active'));
                debugBtn.classList.add('active');
                debugContainer.classList.remove('hidden');
                document.getElementById('sidebar')?.querySelector('.sidebar-title')?.replaceChildren('DEBUG');
                document.getElementById('file-tree')?.classList.add('hidden');
                document.getElementById('sidebar-search-explorer')?.classList.add('hidden');
                document.getElementById('git-panel')?.classList.add('hidden');
                document.getElementById('arch-panel')?.classList.add('hidden');
                if (debugPanelInstance) debugPanelInstance.toggle(true);
            });
            activityBar.querySelector('.activity-top')?.appendChild(debugBtn);
        }
        debugPanelMounted = true;
    } catch (err) {
        console.error('[Debug Panel] 挂载失败:', err);
    }
}

// ═══════════════════════════════════════════════
// P0: Semantic Chunker Integration
// ═══════════════════════════════════════════════
function triggerChunkerForFile(filePath) {
    window.api.chunkerNeedsChunking(filePath).then(needsChunking => {
        if (needsChunking) {
            window.api.chunkerChunkFile(filePath).then(result => {
                if (result.chunks.length > 1) {
                    console.log(`[Chunker] 文件已分片: ${filePath} → ${result.chunks.length} 个分片 (${result.totalLines} 行)`);
                }
            }).catch(() => {});
        }
    }).catch(() => {});
}

// ═══════════════════════════════════════════════
// P0: Perf Integration
// ═══════════════════════════════════════════════
let perfStatusEl = null;
function updateStatusBarPerf() {
    window.api.perfGetMetrics().then(metrics => {
        if (!perfStatusEl) {
            perfStatusEl = document.createElement('span');
            perfStatusEl.id = 'status-perf';
            perfStatusEl.className = 'status-item';
            perfStatusEl.style.cssText = 'font-size:10px;color:#808080;';
            const lang = document.getElementById('status-language');
            if (lang) lang.after(perfStatusEl);
        }
        if (metrics.openCount > 0) {
            perfStatusEl.textContent = `⏱ ${metrics.avgOpenTime}ms`;
            perfStatusEl.title = `文件打开: 平均 ${metrics.avgOpenTime}ms / ${metrics.openCount}次 | 标签切换: 平均 ${metrics.avgSwitchTime}ms / ${metrics.switchCount}次`;
        }
    }).catch(() => {});
}

// ═══════════════════════════════════════════════
// P0: Lint Event Listener
// ═══════════════════════════════════════════════
function initLintListener() {
    if (window.api.onLintDiagnostics) {
        window.api.onLintDiagnostics(({ filePath, diagnostics }) => {
            applyLintDiagnostics(filePath, diagnostics);
        });
    }
    if (window.api.onLintProgress) {
        window.api.onLintProgress(({ file, percent }) => {
            // 全项目 Lint 进度可在此扩展
        });
    }
}

// ═══════════════════════════════════════════════
// P0: Perf Timer on File Open
// ═══════════════════════════════════════════════
function startPerfOpenTimer() {
    if (!window.__perfOpenTimer) {
        window.__perfOpenTimer = null;
    }
}

// ═══════════════════════════════════════════════
// P1: Git Intelligence — Smart Commit Message
// ═══════════════════════════════════════════════
async function generateSmartCommitMessage() {
    const msgInput = document.getElementById('git-commit-message');
    if (!msgInput || !state.projectPath) return;
    try {
        msgInput.placeholder = 'AI 正在分析变更...';
        const result = await window.api.gitintelGenerateCommitMessage(state.projectPath, { style: 'conventional', useAI: true });
        if (result && result.message && result.message !== 'chore: minor update') {
            msgInput.value = result.message;
            msgInput.placeholder = '提交信息';
            if (result.breakdown && result.breakdown.length > 0) {
                const detail = result.breakdown.map(b => `- ${b.type}${b.scope ? '(' + b.scope + ')' : ''}: ${b.short}`).join('\n');
                addChatMessage('system', `🤖 AI 分析变更:\n${detail}`);
            }
        } else { msgInput.placeholder = '提交信息 (变更较少)'; }
    } catch { msgInput.placeholder = 'AI 分析失败'; }
}

// ═══════════════════════════════════════════════
// P1: Project Memory — Auto-load & Inject
// ═══════════════════════════════════════════════
async function initProjectMemory(projectPath) {
    try {
        await window.api.memoryInit(projectPath);
        const injection = await window.api.memoryGetInjection();
        if (injection) window.__projectMemoryInjection = injection;
    } catch { /* 非致命 */ }
}

// ═══════════════════════════════════════════════
// P1: Vector Index — Auto-init & Background Index
// ═══════════════════════════════════════════════
async function initVectorIndex(projectPath) {
    try {
        await window.api.vectorInit(projectPath);
        setTimeout(() => { window.api.vectorIndexAll().catch(() => {}); }, 2000);
    } catch { /* 非致命 */ }
}

// ═══════════════════════════════════════════════
// P1: Semantic Completion — Monaco Provider
// ═══════════════════════════════════════════════
function registerSemanticCompletion() {
    if (!monaco) return;
    try {
        monaco.languages.registerCompletionItemProvider('*', {
            provideCompletionItems: async (model, position) => {
                const textUntilPosition = model.getValueInRange({
                    startLineNumber: Math.max(1, position.lineNumber - 5),
                    startColumn: 1,
                    endLineNumber: position.lineNumber,
                    endColumn: position.column,
                });
                const fp = model.uri?.fsPath || model.uri?.path;
                const lang = model.getLanguageId();
                try {
                    const completion = await window.api.completionGet({
                        prefix: textUntilPosition.substring(Math.max(0, textUntilPosition.length - 500)),
                        filePath: fp, language: lang,
                        line: position.lineNumber, column: position.column,
                    });
                    if (completion && completion.text) {
                        return { suggestions: [{ label: completion.text.substring(0, 50), kind: monaco.languages.CompletionItemKind.Snippet, insertText: completion.text, detail: 'AI 补全' }] };
                    }
                } catch {}
                return { suggestions: [] };
            },
            triggerCharacters: ['.', '(', ' '],
        });
    } catch {}
}

// ═══════════════════════════════════════════════
// P0: Project-Level Service Initialization
// ═══════════════════════════════════════════════
let p0ServicesInitialized = false;
function initP0ProjectServices(projectPath) {
    if (p0ServicesInitialized) return;
    p0ServicesInitialized = true;
    // Context Trimmer
    window.api.contextInit(projectPath).then(() => {
        window.api.contextStartTrim().catch(() => {});
    }).catch(() => {});
    // P1: 项目记忆
    initProjectMemory(projectPath).catch(() => {});
    // P1: 向量索引
    initVectorIndex(projectPath).catch(() => {});
    // P1: GitIntelligence
    window.api.gitintelInit?.(projectPath).catch(() => {});
    // P1: SemanticCompletion
    window.api.completionInit?.(projectPath).catch(() => {});
    // P2: WarehouseAnalyzer
    window.api.warehouseInit?.(projectPath).catch(() => {});
    // P3: EntropyEvaluator
    window.api.entropyInit?.(projectPath).catch(() => {});
    // P3: SmartTrimmer
    window.api.smartTrimmerInit?.(projectPath).catch(() => {});
    // Dream Engine
    window.api.dreamInit?.(projectPath).catch(() => {});
    // Perf: 定时 GC
    setInterval(() => {
        window.api.perfGcSweep().catch(() => {});
        if (editor) {
            const models = monaco.editor.getModels();
            if (models.length > 20) {
                for (let i = 0; i < models.length - 15; i++) {
                    try { models[i].dispose(); } catch {}
                }
            }
        }
    }, 60000);
    // 输入防抖：为编辑器添加防抖
    if (editor) {
        let debounceTimer = null;
        editor.onDidChangeModelContent(() => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                // Lint 延迟检测（300ms 后触发）
                const model = editor.getModel();
                if (model && state.projectPath) {
                    const fp = model.uri?.fsPath || model.uri?.path;
                    if (fp) triggerLintForFile(fp);
                }
            }, 300);
        });
    }
    // 大文件滚动分片监听
    if (editor) {
        editor.onDidScrollChange((e) => {
            if (!e.scrollTopChanged) return;
            const model = editor.getModel();
            if (!model) return;
            const fp = model.uri?.fsPath || model.uri?.path;
            if (!fp) return;
            const visibleRanges = editor.getVisibleRanges();
            if (visibleRanges.length > 0) {
                const startLine = visibleRanges[0].startLineNumber;
                const endLine = visibleRanges[visibleRanges.length - 1].endLineNumber;
                window.api.chunkerGetViewportChunks(fp, startLine, endLine).then(chunks => {
                    // 预加载逻辑已由 Core 处理，此处仅触发视口更新
                }).catch(() => {});
            }
        });
    }
    console.log('[P0] 项目服务已初始化:', projectPath);
}

// ═══ 智能服务定义与面板渲染 ═══
const serviceDefs = [
    { id: 'gitintel', name: '智能提交', desc: 'AI 生成提交信息', category: 'P1' },
    { id: 'warehouse', name: '架构分析', desc: '模块与依赖关系', category: 'P2' },
    { id: 'completion', name: '语义补全', desc: '上下文感知补全', category: 'P1' },
    { id: 'memory', name: '项目记忆', desc: '记录编码模式', category: 'P1' },
    { id: 'vectorindex', name: '向量索引', desc: '语义代码搜索', category: 'P1' },
    { id: 'lint', name: '语法检查', desc: '多工具语法检查', category: 'P0' },
    { id: 'debug', name: '断点调试', desc: '运行时调试', category: 'P0' },
    { id: 'autoheal', name: '自愈引擎', desc: '自动修复报错', category: 'P0' },
    { id: 'batch', name: '批量修改', desc: '跨文件批量修改', category: 'P0' },
    { id: 'perf', name: '性能优化', desc: '内存监控回收', category: 'P0' },
    { id: 'contexttrim', name: '上下文瘦身', desc: '对话历史压缩', category: 'P0' },
    { id: 'unattended', name: '沙箱执行', desc: '安全执行代码', category: 'P2' },
    { id: 'entropy', name: '熵值评估', desc: '代码健康度评估', category: 'P3' },
    { id: 'entropyctrl', name: '健康监控', desc: '实时健康监控', category: 'P3' },
    { id: 'smarttrim', name: '智能修剪', desc: '智能对话管理', category: 'P3' },
];
let serviceStates = {};
try { serviceStates = JSON.parse(localStorage.getItem('tcide-services') || '{}'); } catch {}
function renderServiceToggles() {
    const container = document.getElementById('service-toggles');
    if (!container) return;
    const catEmoji = { P0: '🏗️', P1: '🧠', P2: '⚙️', P3: '📊' };
    let html = '';
    ['P0','P1','P2','P3'].forEach(cat => {
        const svcs = serviceDefs.filter(s => s.category === cat);
        if (!svcs.length) return;
        html += `<div style="font-size:10px;font-weight:600;color:var(--tc-orange);padding:8px 0 2px">${catEmoji[cat]||'•'} ${cat}</div>`;
        svcs.forEach(s => {
            const enabled = serviceStates[s.id] !== false;
            html += `<label style="display:flex;align-items:center;gap:8px;padding:5px 8px;background:rgba(255,255,255,0.02);border-radius:4px;cursor:pointer;font-size:12px">
        <input type="checkbox" data-svc="${s.id}" ${enabled?'checked':''} onchange="serviceStates[this.dataset.svc]=this.checked;localStorage.setItem('tcide-services',JSON.stringify(serviceStates))">
        <span style="flex:1;color:var(--text-primary)">${s.name}</span>
        <span style="font-size:10px;color:var(--text-secondary)">${s.desc}</span>
      </label>`;
        });
    });
    container.innerHTML = html;
}
document.getElementById('btn-services-refresh-all')?.addEventListener('click', () => {
    if (!state.projectPath) return showToast('请先打开项目', 'warning');
    p0ServicesInitialized = false;
    initP0ProjectServices(state.projectPath);
    showToast('所有智能服务已重新初始化', 'success');
});
document.getElementById('btn-services-gc')?.addEventListener('click', async () => {
    await window.api.perfGcSweep?.();
    updatePerfStatus();
    showToast('内存回收完成', 'info');
});

// ═══════════════════════════════════════════════
// P0: AutoHeal — 终端报错自动修复（终端输出拦截）
// ═══════════════════════════════════════════════
function setupAutoHealForTerminal() {
    // 拦截终端命令输出，检测错误并触发自愈
    const originalExecCommand = window.api.execCommand;
    if (!originalExecCommand) return;
    // 包装 execCommand，在返回结果时检测错误
    window.api.execCommand = async function(command, cwd) {
        const result = await originalExecCommand.call(window.api, command, cwd);
        if (result.exitCode !== 0 && state.projectPath) {
            const output = (result.stdout || '') + '\n' + (result.stderr || '');
            try {
                const errors = await window.api.autohealParseErrors(output, state.projectPath);
                if (errors.length > 0) {
                    addChatMessage('system', `🔧 检测到 ${errors.length} 个编译错误，是否需要 AI 自动修复？\n\n${errors.slice(0, 3).map(e => `- ${e.filePath || '?'}:${e.line} ${e.message?.substring(0, 80)}`).join('\n')}\n\n输入 "修复" 以启动自动修复。`);
                    // 存储错误供后续修复
                    window.__lastBuildErrors = errors;
                    window.__lastBuildCommand = command;
                }
            } catch { /* 自愈解析失败 */ }
        }
        return result;
    };
}

// ═══════════════════════════════════════════════
// P0: Batch — 搜索面板集成
// ═══════════════════════════════════════════════
function setupBatchSearchIntegration() {
    // 增强搜索面板：连接 batch API 支持全局搜索替换
    const searchPanel = document.getElementById('search-panel');
    if (!searchPanel) return;
    // 监听搜索输入，使用 debounce 调用 batch:search
    const searchInput = document.getElementById('search-input');
    if (!searchInput) return;
    let searchTimer = null;
    searchInput.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(async () => {
            const query = searchInput.value.trim();
            if (query.length < 2 || !state.projectPath) return;
            const fileFilter = document.getElementById('search-file-filter');
            const fileTypes = fileFilter?.value === '*' ? undefined : fileFilter?.value.split(',').map(s => s.trim());
            try {
                const results = await window.api.batchSearch(state.projectPath, query, { fileTypes, maxResults: 100 });
                const resultsContainer = document.getElementById('search-results');
                if (resultsContainer) {
                    if (results.count === 0) {
                        resultsContainer.innerHTML = '<div class="search-empty">未找到结果</div>';
                    } else {
                        resultsContainer.innerHTML = `<div class="search-summary">找到 ${results.count} 个结果${results.count > 100 ? ' (仅显示前100个)' : ''}</div>` +
                            results.matches.slice(0, 100).map(m => {
                                const fileName = m.filePath.replace(/^.*[/\\]/, '');
                                const preview = m.lineContent.substring(0, 120);
                                return `<div class="search-result-item" data-file="${m.filePath}" data-line="${m.line}" data-col="${m.column}" style="padding:4px 8px;cursor:pointer;border-bottom:1px solid var(--border-color);display:flex;gap:6px;">
                                    <span style="color:var(--fg-secondary);flex-shrink:0;font-size:10px;">${fileName}:${m.line}</span>
                                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;">${preview}</span>
                                </div>`;
                            }).join('');
                        // 点击跳转
                        resultsContainer.querySelectorAll('.search-result-item').forEach(el => {
                            el.addEventListener('click', async () => {
                                const fp = el.dataset.file;
                                const line = parseInt(el.dataset.line);
                                if (fp) {
                                    const name = fp.replace(/^.*[/\\]/, '');
                                    const existing = state.openFiles.findIndex(f => f.path === fp);
                                    if (existing >= 0) switchToFile(existing);
                                    else await openFile(fp, name);
                                    if (editor) { editor.revealLineInCenter(line); editor.setPosition({ lineNumber: line, column: 1 }); }
                                }
                            });
                        });
                    }
                }
            } catch { /* search failed */ }
        }, 200);
    });
    // 替换按钮：使用 batch:preview + batch:apply
    const replaceInput = document.getElementById('search-replace');
    const toggleReplaceBtn = document.getElementById('btn-toggle-replace');
    if (toggleReplaceBtn && replaceInput) {
        toggleReplaceBtn.addEventListener('click', () => {
            const isHidden = replaceInput.classList.contains('hidden');
            replaceInput.classList.toggle('hidden');
            toggleReplaceBtn.textContent = isHidden ? '↔ (预览)' : '↔';
        });
        // 监听替换输入 + Enter 执行替换
        replaceInput.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                const search = searchInput.value.trim();
                const replace = replaceInput.value.trim();
                if (!search || !replace || !state.projectPath) return;
                try {
                    const preview = await window.api.batchPreview(state.projectPath, search, replace);
                    const confirm = window.confirm(`将替换 ${preview.totalChanges} 处匹配 (${preview.affectedFiles} 个文件)。确认？`);
                    if (confirm) {
                        const result = await window.api.batchApply(state.projectPath, search, replace);
                        showToast(`已修改 ${result.stats.modified} 个文件 (${result.stats.failed} 失败)`, result.stats.failed === 0 ? 'success' : 'warning');
                        if (result.stats.failed > 0) {
                            addChatMessage('system', `⚠ 批量替换部分失败:\n${result.results.filter(r => !r.success).map(r => `- ${r.filePath}: ${r.error}`).join('\n')}`);
                        }
                        // 刷新文件树
                        if (state.projectPath) loadFileTree(state.projectPath);
                    }
                } catch (err) {
                    showToast(`替换失败: ${err.message}`, 'error');
                }
            }
        });
    }
}

// 初始化用量相关事件
function initUsageEvents() {
    // 用量 Tab 切换时加载数据
    document.querySelectorAll('.ai-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            if (tabName === 'usage')
                loadUsageData();
        });
    });
    // 刷新按钮
    document.getElementById('btn-refresh-usage')?.addEventListener('click', loadUsageData);
    // 关闭余额警告
    document.getElementById('btn-dismiss-warning')?.addEventListener('click', () => {
        document.getElementById('balance-warning-dialog')?.classList.add('hidden');
    });
    // 监听主进程余额警告
    if (window.api.onBalanceWarning) {
        window.api.onBalanceWarning(showBalanceWarning);
    }
    // 状态栏用量点击 → 切换到用量 Tab
    document.getElementById('status-usage')?.addEventListener('click', () => {
        document.querySelector('.ai-tab[data-tab="usage"]')?.dispatchEvent(new Event('click'));
    });
    // 初始化时更新状态栏
    updateStatusBarUsage();
}
initUsageEvents();
initSettingsEvents();

// ═══════════════════════════════════════════════
// P0: Init Renderer Integrations (Lint / Debug / Perf / Context / AutoHeal / Batch)
// ═══════════════════════════════════════════════
initLintListener();
// Debug panel 延迟挂载（等 DOM 就绪）
setTimeout(() => { mountDebugPanel(); }, 500);
// Perf 状态栏更新
setInterval(() => { updateStatusBarPerf(); }, 30000);
updateStatusBarPerf();
// AutoHeal: 终端错误拦截
setupAutoHealForTerminal();
// Batch: 搜索面板集成
try { setupBatchSearchIntegration(); } catch(e) { console.warn('[P0] Batch search integration:', e); }
// P1: 语义补全注册（等 Monaco 初始化后）
setTimeout(() => { registerSemanticCompletion(); }, 1000);

// ── 清理历史重复消息 ──
function deduplicateChatHistory() {
    let cleaned = 0;
    for (const session of state.chatSessions) {
        const filtered = [];
        for (let i = 0; i < session.chatHistory.length; i++) {
            const curr = session.chatHistory[i];
            const prev = filtered[filtered.length - 1];
            // 跳过相邻重复的用户消息
            if (prev && prev.role === 'user' && curr.role === 'user' && prev.content === curr.content) {
                cleaned++;
                continue;
            }
            filtered.push(curr);
        }
        if (filtered.length !== session.chatHistory.length) {
            session.chatHistory = filtered;
            session.updatedAt = Date.now();
        }
    }
    if (cleaned > 0) {
        console.log(`[Dedup] 清理了 ${cleaned} 条重复消息`);
        saveSessionsToDisk();
    }
}
// ── MCP 工具切换 ──
let mcpToolsEnabled = false;
const toolsToggle = document.getElementById('btn-tools-toggle');
if (toolsToggle) {
    toolsToggle.addEventListener('click', () => {
        mcpToolsEnabled = !mcpToolsEnabled;
        toolsToggle.classList.toggle('active', mcpToolsEnabled);
        showToast(mcpToolsEnabled ? '✅ 工具模式已开启: AI 可读写文件/执行命令' : '❌ 工具模式已关闭', 'info', 2000);
    });
}
// ── Agent 模式切换 ──
let currentAgentMode = 'chat'; // chat | tools | builder | pipeline
document.querySelectorAll('.agent-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.agent-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentAgentMode = btn.dataset.mode;
        const input = document.getElementById('chat-input');
        const footer = document.getElementById('chat-footer-hint');
        const hints = {
            chat: '输入消息，Shift+Enter 换行，Enter 发送...',
            tools: '🔧 工具模式 — AI 可读写文件、搜索代码、执行命令',
            builder: '🧱 构建模式 — 描述需求，AI 自动拆解并逐步执行',
            pipeline: '🚀 流水线模式 — 全流程：并行开发 + 审查 + 构建验证'
        };
        input.placeholder = hints[currentAgentMode] || hints.chat;
        if (footer) {
            if (currentAgentMode === 'builder' || currentAgentMode === 'pipeline') {
                footer.textContent = 'Enter 启动 — AI 自主执行全流程';
            } else {
                footer.textContent = 'Enter 发送 · Shift+Enter 换行';
            }
        }
        // 同步工具开关
        mcpToolsEnabled = (currentAgentMode === 'tools' || currentAgentMode === 'pipeline');
        if (toolsToggle) toolsToggle.classList.toggle('active', mcpToolsEnabled);
        // 切出 Builder/Pipeline 时关闭面板
        if (currentAgentMode !== 'builder' && currentAgentMode !== 'pipeline') {
            hidePipelinePanel();
        }
        showToast(`已切换至 ${btn.textContent.trim()} 模式`, 'info', 1500);
    });
});
// ── Pipeline 面板管理 ──
let pipelineTimer = null;
function showPipelinePanel(title) {
    const panel = document.getElementById('agent-pipeline-panel');
    const welcome = document.getElementById('ai-welcome');
    const titleEl = document.getElementById('pipeline-title');
    const summaryEl = document.getElementById('pipeline-summary');
    const taskList = document.getElementById('pipeline-task-list');
    const elapsed = document.getElementById('pipeline-elapsed');
    // Hide welcome, show panel
    if (welcome) welcome.style.display = 'none';
    if (panel) panel.classList.remove('hidden');
    if (titleEl) titleEl.textContent = title || '🚀 任务流水线';
    if (taskList) taskList.innerHTML = '';
    if (summaryEl) { summaryEl.classList.add('hidden'); summaryEl.innerHTML = ''; }
    // Reset phases
    document.querySelectorAll('#pipeline-phases .pipeline-phase').forEach(p => {
        p.classList.remove('active', 'done');
    });
    // Timer
    const startTime = Date.now();
    if (elapsed) elapsed.textContent = '0:00';
    if (pipelineTimer) clearInterval(pipelineTimer);
    pipelineTimer = setInterval(() => {
        const sec = Math.floor((Date.now() - startTime) / 1000);
        const min = Math.floor(sec / 60);
        const s = sec % 60;
        if (elapsed) elapsed.textContent = `${min}:${String(s).padStart(2, '0')}`;
    }, 1000);
}
function hidePipelinePanel() {
    const panel = document.getElementById('agent-pipeline-panel');
    const welcome = document.getElementById('ai-welcome');
    if (panel) panel.classList.add('hidden');
    if (welcome) welcome.style.display = '';
    if (pipelineTimer) { clearInterval(pipelineTimer); pipelineTimer = null; }
}
function setPipelinePhase(phase) {
    const phases = document.querySelectorAll('#pipeline-phases .pipeline-phase');
    const phaseOrder = ['builder', 'coder', 'reviewer', 'tester'];
    const idx = phaseOrder.indexOf(phase);
    phases.forEach((p, i) => {
        p.classList.remove('active', 'done');
        if (i < idx) p.classList.add('done');
        else if (i === idx) p.classList.add('active');
    });
}
function addPipelineTask(taskId, name, files) {
    const taskList = document.getElementById('pipeline-task-list');
    if (!taskList) return;
    const card = document.createElement('div');
    card.className = 'pipeline-task-card pending';
    card.id = `ptask-${taskId}`;
    card.innerHTML = `<span class="pipeline-task-status">○</span><div class="pipeline-task-info"><div class="pipeline-task-name">${name || taskId}</div><div class="pipeline-task-files">${files || '—'}</div></div>`;
    taskList.appendChild(card);
}
function updatePipelineTask(taskId, status) {
    const card = document.getElementById(`ptask-${taskId}`);
    if (!card) return;
    card.className = `pipeline-task-card ${status}`;
    const statusEl = card.querySelector('.pipeline-task-status');
    const icons = { pending: '○', running: '◉', done: '✓', failed: '✗' };
    if (statusEl) statusEl.textContent = icons[status] || '○';
}
function showPipelineSummary(success, message) {
    const summary = document.getElementById('pipeline-summary');
    if (!summary) return;
    summary.classList.remove('hidden', 'success', 'failed');
    summary.classList.add(success ? 'success' : 'failed');
    summary.innerHTML = `<span>${success ? '✅' : '❌'} ${message}</span><button onclick="hidePipelinePanel()" style="padding:2px 8px;border:1px solid var(--border-subtle);border-radius:4px;background:transparent;color:var(--text-secondary);cursor:pointer;font-size:11px;font-family:inherit">关闭</button>`;
    if (pipelineTimer) { clearInterval(pipelineTimer); pipelineTimer = null; }
}
// ── 多选模式 ──
if (selectToggleBtn) {
    selectToggleBtn.addEventListener('click', () => {
        toggleChatSelectMode();
        selectToggleBtn.style.background = chatSelectMode ? 'rgba(255,165,0,0.2)' : '';
    });
}
document.getElementById('btn-delete-selected')?.addEventListener('click', deleteSelectedMessages);
document.getElementById('btn-select-all')?.addEventListener('click', selectAllMessages);
document.getElementById('btn-delete-all')?.addEventListener('click', deleteAllMessages);
document.getElementById('btn-clear-select')?.addEventListener('click', clearChatSelectMode);
// ── 右键菜单 ──
let contextMenuEl = null;
document.addEventListener('contextmenu', (e) => {
    const msgEl = e.target.closest('.chat-message');
    if (!msgEl || !msgEl.dataset.msgId) {
        contextMenuEl?.remove();
        return;
    }
    e.preventDefault();
    contextMenuEl?.remove();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:99999;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:6px;padding:4px 0;min-width:120px;box-shadow:0 4px 16px rgba(0,0,0,0.3)`;
    const msgId = msgEl.dataset.msgId;
    const role = msgEl.dataset.role || '';
    const items = [
        { label: '📋 复制', action: 'copy' },
        ...(role === 'user' ? [{ label: '✏️ 编辑', action: 'edit' }] : []),
        { label: '🗑 删除', action: 'delete' },
        ...(role === 'assistant' ? [{ label: '📤 分享', action: 'share' }] : []),
        { label: '☑ 进入多选模式', action: 'select' },
    ];
    menu.innerHTML = items.map(i => `<div class="context-menu-item" data-action="${i.action}">${i.label}</div>`).join('');
    menu.querySelectorAll('.context-menu-item').forEach(item => {
        item.addEventListener('click', () => {
            const action = item.dataset.action;
            if (action === 'select') {
                toggleChatSelectMode();
                menu.remove();
                contextMenuEl = null;
                return;
            }
            handleMsgAction(msgId, action);
            menu.remove();
            contextMenuEl = null;
        });
    });
    document.body.appendChild(menu);
    contextMenuEl = menu;
    const closeMenu = () => { menu.remove(); contextMenuEl = null; document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
});
// ── 重写 sendToAI 支持工具调用 ──
const _originalStreamToAI = window.__streamToAI;
window.__streamToAIWithTools = async function (messages, ctx) {
    if (mcpToolsEnabled && ctx) {
        const toolResult = await window.api.sendToAIWithTools(messages);
        // 结果已通过 stream-chunk 发送
        return toolResult;
    }
    window.__tcide_originalSendToAI?.(messages, ctx);
};
