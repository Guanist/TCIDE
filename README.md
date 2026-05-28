# 🐅 虎猫 TCIDE — 个人专属超级 AI 编程 IDE

**把 AI 工程师装进你的 IDE，用对话驱动完整项目开发**

> Builder → Coder → Compile → Deploy，全链路自动化

---

## ✨ 核心理念

**虎猫 TCIDE** 不是又一个「套壳 ChatGPT」的编辑器。它内置了一套完整的 **Builder + Coder 双 Agent 协作引擎**，真正做到了：

> 🧠 Builder Agent 读需求 → 📋 拆解任务 → 💻 Coder Agent 写代码 → ✅ 编译验证 → 🔄 自动提交

你只需要说「帮我做一个 xxx」，剩下的设计、编码、编译、提交全由虎猫完成。

---

## 🎯 功能速览

### 🤖 AI 双 Agent 引擎

| Agent | 职责 | 输入 | 输出 |
|-------|------|------|------|
| **Builder** | 需求分析 & 任务拆解 | 自然语言需求 | 结构化任务列表 |
| **Coder** | 代码生成 & 编译验证 | 单个任务 | 代码 diff + 编译结果 |

- 自动读取项目上下文（文件树、打开文件、代码结构）
- 编译失败自动获取错误日志并修复
- 大文件智能分治：`/read N-M` 按行范围读取
- 多模型支持：DeepSeek / 火山方舟 / Ollama / 自定义 OpenAI API

### 🎨 双主题切换

| 主题 | 风格 |
|------|------|
| 🐯 老虎（暗色） | 深黑 `#1E1E1E`，Monaco `trae-dark` |
| 🐅 白虎（亮色） | 纯白 `#FFFFFF`，Monaco `trae-light` |

### 📂 文件管理

- 文件树：24+ 种 emoji 文件夹图标 + 40+ 文件类型 PNG 图标
- 递归文件监听（`fs.watch` + 500ms 去抖）
- 右键菜单：重命名、删除

### ✏️ 代码编辑器（Monaco）

- 23 种语言语法高亮 + Minimap
- Git Diff 行标记（绿色新增 / 橙色修改）
- 自动保存（2 秒去抖）+ 状态栏脏标记
- 多标签页切换 + 标签页激活下划线动画

### 📄 文件预览

| 格式 | 预览方式 |
|------|---------|
| PDF | iframe Blob URL |
| DOCX | EOCD 定位 ZIP 中央目录 |
| DOC | 二进制文本提取（OLE） |
| HTML / XML | iframe srcdoc 渲染 + 源码双模式 |
| SVG | Blob URL iframe |
| 二进制 | Hex 查看器（offset + hex + ASCII） |

### 🔀 Git 集成

- 状态面板：分支名、变更文件、状态图标
- Diff 行标记：编辑器左侧绿色/橙色竖线
- 一键 Stage → Commit → Push
- Coder Agent 编译成功后自动提交

### 💬 智能对话

- 对话列表：创建 / 删除（二次确认）/ 重命名
- 会话持久化到项目 `.tcide/chat/sessions.json`
- AI 响应自动扫描 `/read N-M` 指令，弹出确认卡片
- `/file` 命令生成文件结构大纲

### 🖥️ 终端

- xterm.js 多标签终端
- 标签切换 / 关闭自动重建
- 底部拖拽调整面板高度

### 🏗️ 架构分析器

- 导入依赖分析 + 依赖图生成
- 代码异味检测

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/Guanist/TCIDE/releases) 下载最新版：

- **安装版**：`TCIDE-1.1.0-x64.exe`（NSIS 安装器）
- **便携版**：`TCIDE-1.1.0-portable.exe`（免安装，即开即用）

### 开发环境

```bash
git clone https://github.com/Guanist/TCIDE.git
cd TCIDE
npm install
npm run dev
npm run dist
```

### 技术栈

| 层 | 技术 |
|----|------|
| 框架 | Electron 33 |
| 编辑器 | Monaco Editor |
| 终端 | xterm.js |
| 构建 | TypeScript + Vite + electron-builder |
| AI 协议 | OpenAI-compatible API |

---

## ⚙️ 配置 AI 模型

| 服务商 | 需要填写 |
|--------|---------|
| **DeepSeek** | API Key (`sk-xxx`) |
| **火山方舟** | API Key (`ark-xxx`) + Endpoint ID (`ep-xxx`) |
| **Ollama** | 本地模型名 |
| **自定义** | Base URL + API Key + Model |

---

## 🧩 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+W` | 关闭当前文件 |
| `Ctrl+Tab` | 切换到下一个文件 |
| `Ctrl+P` | 快速打开文件搜索 |
| `Ctrl+,` | 打开设置 |

---

## 📁 项目结构

```
TCIDE/
├── src/
│   ├── core/
│   │   ├── agent/          # Builder & Coder Agent 引擎
│   │   ├── arch/           # 架构分析器
│   │   └── model/          # 模型适配器 & 元数据
│   ├── main/               # Electron 主进程
│   └── renderer/           # 渲染进程 UI
├── resources/              # 图标 / 品牌素材
├── scripts/                # 构建脚本
└── package.json
```

---

## 📝 License

MIT © Guanist, Inc.
