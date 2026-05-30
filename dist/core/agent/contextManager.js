"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ==================== 全局配置 ====================
const MAX_CONTEXT_TOKEN = 50000;
const KEEP_RECENT_DIALOGS = 3;
const MAX_DEPEND_FILES = 3;
class ContextManager {
    projectRoot;
    staticContextPath;
    dialogHistoryPath;
    claudeRulesPath;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
        // 项目静态上下文路径
        this.staticContextPath = path_1.default.join(projectRoot, '.tcide/context/static.md');
        // 会话历史存储路径
        this.dialogHistoryPath = path_1.default.join(projectRoot, '.tcide/chat/sessions.json');
        // 全局规则文件路径
        this.claudeRulesPath = path_1.default.join(projectRoot, 'CLAUDE.md');
        this.initDirAndFile();
    }
    /**
     * 初始化目录与基础文件
     */
    initDirAndFile() {
        // 初始化静态上下文目录
        const staticDir = path_1.default.dirname(this.staticContextPath);
        if (!fs_1.default.existsSync(staticDir)) {
            fs_1.default.mkdirSync(staticDir, { recursive: true });
        }
        if (!fs_1.default.existsSync(this.staticContextPath)) {
            fs_1.default.writeFileSync(this.staticContextPath, `# 项目静态上下文\n技术栈：\n整体架构：\n核心模块说明：\n全局编码规范：\n`);
        }
        // 初始化会话文件目录
        const chatDir = path_1.default.dirname(this.dialogHistoryPath);
        if (!fs_1.default.existsSync(chatDir)) {
            fs_1.default.mkdirSync(chatDir, { recursive: true });
        }
        if (!fs_1.default.existsSync(this.dialogHistoryPath)) {
            fs_1.default.writeFileSync(this.dialogHistoryPath, JSON.stringify([], null, 2));
        }
    }
    /**
     * 简易 Token 估算（中文/英文混合场景工程可用）
     */
    estimateToken(text) {
        const cnChars = [...text].filter(c => /[\u4e00-\u9fff]/.test(c)).length;
        const enChars = text.length - cnChars;
        return Math.floor(cnChars / 2 + enChars / 4);
    }
    /**
     * 读取静态上下文 + 全局CLAUDE规则（合并为长期缓存内容）
     */
    getFullStaticContext() {
        // 1. 读取项目自身静态配置
        let staticContent = '';
        if (fs_1.default.existsSync(this.staticContextPath)) {
            staticContent = fs_1.default.readFileSync(this.staticContextPath, 'utf8');
        }
        // 2. 读取全局编程&节流规则
        let ruleContent = '';
        if (fs_1.default.existsSync(this.claudeRulesPath)) {
            ruleContent = fs_1.default.readFileSync(this.claudeRulesPath, 'utf8');
        }
        // 合并并标记静态缓存，适配DeepSeek缓存机制
        return `【静态缓存-项目长期记忆&全局规则】
${staticContent}

--- 全局执行规则 ---
${ruleContent}
【静态缓存结束】`;
    }
    /**
     * 读取并截断会话历史，仅保留最近N轮
     */
    getTrimmedDialogHistory() {
        try {
            const raw = fs_1.default.readFileSync(this.dialogHistoryPath, 'utf8');
            const history = JSON.parse(raw);
            return Array.isArray(history) ? history.slice(-KEEP_RECENT_DIALOGS) : [];
        }
        catch (e) {
            return [];
        }
    }
    /**
     * 保存单轮会话记录，并自动截断
     */
    saveDialogue(userMsg, assistantMsg) {
        const history = this.getTrimmedDialogHistory();
        history.push({ user: userMsg, assistant: assistantMsg });
        const trimmed = history.slice(-KEEP_RECENT_DIALOGS);
        fs_1.default.writeFileSync(this.dialogHistoryPath, JSON.stringify(trimmed, null, 2), 'utf8');
    }
    /**
     * 加载当前文件 + 限制数量的依赖文件代码
     */
    getRelevantCode(currentFile, dependFiles = []) {
        let codeCtx = '';
        // 当前编辑文件
        if (fs_1.default.existsSync(currentFile)) {
            const code = fs_1.default.readFileSync(currentFile, 'utf8');
            codeCtx += `【当前文件：${path_1.default.basename(currentFile)}】\n${code}\n\n`;
        }
        // 限制依赖文件最大数量
        const limitedDeps = dependFiles.slice(0, MAX_DEPEND_FILES);
        limitedDeps.forEach((file, idx) => {
            if (fs_1.default.existsSync(file)) {
                const code = fs_1.default.readFileSync(file, 'utf8');
                codeCtx += `【依赖文件 ${idx + 1}：${path_1.default.basename(file)}】\n${code}\n\n`;
            }
        });
        return codeCtx;
    }
    /**
     * 组装最终请求上下文，超限自动截断
     */
    buildFinalPrompt(userInput, currentFile, dependFiles = []) {
        const staticCtx = this.getFullStaticContext();
        const dialogHistory = this.getTrimmedDialogHistory();
        const codeCtx = this.getRelevantCode(currentFile, dependFiles);
        // 拼接短期对话
        let dialogCtx = '';
        dialogHistory.forEach(item => {
            dialogCtx += `用户：${item.user}\nAI：${item.assistant}\n`;
        });
        // 整体上下文拼接
        let finalPrompt = `${staticCtx}

【最近会话记录】
${dialogCtx}

【代码上下文】
${codeCtx}

【当前任务】
${userInput}`.trim();
        // Token 超限截断（优先保留静态内容与代码，裁剪末尾对话/提问）
        let tokenCount = this.estimateToken(finalPrompt);
        if (tokenCount > MAX_CONTEXT_TOKEN) {
            const cutRatio = MAX_CONTEXT_TOKEN / tokenCount;
            finalPrompt = finalPrompt.substring(0, Math.floor(finalPrompt.length * cutRatio));
            tokenCount = this.estimateToken(finalPrompt);
        }
        return { prompt: finalPrompt, tokenCount };
    }
}
exports.ContextManager = ContextManager;
