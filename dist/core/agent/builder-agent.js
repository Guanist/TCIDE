"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuilderAgent = void 0;
const BUILDER_SYSTEM_PROMPT = `你是虎猫 TCIDE 的 AI 架构师，运行在用户的本地开发环境中。你拥有对项目的完整读写权限，可以分析源码、创建文件、执行终端命令。

你需要将用户需求拆分为具体的开发任务，以 JSON 数组格式输出。

严格遵循以下输出格式，不要输出任何解释，只输出 JSON 数组：

严格遵循以下输出格式，不要输出任何解释，只输出 JSON 数组：
[
  {
    "id": "1",
    "desc": "任务描述",
    "dep": ["前置任务ID"],
    "files": ["涉及的文件路径"],
    "priority": 1
  }
]

规则：
1. 每个任务的 id 必须是唯一的数字字符串
2. dep 数组列出该任务依赖的其他任务 ID（无依赖则为空数组）
3. files 数组列出该任务会涉及的文件路径
4. 优先输出没有依赖或依赖已解决的任务（用于并行执行）
5. 请根据项目现有代码结构和架构合理拆分任务
6. 对于 Android/Kotlin 项目，自动考虑 Gradle 模块和 Jetpack 组件`;
const BUILDER_REASONING_PROMPT = `请按以下分层步骤思考：
1. 【影响范围分析】：该需求影响哪些模块/类/函数？现有架构能否直接扩展？
2. 【架构决策】：需要新建文件还是修改现有文件？是否需要新的依赖？
3. 【任务拆分】：按什么顺序执行可以最大化并行度？哪些必须串行？
4. 【风险评估】：这个方案可能引入哪些副作用？需要额外测试吗？`;
class BuilderAgent {
    model;
    constructor(model) {
        this.model = model;
    }
    async run(requirement, projectContext) {
        // 构造四层上下文 Prompt
        const contextText = this.buildContextPrompt(projectContext);
        const messages = [
            { role: 'system', content: BUILDER_SYSTEM_PROMPT },
            { role: 'system', content: BUILDER_REASONING_PROMPT },
            { role: 'user', content: `项目上下文：\n${contextText}\n\n用户需求：${requirement}` },
        ];
        const options = {
            stream: false,
            temperature: 0.3,
            maxTokens: 4096,
        };
        const response = await this.model.send(messages, options);
        // 提取 JSON 数组
        return this.parseTaskList(response);
    }
    buildContextPrompt(context) {
        const parts = [];
        if (context && typeof context === 'object') {
            const ctx = context;
            if (ctx.fileTree) {
                parts.push('## 文件树结构\n' + JSON.stringify(ctx.fileTree, null, 2));
            }
            if (ctx.symbolIndex) {
                parts.push('## 符号索引\n' + JSON.stringify(ctx.symbolIndex, null, 2));
            }
            if (ctx.projectType) {
                parts.push(`## 项目类型\n${ctx.projectType}`);
            }
            if (ctx.modules) {
                parts.push('## 模块信息\n' + JSON.stringify(ctx.modules, null, 2));
            }
        }
        return parts.join('\n\n') || '（暂无上下文，请根据需求自行分析项目结构）';
    }
    parseTaskList(response) {
        // 尝试多种方式提取 JSON
        let jsonStr = response.trim();
        // 去除 markdown 代码块包裹
        const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
            jsonStr = codeBlockMatch[1];
        }
        // 去除前后可能存在的非 JSON 字符
        const jsonStart = jsonStr.indexOf('[');
        const jsonEnd = jsonStr.lastIndexOf(']');
        if (jsonStart !== -1 && jsonEnd !== -1) {
            jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
        }
        try {
            const raw = JSON.parse(jsonStr);
            if (Array.isArray(raw)) {
                return raw.map((item, idx) => ({
                    id: String(item.id ?? (idx + 1)),
                    desc: String(item.desc ?? item.description ?? ''),
                    dep: Array.isArray(item.dep) ? item.dep : [],
                    files: Array.isArray(item.files) ? item.files : [],
                    status: 'pending',
                    retries: 0,
                }));
            }
        }
        catch {
            // JSON 解析失败，尝试正则提取
        }
        // 正则兜底：提取所有 {"id": ..., "desc": ...} 模式
        const tasks = [];
        const taskRegex = /\{[^{}]*"id"\s*:\s*"?(\d+)"?[^{}]*"desc"\s*:\s*"([^"]*)"/g;
        let match;
        while ((match = taskRegex.exec(jsonStr)) !== null) {
            tasks.push({
                id: match[1],
                desc: match[2],
                dep: [],
                files: [],
                status: 'pending',
                retries: 0,
            });
        }
        if (tasks.length === 0) {
            throw new Error(`Builder 无法解析任务列表。原始响应：\n${response.slice(0, 500)}`);
        }
        return tasks;
    }
}
exports.BuilderAgent = BuilderAgent;
