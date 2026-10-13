# TCIDE-Py — 虎猫 AI 编程 IDE（Python 版）

[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

虎猫 TCIDE 的 Python 重写版，基于 FastAPI + PyWebView + Monaco Editor。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面窗口 | PyWebView |
| 后端 | FastAPI + uvicorn |
| 前端 | Monaco Editor + xterm.js（CDN 加载） |
| AI | OpenAI 兼容 API / Anthropic / Ollama |
| Git | GitPython |
| 终端 | subprocess 多实例 |
| LSP | pyright/gopls/rust-analyzer/clangd |
| MCP | JSON-RPC 2.0 stdio transport |

## 快速开始

```bash
pip install -r requirements.txt
python main.py
```

## 目录结构

```
├── main.py              # 入口：PyWebView 窗口 + FastAPI 后台线程
├── server.py            # FastAPI 路由注册（13个API模块）
├── requirements.txt     # Python 依赖
├── api/
│   ├── files.py         # 文件操作（树/读写/搜索/统计）
│   ├── git_ops.py       # Git 操作（status/diff/commit/push/pull/log/branches）
│   ├── terminal.py      # 终端管理（subprocess 多实例）
│   ├── ai.py            # AI 对话 + Agent 调用（流式/工具调用）
│   ├── settings.py      # 设置管理（JSON 持久化）
│   ├── lsp.py           # LSP 客户端（诊断/补全/跳转/格式化）
│   ├── mcp.py           # MCP 外部工具连接（JSON-RPC 2.0）
│   ├── memory.py        # 上下文记忆（技术栈/风格自动检测）
│   ├── vector.py        # 向量索引（TF-IDF + BM25 语义搜索）
│   ├── snapshot.py      # 文件快照（保存/恢复/对比）
│   ├── usage.py         # 用量统计（token/成本/历史）
│   └── debug.py         # 调试工具（断点/表达式求值）
├── agents/
│   ├── builder.py       # Builder Agent：需求分析 → 任务拆解
│   ├── coder.py         # Coder Agent：代码生成 + 自动重试修复
│   ├── reviewer.py      # Reviewer Agent：代码审查
│   └── orchestrator.py  # Orchestrator：Builder→Coder→Reviewer 流水线
├── adapters/
│   └── llm.py           # 多提供商 LLM 适配器（OpenAI/Anthropic/Ollama）
├── core/                # 核心模块（架构/压缩/批处理等）
└── static/
    └── index.html       # IDE 前端（Monaco + xterm + AI 聊天）
```

## 功能

### 核心功能
- 📂 文件树浏览 + 多标签编辑
- 🖥️ xterm.js 终端（WebSocket 交互）
- 💬 AI 对话（流式输出 + 工具调用循环）
- 🤖 Builder + Coder + Reviewer 三 Agent 协作
- 🔀 Git 全操作（status/diff/commit/push/pull/branches）
- ⚙️ 设置管理（AI/编辑器/主题配置）
- 🎨 暗色主题（VS Code 风格）

### 扩展功能
- 🔗 MCP 工具连接（内置 + 外部服务器）
- 📝 LSP 语言服务（诊断/补全/跳转/格式化）
- 🧠 上下文记忆（技术栈/编码风格自动检测）
- 🔍 语义搜索（TF-IDF + BM25 向量索引）
- 📸 文件快照（保存/恢复/版本对比）
- 📊 用量统计（token/成本/历史记录）
- 🐛 调试工具（断点管理/表达式求值）

## 许可证

[GNU General Public License v3.0](LICENSE)

## 关联分支

| 分支 | 说明 |
|------|------|
| **main** | TypeScript Electron 桌面版（稳定基线） |
| **tcide-py** | 本分支 — Python 重写版 |
