"use strict";
/**
 * TCIDE - Model Adapter
 * 统一模型适配层：OpenAI 兼容 / Anthropic Messages / Ollama 三协议
 * 内置 token 用量追踪 + 指数退避重试 + model-meta 动态计费
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelAdapter = void 0;
const model_meta_1 = require("./model-meta");
// ── 重试配置 ──
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;
function retryDelay(attempt) {
    return Math.pow(2, attempt) * RETRY_BASE_MS; // 1s, 2s, 4s
}
function isRetryable(status, body) {
    if (RETRYABLE_STATUS.has(status))
        return true;
    return /rate.?limit|too.?many|overloaded|server.?error/i.test(body.slice(0, 200));
}
class ModelAdapter {
    config;
    projectPath = '';
    projectName = '';
    sessionId = '';
    taskId = '';
    role = 'chat';
    systemRules = '';
    /** 用量记录回调（主进程注入，绕过 ipcRenderer） */
    onUsage = null;
    constructor(config) {
        this.config = config;
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            this.sessionId = crypto.randomUUID();
        }
        else {
            this.sessionId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }
    }
    setProjectInfo(path, name) {
        this.projectPath = path;
        this.projectName = name;
    }
    setContext(taskId, role) {
        this.taskId = taskId;
        this.role = role;
    }
    setSystemRules(rules) {
        this.systemRules = rules.trim();
    }
    // ── API 协议自动检测 ──
    detectApi() {
        if (this.config.api)
            return this.config.api;
        if (this.config.provider === 'ollama')
            return 'ollama';
        // 兼容：检测 baseUrl 是否指向 Anthropic API
        if (/anthropic|claude/i.test(this.config.baseUrl))
            return 'anthropic';
        return 'openai-compatible';
    }
    // ─────────────────────────────────────────
    // 主入口 — 协议路由 + 重试
    // ─────────────────────────────────────────
    async send(messages, options = {}) {
        const finalMessages = this.injectSystemRules(messages);
        const api = this.detectApi();
        const model = options.model || this.config.model;
        const { apiKey } = this.config;
        if (!apiKey && api !== 'ollama') {
            throw new Error('API Key 未配置，请在设置中配置您的 API Key');
        }
        const doSend = () => {
            switch (api) {
                case 'ollama':
                    return this.sendOllama(finalMessages, options);
                case 'anthropic':
                    return this.sendAnthropicMessages(finalMessages, { ...options, model });
                default:
                    return this.sendOpenAICompatible(finalMessages, { ...options, model });
            }
        };
        return this.withRetry(doSend);
    }
    // ── 通用重试包装 ──
    async withRetry(fn) {
        let lastError = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await fn();
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                const status = err.status;
                const body = err.body ?? lastError.message;
                // 非重试错误直接抛
                if (status && !isRetryable(status, body))
                    throw lastError;
                // 用户取消不重试
                if (lastError.name === 'AbortError')
                    throw lastError;
                if (attempt < MAX_RETRIES) {
                    const ms = retryDelay(attempt);
                    console.warn(`[TCIDE] 请求失败，${ms}ms 后重试 (${attempt + 1}/${MAX_RETRIES}):`, lastError.message);
                    await new Promise(r => setTimeout(r, ms));
                }
            }
        }
        throw lastError;
    }
    // ─────────────────────────────────────────
    // 规则注入
    // ─────────────────────────────────────────
    injectSystemRules(messages) {
        if (!this.systemRules)
            return messages;
        const rulesBlock = '\n---\n**项目规则（CLAUDE.md）：**\n' + this.systemRules + '\n---\n';
        const first = messages[0];
        if (first && first.role === 'system') {
            const existingContent = typeof first.content === 'string' ? first.content : first.content.map(c => c.type === 'text' ? c.text : '').join('');
            return [{ ...first, content: rulesBlock + '\n' + existingContent }, ...messages.slice(1)];
        }
        else {
            return [{ role: 'system', content: rulesBlock }, ...messages];
        }
    }
    // ─────────────────────────────────────────
    // OpenAI 兼容接口（DeepSeek / 火山方舟 / 自定义）
    // ─────────────────────────────────────────
    async sendOpenAICompatible(messages, options) {
        const { baseUrl, apiKey } = this.config;
        const { model, stream = false, onChunk, signal, temperature, maxTokens } = options;
        const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
        const startTime = Date.now();
        const body = {
            messages,
            stream,
            ...(model && { model }), // 允许空 model（火山方舟 endpoint key 自带端点）
            ...(temperature !== undefined && { temperature }),
            max_tokens: maxTokens || 8192,  // 默认 8192，避免 API 服务商默认值过低导致回复截断
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal,
        });
        if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 402 || /insufficient|quota|余额|欠费|balance/i.test(errorText)) {
                this.emitBalanceWarning(errorText);
            }
            const err = new Error(`API 请求失败 (${response.status}): ${errorText.slice(0, 500)}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }
        if (stream) {
            return this.parseOpenAISSE(response, onChunk, startTime);
        }
        else {
            const json = await response.json();
            if (json.usage) {
                this.recordTokenUsage(json.usage.prompt_tokens || 0, json.usage.completion_tokens || 0, Date.now() - startTime);
            }
            return json.choices?.[0]?.message?.content ?? '';
        }
    }
    /** OpenAI 格式 SSE 解析 */
    async parseOpenAISSE(response, onChunk, startTime = 0) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        let lastUsage = null;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]')
                    continue;
                try {
                    const json = JSON.parse(data);
                    const content = json.choices?.[0]?.delta?.content;
                    if (content) {
                        fullContent += content;
                        onChunk?.(content);
                    }
                    if (json.usage)
                        lastUsage = json.usage;
                }
                catch { /* skip */ }
            }
        }
        if (lastUsage) {
            this.recordTokenUsage(lastUsage.prompt_tokens || 0, lastUsage.completion_tokens || 0, Date.now() - startTime);
        }
        return fullContent;
    }
    // ─────────────────────────────────────────
    // Anthropic Messages API
    // ─────────────────────────────────────────
    async sendAnthropicMessages(messages, options) {
        const { baseUrl, apiKey } = this.config;
        const { model, stream = false, onChunk, signal, temperature, maxTokens } = options;
        const url = `${baseUrl.replace(/\/$/, '')}/messages`;
        const startTime = Date.now();
        // Anthropic 把 system 提示词放在顶层 system 字段，非 messages 数组
        const systemParts = messages.filter(m => m.role === 'system').map(m => m.content);
        const convMessages = messages
            .filter(m => m.role !== 'system')
            .map(m => ({ role: m.role, content: m.content }));
        const body = {
            model,
            max_tokens: maxTokens || 8192,
            messages: convMessages,
            stream,
            ...(systemParts.length > 0 && { system: systemParts.join('\n\n') }),
            ...(temperature !== undefined && { temperature }),
        };
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify(body),
            signal,
        });
        if (!response.ok) {
            const errorText = await response.text();
            const err = new Error(`Anthropic API 失败 (${response.status}): ${errorText.slice(0, 500)}`);
            err.status = response.status;
            err.body = errorText;
            throw err;
        }
        if (stream) {
            return this.parseAnthropicSSE(response, onChunk, startTime);
        }
        else {
            const json = await response.json();
            const text = json.content?.filter(c => c.type === 'text').map(c => c.text).join('') ?? '';
            if (json.usage) {
                this.recordTokenUsage(json.usage.input_tokens || 0, json.usage.output_tokens || 0, Date.now() - startTime);
            }
            return text;
        }
    }
    /** Anthropic 格式 SSE 解析 */
    async parseAnthropicSSE(response, onChunk, startTime = 0) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        let inputTokens = 0;
        let outputTokens = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            // Anthropic SSE 格式：event: xxx\ndata: {...}\n\n
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            for (const event of events) {
                const lines = event.split('\n');
                let eventType = '';
                let dataStr = '';
                for (const line of lines) {
                    if (line.startsWith('event: '))
                        eventType = line.slice(7).trim();
                    if (line.startsWith('data: '))
                        dataStr = line.slice(6).trim();
                }
                if (!dataStr)
                    continue;
                try {
                    const json = JSON.parse(dataStr);
                    switch (eventType) {
                        case 'content_block_delta':
                            const text = json.delta?.text;
                            if (text) {
                                fullContent += text;
                                onChunk?.(text);
                            }
                            break;
                        case 'message_start':
                            if (json.message?.usage) {
                                inputTokens = json.message.usage.input_tokens || 0;
                            }
                            break;
                        case 'message_delta':
                            outputTokens = json.usage?.output_tokens || 0;
                            break;
                        case 'error':
                            throw new Error(json.error?.message || 'Anthropic stream error');
                    }
                }
                catch (err) {
                    if (err instanceof Error && err.message.includes('error'))
                        throw err;
                    /* skip parse errors */
                }
            }
        }
        if (inputTokens > 0 || outputTokens > 0) {
            this.recordTokenUsage(inputTokens, outputTokens, Date.now() - startTime);
        }
        return fullContent;
    }
    // ─────────────────────────────────────────
    // Ollama（本地模型）
    // ─────────────────────────────────────────
    async sendOllama(messages, options) {
        const baseUrl = this.config.baseUrl || 'http://localhost:11434';
        const model = options.model || this.config.model || 'llama3.2';
        const { stream = false, onChunk, signal } = options;
        const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, stream }),
            signal,
        });
        if (!response.ok) {
            throw new Error(`Ollama 请求失败 (${response.status}): ${response.statusText}`);
        }
        if (stream) {
            return this.parseOllamaStream(response, onChunk);
        }
        else {
            const json = await response.json();
            return json.message?.content ?? '';
        }
    }
    async parseOllamaStream(response, onChunk) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullContent = '';
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.trim())
                    continue;
                try {
                    const json = JSON.parse(line);
                    const content = json.message?.content;
                    if (content) {
                        fullContent += content;
                        onChunk?.(content);
                    }
                }
                catch { /* skip */ }
            }
        }
        return fullContent;
    }
    // ─────────────────────────────────────────
    // Token 用量 + 余额警告
    // ─────────────────────────────────────────
    recordTokenUsage(inputTokens, outputTokens, durationMs) {
        if (this.config.provider === 'ollama')
            return;
        // 从注册表查找模型费用（找不到降级到默认价格）
        const cost = model_meta_1.modelRegistry.getCost(this.config.provider, this.config.model);
        const inputPrice = cost?.input ?? 0.3;
        const outputPrice = cost?.output ?? 0.6;
        const costRmb = +(inputTokens / 1_000_000 * inputPrice + outputTokens / 1_000_000 * outputPrice).toFixed(6);
        const rec = {
            timestamp: Date.now(),
            projectPath: this.projectPath,
            projectName: this.projectName,
            model: this.config.model,
            provider: this.config.provider,
            inputTokens,
            outputTokens,
            costRmb,
            durationMs,
            sessionId: this.sessionId,
            taskId: this.taskId,
            role: this.role,
        };
        if (this.onUsage) {
            try {
                this.onUsage(rec);
                return;
            }
            catch (e) {
                console.error('[TCIDE] onUsage 失败:', e);
            }
        }
        try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('record-usage', rec);
        }
        catch { /* main process — no ipcRenderer */ }
    }
    emitBalanceWarning(detail) {
        try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('show-balance-warning', detail);
        }
        catch { /* main process */ }
    }
    // ─────────────────────────────────────────
    // 测试连接
    // ─────────────────────────────────────────
    async testConnection() {
        const { baseUrl, apiKey, model, provider } = this.config;
        const api = this.detectApi();
        const startTime = Date.now();
        try {
            if (api === 'ollama') {
                const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
                const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
                const latency = Date.now() - startTime;
                if (!res.ok)
                    return { success: false, message: `Ollama 连接失败 (HTTP ${res.status})`, latencyMs: latency };
                const data = await res.json();
                const models = data.models?.map((m) => m.name).join(', ') || '无';
                return { success: true, message: `连接成功，可用模型: ${models}`, latencyMs: latency };
            }
            if (api === 'anthropic') {
                const url = `${baseUrl.replace(/\/$/, '')}/messages`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                    },
                    body: JSON.stringify({
                        model,
                        max_tokens: 10,
                        messages: [{ role: 'user', content: 'ping' }],
                    }),
                    signal: AbortSignal.timeout(15000),
                });
                const latency = Date.now() - startTime;
                if (!res.ok) {
                    let errMsg = `HTTP ${res.status}`;
                    try {
                        errMsg = (await res.json()).error?.message || errMsg;
                    }
                    catch { }
                    return { success: false, message: `Anthropic 接口: ${errMsg}`, latencyMs: latency };
                }
                return { success: true, message: `连接成功 (延迟 ${latency}ms)`, latencyMs: latency };
            }
            // OpenAI 兼容
            const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 10 }),
                signal: AbortSignal.timeout(15000),
            });
            const latency = Date.now() - startTime;
            if (!res.ok) {
                let errMsg = `HTTP ${res.status}`;
                try {
                    errMsg = (await res.json()).error?.message || errMsg;
                }
                catch { }
                if (res.status === 402 || res.status === 429 || /insufficient|quota|余额|欠费|balance/i.test(errMsg)) {
                    return { success: false, message: `余额不足: ${errMsg}`, latencyMs: latency };
                }
                return { success: false, message: `接口错误: ${errMsg}`, latencyMs: latency };
            }
            return { success: true, message: `连接成功 (延迟 ${latency}ms)`, latencyMs: latency };
        }
        catch (err) {
            return { success: false, message: err.message, latencyMs: Date.now() - startTime };
        }
    }
}
exports.ModelAdapter = ModelAdapter;
