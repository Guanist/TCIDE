/**
 * PersonalIDE - Model Adapter
 * 统一模型适配层：DeepSeek / Ollama / 自定义 OpenAI 兼容接口
 */
export interface ModelConfig {
    provider: 'deepseek' | 'ollama' | 'custom';
    model: string;
    baseUrl: string;
    apiKey: string;
    builderModel?: string;
    coderModel?: string;
}
export interface SendOptions {
    model?: string;
    stream?: boolean;
    onChunk?: (chunk: string) => void;
    signal?: AbortSignal;
    temperature?: number;
    maxTokens?: number;
}
export declare class ModelAdapter {
    private config;
    constructor(config: ModelConfig);
    send(messages: Array<{
        role: string;
        content: string;
    }>, options?: SendOptions): Promise<string>;
    private sendOpenAICompatible;
    private sendOllama;
}
