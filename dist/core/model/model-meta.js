"use strict";
/**
 * TCIDE - Model Metadata Registry
 * 模型元数据注册表：contextWindow / maxTokens / 费用 / reasoning 能力
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.modelRegistry = exports.ModelRegistry = void 0;
// ─────────────────────────────────────────
// 内置模型注册表
// ─────────────────────────────────────────
const BUILTIN_MODELS = [
    // ── DeepSeek ──
    {
        id: 'deepseek-chat',
        provider: 'deepseek',
        name: 'DeepSeek V3',
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: false,
        cost: { input: 2.0, output: 8.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'deepseek-reasoner',
        provider: 'deepseek',
        name: 'DeepSeek R1',
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: true,
        cost: { input: 4.0, output: 16.0 },
        capabilities: ['text', 'code', 'reasoning'],
        supportsStreaming: true,
    },
    {
        id: 'deepseek-v4-pro',
        provider: 'deepseek',
        name: 'DeepSeek V4 Pro',
        contextWindow: 1000000,
        maxTokens: 384000,
        reasoning: true,
        cost: { input: 2.0, output: 8.0 },
        capabilities: ['text', 'code', 'reasoning'],
        supportsStreaming: true,
    },
    {
        id: 'deepseek-v4-flash',
        provider: 'deepseek',
        name: 'DeepSeek V4 Flash',
        contextWindow: 1000000,
        maxTokens: 384000,
        reasoning: false,
        cost: { input: 0.5, output: 2.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    // ── 火山方舟 / 豆包 (Huoshan / Doubao) ──
    {
        id: 'doubao-lite-32k',
        provider: 'huoshan',
        name: 'Doubao Lite 32K',
        contextWindow: 32768,
        maxTokens: 4096,
        reasoning: false,
        cost: { input: 0.3, output: 0.6 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'doubao-pro-32k',
        provider: 'huoshan',
        name: 'Doubao Pro 32K',
        contextWindow: 32768,
        maxTokens: 4096,
        reasoning: false,
        cost: { input: 0.8, output: 2.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'doubao-pro-128k',
        provider: 'huoshan',
        name: 'Doubao Pro 128K',
        contextWindow: 131072,
        maxTokens: 4096,
        reasoning: false,
        cost: { input: 5.0, output: 9.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'doubao-1-5-pro-256k',
        provider: 'huoshan',
        name: 'Doubao 1.5 Pro 256K',
        contextWindow: 262144,
        maxTokens: 12288,
        reasoning: false,
        cost: { input: 5.0, output: 9.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'doubao-1-5-thinking-pro',
        provider: 'huoshan',
        name: 'Doubao 1.5 Thinking Pro',
        contextWindow: 262144,
        maxTokens: 65536,
        reasoning: true,
        cost: { input: 4.0, output: 16.0 },
        capabilities: ['text', 'code', 'reasoning'],
        supportsStreaming: true,
    },
    {
        id: 'deepseek-v4-pro',
        provider: 'huoshan',
        name: 'DeepSeek V4 Pro (火山方舟)',
        contextWindow: 1000000,
        maxTokens: 384000,
        reasoning: true,
        cost: { input: 1.0, output: 4.0 },
        capabilities: ['text', 'code', 'reasoning'],
        supportsStreaming: true,
    },
    {
        id: 'coding-plan',
        provider: 'huoshan',
        name: '火山引擎 Coding Plan',
        contextWindow: 131072,
        maxTokens: 4096,
        reasoning: false,
        cost: { input: 2.0, output: 8.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    // ── Anthropic (Claude) ──
    {
        id: 'claude-3.5-sonnet',
        provider: 'anthropic',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200000,
        maxTokens: 8192,
        reasoning: false,
        cost: { input: 21.0, output: 105.0 },
        capabilities: ['text', 'code', 'image', 'tool_use'],
        supportsStreaming: true,
    },
    {
        id: 'claude-3.5-haiku',
        provider: 'anthropic',
        name: 'Claude 3.5 Haiku',
        contextWindow: 200000,
        maxTokens: 8192,
        reasoning: false,
        cost: { input: 5.6, output: 28.0 },
        capabilities: ['text', 'code', 'tool_use'],
        supportsStreaming: true,
    },
    {
        id: 'claude-3-opus',
        provider: 'anthropic',
        name: 'Claude 3 Opus',
        contextWindow: 200000,
        maxTokens: 4096,
        reasoning: false,
        cost: { input: 105.0, output: 525.0 },
        capabilities: ['text', 'code', 'image', 'tool_use'],
        supportsStreaming: true,
    },
    {
        id: 'claude-3.7-sonnet',
        provider: 'anthropic',
        name: 'Claude 3.7 Sonnet',
        contextWindow: 200000,
        maxTokens: 8192,
        reasoning: true,
        cost: { input: 21.0, output: 105.0 },
        capabilities: ['text', 'code', 'image', 'tool_use', 'reasoning'],
        supportsStreaming: true,
    },
    // ── OpenAI 兼容通用 ──
    {
        id: 'gpt-4o',
        provider: 'custom',
        name: 'GPT-4o',
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        cost: { input: 17.5, output: 70.0 },
        capabilities: ['text', 'code', 'image', 'tool_use'],
        supportsStreaming: true,
    },
    {
        id: 'gpt-4o-mini',
        provider: 'custom',
        name: 'GPT-4o Mini',
        contextWindow: 128000,
        maxTokens: 16384,
        reasoning: false,
        cost: { input: 1.05, output: 4.2 },
        capabilities: ['text', 'code', 'image'],
        supportsStreaming: true,
    },
    {
        id: 'o3-mini',
        provider: 'custom',
        name: 'O3 Mini',
        contextWindow: 200000,
        maxTokens: 100000,
        reasoning: true,
        cost: { input: 7.7, output: 30.8 },
        capabilities: ['text', 'code', 'reasoning'],
        supportsStreaming: true,
    },
    // ── Qwen (通义千问) ──
    {
        id: 'qwen-plus',
        provider: 'custom',
        name: 'Qwen Plus',
        contextWindow: 131072,
        maxTokens: 8192,
        reasoning: false,
        cost: { input: 2.0, output: 6.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
    {
        id: 'qwen-max',
        provider: 'custom',
        name: 'Qwen Max',
        contextWindow: 32768,
        maxTokens: 8192,
        reasoning: false,
        cost: { input: 20.0, output: 60.0 },
        capabilities: ['text', 'code'],
        supportsStreaming: true,
    },
];
// ─────────────────────────────────────────
// ModelRegistry
// ─────────────────────────────────────────
class ModelRegistry {
    models = [...BUILTIN_MODELS];
    /** 查询模型元数据（provider + model id 精确匹配） */
    lookup(provider, modelId) {
        return this.models.find(m => m.provider === provider && m.id === modelId) ?? null;
    }
    /** 模糊查询：仅 model ID 匹配（跨 provider） */
    lookupById(modelId) {
        return this.models.find(m => m.id === modelId) ?? null;
    }
    /** 按 provider 列出所有已知模型 */
    listByProvider(provider) {
        return this.models.filter(m => m.provider === provider);
    }
    /** 列出所有已注册模型 */
    listAll() {
        return [...this.models];
    }
    /** 注册自定义模型 */
    register(meta) {
        const idx = this.models.findIndex(m => m.provider === meta.provider && m.id === meta.id);
        if (idx >= 0) {
            this.models[idx] = meta;
        }
        else {
            this.models.push(meta);
        }
    }
    /** 获取费用估算（元/1M tokens） */
    getCost(provider, modelId) {
        return this.lookup(provider, modelId)?.cost ?? this.lookupById(modelId)?.cost ?? null;
    }
    /** 获取上下文窗口大小 */
    getContextWindow(provider, modelId) {
        return this.lookup(provider, modelId)?.contextWindow ?? this.lookupById(modelId)?.contextWindow ?? null;
    }
    /** 最大输出 token 数 */
    getMaxTokens(provider, modelId) {
        return this.lookup(provider, modelId)?.maxTokens ?? this.lookupById(modelId)?.maxTokens ?? 4096;
    }
    /** 是否支持 reasoning */
    supportsReasoning(provider, modelId) {
        return this.lookup(provider, modelId)?.reasoning ?? this.lookupById(modelId)?.reasoning ?? false;
    }
}
exports.ModelRegistry = ModelRegistry;
/** 全局单例 */
exports.modelRegistry = new ModelRegistry();
