"use strict";
/**
 * TCIDE LSP Manager — 语言服务器进程管理
 *
 * Phase 2: 外部 LSP 服务器集成
 * - 使用 vscode-jsonrpc 进行 JSON-RPC 2.0 通信
 * - 通过 IPC 桥接到渲染进程的 Monaco Editor
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
exports.lspManager = void 0;
const child_process_1 = require("child_process");
const path = __importStar(require("path"));
// ── 服务器配置表 ──
const LSP_CONFIGS = {
    python: {
        language: 'python',
        command: 'npx',
        args: ['pyright-langserver', '--stdio'],
    },
    go: {
        language: 'go',
        command: 'gopls',
        args: [],
    },
    rust: {
        language: 'rust',
        command: 'rust-analyzer',
        args: [],
    },
    cpp: {
        language: 'cpp',
        command: 'clangd',
        args: [],
    },
    java: {
        language: 'java',
        command: 'jdtls',
        args: [],
    },
    bash: {
        language: 'bash',
        command: 'bash-language-server',
        args: ['start'],
    },
};
// ── LSP 协议常量 ──
const CRLF = '\r\n';
function filePathToURI(fp) {
    return 'file:///' + fp.replace(/\\/g, '/').replace(/^([A-Z]):/, (_, d) => d.toLowerCase() + '%3A');
}
// ── Manager ──
class LspManager {
    servers = new Map();
    /** 回调: 当语言服务器发送消息时触发 (诊断、进度等) */
    onServerMessage = null;
    /** 检查某语言的服务器是否可用 */
    isAvailable(language) {
        const config = LSP_CONFIGS[language];
        // pyright 通过 npx 运行，始终可用
        if (language === 'python')
            return true;
        const cmd = config.command;
        const searchPaths = this.getSearchPaths(language, cmd);
        for (const searchPath of searchPaths) {
            try {
                const whichCmd = process.platform === 'win32'
                    ? `where "${searchPath}" 2>nul`
                    : `which "${searchPath}" 2>/dev/null || command -v "${searchPath}" 2>/dev/null`;
                const result = require('child_process').execSync(whichCmd, { timeout: 3000 });
                if (result.toString().trim().length > 0)
                    return true;
            }
            catch { /* continue */ }
        }
        return false;
    }
    /** 获取某语言服务器安装指引 */
    getInstallGuide(language) {
        const guides = {
            python: 'pip install pyright 或已在项目中',
            go: 'go install golang.org/x/tools/gopls@latest',
            rust: 'rustup component add rust-analyzer',
            cpp: '下载 LLVM (https://llvm.org) 或 pip install clangd',
            java: '下载 Eclipse JDTLS (https://download.eclipse.org/jdtls/)',
            bash: 'npm install -g bash-language-server',
        };
        return guides[language] || '请安装对应语言服务器';
    }
    /** 获取常见安装搜索路径 */
    getSearchPaths(language, cmd) {
        const paths = [cmd];
        const home = process.env.USERPROFILE || process.env.HOME || '~';
        switch (language) {
            case 'go': {
                const gopath = process.env.GOPATH || `${home}/go`;
                paths.push(`${gopath}/bin/${cmd}`, `${home}/go/bin/${cmd}`);
                break;
            }
            case 'rust': {
                paths.push(`${home}/.cargo/bin/${cmd}`, `${home}/.rustup/toolchains/stable-x86_64-pc-windows-msvc/${cmd}.exe`);
                break;
            }
            case 'cpp': {
                paths.push('C:\\Program Files\\LLVM\\bin\\clangd.exe', '/usr/bin/clangd', '/usr/local/bin/clangd');
                break;
            }
            case 'bash': {
                const appdata = process.env.APPDATA || '';
                if (appdata)
                    paths.push(`${appdata}\\npm\\${cmd}.cmd`);
                paths.push(`${home}/.npm-global/bin/${cmd}`);
                break;
            }
        }
        return paths;
    }
    /** 启动语言服务器 */
    async startServer(language, projectPath) {
        // 如果已有同语言同项目的服务器，先停止
        const key = `${language}:${projectPath}`;
        await this.stopServer(language, projectPath);
        const config = LSP_CONFIGS[language];
        if (!config)
            throw new Error(`不支持的语言: ${language}`);
        console.log(`[LSP] 启动 ${language} 服务器...`);
        // 使用 child_process.spawn
        const proc = (0, child_process_1.spawn)(config.command, config.args, {
            cwd: projectPath,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...(config.env || {}) },
        });
        const state = {
            process: proc,
            config,
            projectPath,
            pendingRequests: new Map(),
            nextId: 1,
            buffer: '',
        };
        proc.on('error', (err) => {
            console.error(`[LSP] ${language} 进程错误:`, err.message);
        });
        proc.on('exit', (code, signal) => {
            console.log(`[LSP] ${language} 服务器退出 (code=${code}, signal=${signal})`);
            this.servers.delete(key);
            // 拒绝所有待处理的请求
            state.pendingRequests.forEach(({ reject }) => reject(new Error(`Language server exited with code ${code}`)));
            state.pendingRequests.clear();
        });
        proc.stderr?.on('data', (data) => {
            console.error(`[LSP:${language}:stderr] ${data.toString().trim()}`);
        });
        // ── 解析 stdout 中的 LSP 消息 (Content-Length header + JSON body) ──
        proc.stdout?.on('data', (chunk) => {
            state.buffer += chunk.toString('utf-8');
            while (true) {
                const headerEnd = state.buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1)
                    break;
                // 解析 Content-Length
                const header = state.buffer.substring(0, headerEnd);
                const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
                if (!lengthMatch) {
                    // 无效 header，丢弃
                    state.buffer = state.buffer.substring(headerEnd + 4);
                    continue;
                }
                const contentLength = parseInt(lengthMatch[1], 10);
                const bodyStart = headerEnd + 4;
                const bodyEnd = bodyStart + contentLength;
                if (state.buffer.length < bodyEnd)
                    break; // 等待更多数据
                const bodyStr = state.buffer.substring(bodyStart, bodyEnd);
                state.buffer = state.buffer.substring(bodyEnd);
                try {
                    const msg = JSON.parse(bodyStr);
                    this.handleMessage(state, key, msg);
                }
                catch (e) {
                    console.error(`[LSP:${language}] JSON 解析错误:`, e);
                }
            }
        });
        this.servers.set(key, state);
        // ── 发送 Initialize 请求 ──
        const initResult = await this.sendRequest(state, 'initialize', {
            processId: process.pid,
            rootUri: filePathToURI(projectPath),
            rootPath: projectPath,
            capabilities: {
                textDocument: {
                    completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] } },
                    hover: { contentFormat: ['markdown', 'plaintext'] },
                    definition: { linkSupport: true },
                    references: {},
                    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
                    documentHighlight: {},
                    codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor'] } } },
                    signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
                    publishDiagnostics: { relatedInformation: true, versionSupport: true },
                    synchronization: { dynamicRegistration: true, willSave: false, didSave: true },
                },
                workspace: {
                    symbol: {},
                    configuration: true,
                    workspaceFolders: true,
                },
            },
            initializationOptions: this.getInitializationOptions(language, projectPath),
        });
        console.log(`[LSP] ${language} 服务器就绪 (${initResult.serverInfo?.name || 'unknown'})`);
        // 发送 initialized 通知
        this.sendNotification(state, 'initialized', {});
    }
    /** 停止语言服务器 */
    async stopServer(language, projectPath) {
        const key = projectPath ? `${language}:${projectPath}` : language;
        // 如果没有 projectPath，停止该语言的所有实例
        if (!projectPath) {
            for (const [k, state] of this.servers) {
                if (k.startsWith(language + ':')) {
                    this.killServer(k, state);
                    this.servers.delete(k);
                }
            }
            return;
        }
        const state = this.servers.get(key);
        if (state) {
            this.killServer(key, state);
            this.servers.delete(key);
        }
    }
    /** 获取服务器状态 */
    getStatus(language, projectPath) {
        const key = projectPath ? `${language}:${projectPath}` : language;
        if (!projectPath) {
            for (const [k] of this.servers) {
                if (k.startsWith(language + ':'))
                    return { running: true };
            }
            return { running: false };
        }
        return { running: this.servers.has(key) };
    }
    /** 向服务器发送 LSP 请求并等待响应 */
    sendLspRequest(language, method, params, projectPath) {
        const state = this.findServer(language, projectPath);
        if (!state)
            throw new Error(`LSP server not running for ${language}`);
        return this.sendRequest(state, method, params);
    }
    /** 向服务器发送 LSP 通知 (无响应) */
    sendLspNotification(language, method, params, projectPath) {
        const state = this.findServer(language, projectPath);
        if (!state) {
            console.warn(`[LSP] 跳过通知 ${method}: ${language} 服务器未运行`);
            return;
        }
        this.sendNotification(state, method, params);
    }
    /** 停止所有服务器 */
    shutdownAll() {
        for (const [key, state] of this.servers) {
            try {
                this.sendNotification(state, 'shutdown', {});
                state.process.stdin?.end();
            }
            catch { /* ignore */ }
            this.killServer(key, state);
        }
        this.servers.clear();
    }
    // ── 私有方法 ──
    findServer(language, projectPath) {
        if (projectPath)
            return this.servers.get(`${language}:${projectPath}`);
        // 查找该语言的任何实例
        for (const [k, v] of this.servers) {
            if (k.startsWith(language + ':'))
                return v;
        }
        return undefined;
    }
    killServer(key, state) {
        try {
            state.process.kill();
        }
        catch {
            // 进程可能已经退出
        }
    }
    handleMessage(state, key, msg) {
        if (msg.id !== undefined && msg.id !== null) {
            // 响应消息
            const pending = state.pendingRequests.get(msg.id);
            if (pending) {
                state.pendingRequests.delete(msg.id);
                if (msg.error) {
                    pending.reject(new Error(`LSP Error: ${msg.error.message || JSON.stringify(msg.error)}`));
                }
                else {
                    pending.resolve(msg.result);
                }
            }
        }
        else {
            // 通知消息 (比如 textDocument/publishDiagnostics)
            const lang = key.split(':')[0];
            if (msg.method === 'textDocument/publishDiagnostics') {
                // 特殊处理诊断消息
                const uri = msg.params?.uri;
                const diagnostics = msg.params?.diagnostics || [];
                this.onServerMessage?.(lang, {
                    type: 'diagnostics',
                    uri,
                    diagnostics,
                });
            }
            else if (msg.method === 'window/showMessage' || msg.method === 'window/logMessage') {
                console.log(`[LSP:${lang}] ${msg.params?.message || JSON.stringify(msg.params)}`);
            }
            // 转发所有通知
            this.onServerMessage?.(lang, { type: 'notification', method: msg.method, params: msg.params });
        }
    }
    sendRequest(state, method, params) {
        return new Promise((resolve, reject) => {
            const id = state.nextId++;
            state.pendingRequests.set(id, { resolve, reject });
            const message = JSON.stringify({ jsonrpc: '2.0', id, method, params });
            const payload = `Content-Length: ${Buffer.byteLength(message, 'utf-8')}\r\n\r\n${message}`;
            try {
                state.process.stdin?.write(payload);
            }
            catch (e) {
                state.pendingRequests.delete(id);
                reject(e);
            }
            // 30 秒超时
            setTimeout(() => {
                if (state.pendingRequests.has(id)) {
                    state.pendingRequests.delete(id);
                    reject(new Error(`LSP request ${method} timed out`));
                }
            }, 30000);
        });
    }
    sendNotification(state, method, params) {
        const message = JSON.stringify({ jsonrpc: '2.0', method, params });
        const payload = `Content-Length: ${Buffer.byteLength(message, 'utf-8')}\r\n\r\n${message}`;
        try {
            state.process.stdin?.write(payload);
        }
        catch (e) {
            console.error(`[LSP] 发送通知失败 ${method}:`, e);
        }
    }
    getInitializationOptions(language, projectPath) {
        switch (language) {
            case 'python':
                return {
                    typeCheckingMode: 'basic',
                    useLibraryCodeForTypes: true,
                    pythonVersion: '3.11',
                    pythonPlatform: 'All',
                    // 自动检测虚拟环境
                    venvPath: path.join(projectPath, '.venv'),
                    venv: undefined,
                };
            case 'go':
                return {
                    buildFlags: [],
                    env: {},
                };
            case 'rust':
                return {
                    cargo: { allTargets: true },
                    check: { command: 'check', allTargets: true },
                };
            default:
                return {};
        }
    }
}
// ── 单例导出 ──
exports.lspManager = new LspManager();
