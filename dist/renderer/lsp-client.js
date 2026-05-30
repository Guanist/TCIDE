"use strict";
/**
 * TCIDE LSP 客户端 — 渲染进程
 *
 * 通过 IPC 与主进程中的语言服务器通信，
 * 注册 Monaco Editor 的 Completion / Hover / Definition / References 等 Provider。
 */
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
exports.getLspClient = getLspClient;
exports.stopAllLspClients = stopAllLspClients;
exports.lspDidOpen = lspDidOpen;
exports.lspDidChange = lspDidChange;
exports.lspDidClose = lspDidClose;
exports.getDiagnostics = getDiagnostics;
exports.getAllDiagnostics = getAllDiagnostics;
const monaco = __importStar(require("monaco-editor"));
const LANG_MAP = {
    python: 'python',
    javascript: 'python', // JS/TS 使用 Monaco 内置 tsserver
    typescript: 'python', // JS/TS 使用 Monaco 内置 tsserver
    go: 'go',
    rust: 'rust',
    c: 'cpp',
    cpp: 'cpp',
    java: 'java',
    shell: 'bash',
    bash: 'bash',
};
/** 将 monaco.Uri 转为 LSP 文件 URI */
function toLspUri(uri) {
    return uri.toString();
}
/** 将 Monaco Position 转为 LSP Position (0-indexed) */
function toLspPosition(pos) {
    return { line: pos.lineNumber - 1, character: pos.column - 1 };
}
/** 将 LSP Position 转为 Monaco Position (1-indexed) */
function fromLspPosition(pos) {
    return new monaco.Position(pos.line + 1, pos.character + 1);
}
/** 将 LSP Range 转为 Monaco Range */
function fromLspRange(range) {
    return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1);
}
// ── 诊断存储 (跨模型) ──
const diagnosticsMap = new Map();
// ── LSP 客户端类 ──
class LspClient {
    language;
    projectPath = '';
    running = false;
    initPromise = null;
    /** 已注册的 disposable */
    disposables = [];
    /** 已注册 Provider 的语言 */
    static registeredLanguages = new Set();
    constructor(language) {
        this.language = language;
    }
    /** 启动服务器并注册 Provider */
    async start(projectPath) {
        this.projectPath = projectPath;
        const lspLang = LANG_MAP[this.language];
        if (!lspLang) {
            console.log(`[LSP] ${this.language}: 无可用语言服务器，跳过`);
            return;
        }
        // 检查服务器是否可用
        const available = await window.api.lspAvailable(lspLang);
        if (!available) {
            const guide = await window.api.lspInstallGuide(lspLang);
            console.log(`[LSP] ${lspLang}: 未安装语言服务器`);
            if (guide && window.showToast) {
                window.showToast(`📦 ${lspLang} 服务未安装 → ${guide}`, 'warning', 8000);
            }
            return;
        }
        console.log(`[LSP] 启动 ${lspLang} 服务器 (项目: ${projectPath})`);
        const result = await window.api.lspStart(lspLang, projectPath);
        if (!result.success) {
            console.error(`[LSP] 启动失败: ${result.error}`);
            return;
        }
        this.running = true;
        // 监听服务器消息 (诊断等)
        window.api.onLspMessage(this.handleServerMessage.bind(this));
        // 注册 Provider (每种语言只注册一次)
        if (!LspClient.registeredLanguages.has(lspLang)) {
            LspClient.registeredLanguages.add(lspLang);
            this.registerProviders(lspLang);
        }
    }
    /** 通知服务器文档已打开 */
    async didOpen(uri, language, text) {
        if (!this.running)
            return;
        const lspLang = LANG_MAP[language];
        if (!lspLang)
            return;
        console.log(`[LSP] didOpen: ${uri.toString()}`);
        await window.api.lspNotify(lspLang, 'textDocument/didOpen', {
            textDocument: {
                uri: toLspUri(uri),
                languageId: language,
                version: 1,
                text,
            },
        }, this.projectPath);
    }
    /** 通知服务器文档已修改 */
    async didChange(uri, contentChanges) {
        if (!this.running)
            return;
        const lspLang = LANG_MAP[this.getLanguage()];
        if (!lspLang)
            return;
        await window.api.lspNotify(lspLang, 'textDocument/didChange', {
            textDocument: {
                uri: toLspUri(uri),
                version: Date.now(),
            },
            contentChanges: contentChanges.map(c => ({ text: c.text })),
        }, this.projectPath);
    }
    /** 通知服务器文档已关闭 */
    async didClose(uri) {
        if (!this.running)
            return;
        const lspLang = LANG_MAP[this.getLanguage()];
        if (!lspLang)
            return;
        diagnosticsMap.delete(uri.toString());
        await window.api.lspNotify(lspLang, 'textDocument/didClose', {
            textDocument: { uri: toLspUri(uri) },
        }, this.projectPath);
    }
    /** 停止服务器并卸载 Provider */
    async stop() {
        if (!this.running)
            return;
        const lspLang = LANG_MAP[this.language];
        if (!lspLang)
            return;
        window.api.offLspMessage();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        await window.api.lspStop(lspLang, this.projectPath);
        this.running = false;
        console.log(`[LSP] ${lspLang} 客户端已停止`);
    }
    getLanguage() {
        return this.language;
    }
    // ── 私有方法 ──
    /** 处理来自服务器的消息 */
    handleServerMessage(data) {
        const msg = data.message;
        if (msg.type === 'diagnostics') {
            this.applyDiagnostics(msg.uri, msg.diagnostics);
        }
    }
    /** 应用诊断标记到 Monaco */
    applyDiagnostics(uri, lspDiagnostics) {
        const markers = lspDiagnostics.map((d) => ({
            severity: d.severity === 1 ? monaco.MarkerSeverity.Error
                : d.severity === 2 ? monaco.MarkerSeverity.Warning
                    : d.severity === 3 ? monaco.MarkerSeverity.Info
                        : monaco.MarkerSeverity.Hint,
            message: d.message,
            startLineNumber: (d.range?.start?.line ?? 0) + 1,
            startColumn: (d.range?.start?.character ?? 0) + 1,
            endLineNumber: (d.range?.end?.line ?? 0) + 1,
            endColumn: (d.range?.end?.character ?? 0) + 1,
            code: d.code?.value || d.code,
            source: d.source || 'LSP',
        }));
        // 存储诊断供 Problems 面板查询
        diagnosticsMap.set(uri, markers);
        // 应用诊断到对应的 Monaco 模型
        const models = monaco.editor.getModels();
        const targetModel = models.find(m => m.uri.toString() === uri);
        if (targetModel) {
            monaco.editor.setModelMarkers(targetModel, 'lsp', markers);
        }
        // 通知 Problems 面板刷新
        window.dispatchEvent(new CustomEvent('lsp-diagnostics-changed', { detail: { uri, count: markers.length } }));
    }
    /** 注册所有 LSP Provider */
    registerProviders(lspLang) {
        const langId = this.language;
        // 1. 补全 Provider
        const completionProvider = monaco.languages.registerCompletionItemProvider(langId, {
            triggerCharacters: ['.', ' ', '(', '[', '"', "'", '/'],
            provideCompletionItems: async (model, position, context) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/completion', {
                        textDocument: { uri: toLspUri(model.uri) },
                        position: toLspPosition(position),
                        context: { triggerKind: context.triggerKind, triggerCharacter: context.triggerCharacter },
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return { suggestions: [] };
                    const result = resp.result;
                    const items = (result.items || []).map((item) => ({
                        label: item.label,
                        kind: this.lspCompletionKind(item.kind),
                        detail: item.detail,
                        documentation: item.documentation?.value || item.documentation,
                        insertText: item.insertText || item.textEdit?.newText || item.label,
                        range: item.textEdit?.range ? fromLspRange(item.textEdit.range) : undefined,
                        sortText: item.sortText,
                        filterText: item.filterText,
                        insertTextRules: item.insertTextFormat === 2 ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
                    }));
                    return {
                        suggestions: items,
                        incomplete: result.isIncomplete || false,
                    };
                }
                catch (e) {
                    console.error(`[LSP] completion error:`, e);
                    return { suggestions: [] };
                }
            },
        });
        this.disposables.push(completionProvider);
        // 2. 悬停 Provider
        const hoverProvider = monaco.languages.registerHoverProvider(langId, {
            provideHover: async (model, position) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/hover', {
                        textDocument: { uri: toLspUri(model.uri) },
                        position: toLspPosition(position),
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return null;
                    const result = resp.result;
                    const contents = [];
                    if (typeof result.contents === 'string') {
                        contents.push({ value: result.contents });
                    }
                    else if (Array.isArray(result.contents)) {
                        result.contents.forEach((c) => {
                            if (typeof c === 'string') {
                                contents.push({ value: c });
                            }
                            else if (c.value) {
                                contents.push({ value: c.value });
                            }
                        });
                    }
                    else if (result.contents?.value) {
                        contents.push({ value: result.contents.value });
                    }
                    const range = result.range ? fromLspRange(result.range) : undefined;
                    return { contents, range };
                }
                catch (e) {
                    return null;
                }
            },
        });
        this.disposables.push(hoverProvider);
        // 3. 定义 Provider
        const defProvider = monaco.languages.registerDefinitionProvider(langId, {
            provideDefinition: async (model, position) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/definition', {
                        textDocument: { uri: toLspUri(model.uri) },
                        position: toLspPosition(position),
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return [];
                    const result = resp.result;
                    const locations = [];
                    const addLocation = (loc) => {
                        const uri = monaco.Uri.parse(loc.uri);
                        locations.push({
                            uri,
                            range: fromLspRange(loc.range),
                        });
                    };
                    if (Array.isArray(result)) {
                        result.forEach(addLocation);
                    }
                    else if (result.uri) {
                        addLocation(result);
                    }
                    return locations;
                }
                catch (e) {
                    return [];
                }
            },
        });
        this.disposables.push(defProvider);
        // 4. 引用 Provider
        const refProvider = monaco.languages.registerReferenceProvider(langId, {
            provideReferences: async (model, position, _context) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/references', {
                        textDocument: { uri: toLspUri(model.uri) },
                        position: toLspPosition(position),
                        context: { includeDeclaration: true },
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return [];
                    const result = resp.result;
                    return result.map((loc) => ({
                        uri: monaco.Uri.parse(loc.uri),
                        range: fromLspRange(loc.range),
                    }));
                }
                catch (e) {
                    return [];
                }
            },
        });
        this.disposables.push(refProvider);
        // 5. Document Symbol Provider (代码大纲)
        const symProvider = monaco.languages.registerDocumentSymbolProvider(langId, {
            provideDocumentSymbols: async (model) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/documentSymbol', {
                        textDocument: { uri: toLspUri(model.uri) },
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return [];
                    const result = resp.result;
                    return result.map((sym) => this.convertSymbol(sym));
                }
                catch (e) {
                    return [];
                }
            },
        });
        // ⚠️ 不 push，符号 Provider 可能有多个并存
        // 6. 签名帮助 Provider
        const sigProvider = monaco.languages.registerSignatureHelpProvider(langId, {
            signatureHelpTriggerCharacters: ['(', ','],
            signatureHelpRetriggerCharacters: [','],
            provideSignatureHelp: async (model, position, _token, _context) => {
                try {
                    const resp = await window.api.lspRequest(lspLang, 'textDocument/signatureHelp', {
                        textDocument: { uri: toLspUri(model.uri) },
                        position: toLspPosition(position),
                    }, this.projectPath);
                    if (!resp.success || !resp.result)
                        return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => { } };
                    const result = resp.result;
                    return {
                        value: {
                            activeSignature: result.activeSignature ?? 0,
                            activeParameter: result.activeParameter ?? 0,
                            signatures: (result.signatures || []).map((s) => ({
                                label: s.label,
                                documentation: s.documentation?.value || s.documentation,
                                parameters: (s.parameters || []).map((p) => ({
                                    label: p.label,
                                    documentation: p.documentation?.value || p.documentation,
                                })),
                            })),
                        },
                        dispose: () => { },
                    };
                }
                catch (e) {
                    return { value: { signatures: [], activeSignature: 0, activeParameter: 0 }, dispose: () => { } };
                }
            },
        });
        this.disposables.push(sigProvider);
        console.log(`[LSP] ${langId} Provider 已注册 (completion + hover + definition + references + signature)`);
    }
    /** LSP CompletionItemKind → Monaco CompletionItemKind */
    lspCompletionKind(kind) {
        // LSP CompletionItemKind
        const map = {
            1: monaco.languages.CompletionItemKind.Text,
            2: monaco.languages.CompletionItemKind.Method,
            3: monaco.languages.CompletionItemKind.Function,
            4: monaco.languages.CompletionItemKind.Constructor,
            5: monaco.languages.CompletionItemKind.Field,
            6: monaco.languages.CompletionItemKind.Variable,
            7: monaco.languages.CompletionItemKind.Class,
            8: monaco.languages.CompletionItemKind.Interface,
            9: monaco.languages.CompletionItemKind.Module,
            10: monaco.languages.CompletionItemKind.Property,
            11: monaco.languages.CompletionItemKind.Unit,
            12: monaco.languages.CompletionItemKind.Value,
            13: monaco.languages.CompletionItemKind.Enum,
            14: monaco.languages.CompletionItemKind.Keyword,
            15: monaco.languages.CompletionItemKind.Snippet,
            16: monaco.languages.CompletionItemKind.Color,
            17: monaco.languages.CompletionItemKind.File,
            18: monaco.languages.CompletionItemKind.Reference,
            19: monaco.languages.CompletionItemKind.Folder,
            20: monaco.languages.CompletionItemKind.EnumMember,
            21: monaco.languages.CompletionItemKind.Constant,
            22: monaco.languages.CompletionItemKind.Struct,
            23: monaco.languages.CompletionItemKind.Event,
            24: monaco.languages.CompletionItemKind.Operator,
            25: monaco.languages.CompletionItemKind.TypeParameter,
        };
        return map[kind ?? 1] || monaco.languages.CompletionItemKind.Text;
    }
    /** 递归转换 LSP DocumentSymbol 为 Monaco DocumentSymbol */
    convertSymbol(sym) {
        return {
            name: sym.name,
            detail: sym.detail || '',
            kind: this.lspSymbolKind(sym.kind),
            tags: sym.tags || [],
            range: fromLspRange(sym.range),
            selectionRange: fromLspRange(sym.selectionRange),
            children: (sym.children || []).map((c) => this.convertSymbol(c)),
        };
    }
    lspSymbolKind(kind) {
        const map = {
            1: monaco.languages.SymbolKind.File,
            2: monaco.languages.SymbolKind.Module,
            3: monaco.languages.SymbolKind.Namespace,
            4: monaco.languages.SymbolKind.Package,
            5: monaco.languages.SymbolKind.Class,
            6: monaco.languages.SymbolKind.Method,
            7: monaco.languages.SymbolKind.Property,
            8: monaco.languages.SymbolKind.Field,
            9: monaco.languages.SymbolKind.Constructor,
            10: monaco.languages.SymbolKind.Enum,
            11: monaco.languages.SymbolKind.Interface,
            12: monaco.languages.SymbolKind.Function,
            13: monaco.languages.SymbolKind.Variable,
            14: monaco.languages.SymbolKind.Constant,
            15: monaco.languages.SymbolKind.String,
            16: monaco.languages.SymbolKind.Number,
            17: monaco.languages.SymbolKind.Boolean,
            18: monaco.languages.SymbolKind.Array,
            19: monaco.languages.SymbolKind.Object,
            20: monaco.languages.SymbolKind.Key,
            21: monaco.languages.SymbolKind.Null,
            22: monaco.languages.SymbolKind.EnumMember,
            23: monaco.languages.SymbolKind.Struct,
            24: monaco.languages.SymbolKind.Event,
            25: monaco.languages.SymbolKind.Operator,
            26: monaco.languages.SymbolKind.TypeParameter,
        };
        return map[kind] || monaco.languages.SymbolKind.Variable;
    }
}
// ── 导出工厂 ──
const clients = new Map();
/** 获取或创建 LSP 客户端 */
function getLspClient(language) {
    let client = clients.get(language);
    if (!client) {
        client = new LspClient(language);
        clients.set(language, client);
    }
    return client;
}
/** 停止所有客户端 */
async function stopAllLspClients() {
    for (const [lang, client] of clients) {
        await client.stop();
    }
    clients.clear();
}
/** 文档打开时调用 */
async function lspDidOpen(uri, language, text) {
    const client = getLspClient(language);
    await client.didOpen(uri, language, text);
}
/** 文档修改时调用 */
async function lspDidChange(uri, language, changes) {
    const client = getLspClient(language);
    await client.didChange(uri, changes);
}
/** 文档关闭时调用 */
async function lspDidClose(uri, language) {
    const client = getLspClient(language);
    await client.didClose(uri);
}
/** 获取某语言的诊断信息 */
function getDiagnostics(uri) {
    return diagnosticsMap.get(uri) || [];
}
/** 获取所有语言的诊断信息 */
function getAllDiagnostics() {
    const all = [];
    diagnosticsMap.forEach(markers => all.push(...markers));
    return all;
}
