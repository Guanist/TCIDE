"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;

const fs = require('fs');
const path = require('path');

// ==================== 全局配置 ====================
const MAX_CONTEXT_TOKEN = 50000;
const KEEP_RECENT_DIALOGS = 3;
const MAX_DEPEND_FILES = 3;

class ContextManager {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.staticContextPath = path.join(projectRoot, '.tcide/context/static.md');
    this.dialogHistoryPath = path.join(projectRoot, '.tcide/chat/sessions.json');
    this.claudeRulesPath = path.join(projectRoot, 'CLAUDE.md');
    this._initDirAndFile();
  }

  /**
   * 初始化目录与基础文件
   */
  _initDirAndFile() {
    const staticDir = path.dirname(this.staticContextPath);
    if (!fs.existsSync(staticDir)) {
      fs.mkdirSync(staticDir, { recursive: true });
    }
    if (!fs.existsSync(this.staticContextPath)) {
      fs.writeFileSync(
        this.staticContextPath,
        '# 项目静态上下文\n技术栈：\n整体架构：\n核心模块说明：\n全局编码规范：\n'
      );
    }

    const chatDir = path.dirname(this.dialogHistoryPath);
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    }
    if (!fs.existsSync(this.dialogHistoryPath)) {
      fs.writeFileSync(this.dialogHistoryPath, JSON.stringify([], null, 2));
    }
  }

  /**
   * 简易 Token 估算
   */
  _estimateToken(text) {
    const cnChars = [...text].filter(c => /[\u4e00-\u9fff]/.test(c)).length;
    const enChars = text.length - cnChars;
    return Math.floor(cnChars / 2 + enChars / 4);
  }

  /**
   * 读取静态上下文 + 全局CLAUDE规则（合并为长期缓存内容）
   */
  getFullStaticContext() {
    let staticContent = '';
    if (fs.existsSync(this.staticContextPath)) {
      staticContent = fs.readFileSync(this.staticContextPath, 'utf8');
    }

    let ruleContent = '';
    if (fs.existsSync(this.claudeRulesPath)) {
      ruleContent = fs.readFileSync(this.claudeRulesPath, 'utf8');
    }

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
      const raw = fs.readFileSync(this.dialogHistoryPath, 'utf8');
      const history = JSON.parse(raw);
      return Array.isArray(history) ? history.slice(-KEEP_RECENT_DIALOGS) : [];
    } catch (e) {
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
    fs.writeFileSync(this.dialogHistoryPath, JSON.stringify(trimmed, null, 2), 'utf8');
  }

  /**
   * 加载当前文件 + 限制数量的依赖文件代码
   */
  getRelevantCode(currentFile, dependFiles = []) {
    let codeCtx = '';

    if (fs.existsSync(currentFile)) {
      const code = fs.readFileSync(currentFile, 'utf8');
      codeCtx += `【当前文件：${path.basename(currentFile)}】\n${code}\n\n`;
    }

    const limitedDeps = dependFiles.slice(0, MAX_DEPEND_FILES);
    limitedDeps.forEach((file, idx) => {
      if (fs.existsSync(file)) {
        const code = fs.readFileSync(file, 'utf8');
        codeCtx += `【依赖文件 ${idx + 1}：${path.basename(file)}】\n${code}\n\n`;
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

    let dialogCtx = '';
    dialogHistory.forEach(item => {
      dialogCtx += `用户：${item.user}\nAI：${item.assistant}\n`;
    });

    let finalPrompt = `${staticCtx}

【最近会话记录】
${dialogCtx}

【代码上下文】
${codeCtx}

【当前任务】
${userInput}`.trim();

    let tokenCount = this._estimateToken(finalPrompt);
    if (tokenCount > MAX_CONTEXT_TOKEN) {
      const cutRatio = MAX_CONTEXT_TOKEN / tokenCount;
      finalPrompt = finalPrompt.substring(0, Math.floor(finalPrompt.length * cutRatio));
      tokenCount = this._estimateToken(finalPrompt);
    }

    return { prompt: finalPrompt, tokenCount };
  }
}

exports.ContextManager = ContextManager;
