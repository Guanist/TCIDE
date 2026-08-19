# 虎猫 TCIDE — 个人专属 AI 编程 IDE

> Builder → Coder → Compile → Deploy

[![Release](https://img.shields.io/github/v/release/Guanist/TCIDE?color=ff8c00)](https://github.com/Guanist/TCIDE/releases)
[![License](https://img.shields.io/badge/license-GPLv3-blue.svg)](LICENSE)

## 分支说明

| 分支 | 说明 | 技术栈 |
|------|------|--------|
| **main** | TypeScript Electron 桌面版 | Electron 33 + TypeScript + Monaco + xterm.js + Vite + SQLite |
| **tcide-py** | Python 重写版 | Python 3.11 + FastAPI + PyWebView + Monaco (CDN) |

- `main` 是主要开发分支，包含完整 Electron 桌面 IDE
- `tcide-py` 是 Python 重写版，独立仓库内容，通过 `git checkout tcide-py` 切换

## 核心差异

虎猫 TCIDE 内置 **Builder + Coder 双 Agent 协作引擎**：

> Builder 读需求 → 拆解任务 → Coder 写代码 → 编译验证 → 自动提交

你只需要说「帮我做一个 xxx」，剩下的设计、编码、编译、提交全由虎猫完成。

## AI 双 Agent

| Agent | 职责 |
|-------|------|
| **Builder** | 需求分析、架构设计、任务拆解 |
| **Coder** | 代码生成、编译验证、错误修复 |

- 自动读取项目上下文，编译失败自动修复重试
- 多模型：DeepSeek / 火山方舟 / Ollama / Anthropic / OpenAI

## 特色

- **像素宠物** — 桌面虎猫精灵，实时显示 AI 状态
- **自动编程循环** — /task 命令一键全自动开发
- **项目记忆** — 技术栈、编码风格自动学习
- **代码熵评估** — 复杂度/重复度/耦合度监控
- **智能上下文** — Token 预算自适应
- **Git 智能** — 自动生成 Conventional Commit

## 基础能力

Monaco Editor + LSP、文件树、搜索、Git、xterm.js 终端、文件预览、Emmet、Snippets、暗色主题、Zen Mode

## 快速开始

### TS 版（main 分支）

```bash
git clone https://github.com/Guanist/TCIDE.git
cd TCIDE
npm install
npm run build
npm run dist:portable
```

### Python 版（tcide-py 分支）

```bash
git clone -b tcide-py https://github.com/Guanist/TCIDE.git
cd TCIDE
pip install -r requirements.txt
python main.py
```

## 许可证

[GNU General Public License v3.0](LICENSE)
