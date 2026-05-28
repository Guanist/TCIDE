# 🐅 虎猫 TCIDE — 个人专属超级 AI 编程 IDE

<p align="center">
  <img src="resources/brand/brand-texture.png" alt="虎猫 TCIDE" width="320" />
</p>

<p align="center">
  <strong>把 AI 工程师装进你的 IDE，用对话驱动完整项目开发</strong><br>
  <em>Builder → Coder → Compile → Deploy，全链路自动化</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-orange" alt="version" />
  <img src="https://img.shields.io/badge/platform-Windows-blue" alt="platform" />
  <img src="https://img.shields.io/badge/electron-33-black" alt="electron" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license" />
</p>

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

| | 🐯 老虎（暗色） | 🐅 白虎（亮色） |
|------|---|---|
| IDE 背景 | 深黑 `#1E1E1E` | 纯白 `#FFFFFF` |
| 编辑器 | Monaco `trae-dark` 主题 | Monaco `trae-light` 主题 |
| 强调色 | 虎猫橙 `#FF8C00` | 暗橙 `#E67E00` |
| 切换 | 左下角 ☀️ 一键切换 | 偏好自动持久化 |

### 📂 文件管理

- 文件树：24+ 种 emoji 文件夹图标 + 40+ 文件类型 PNG 图标
- 递归文件监听（`fs.watch` + 500ms 去抖）
- 右键菜单：重命名、删除
- 拖拽窗口边框调整面板大小

### ✏️ 代码编辑器（Monaco）

- 23 种语言语法高亮 + Minimap
- Git Diff 行标记（绿色新增 / 橙色修改）
- 自动保存（2 秒去抖） + 状态栏脏标记
- 多标签页切换 + 标签页激活下划线动画
- 行号引导线 / 焦点环橙色 / 圆角滚动条

### 📄 文件预览

| 格式 | 预览方式 |
|------|---------|
| PDF | iframe Blob URL（`atob` → `Uint8Array` → `Blob`） |
| DOCX | EOCD 定位 ZIP 中央目录 + stored/deflate 双模式解压 |
| DOC | 二进制文本提取（OLE 格式） |
| HTML / XML | iframe `srcdoc` 渲染 + 源码双模式切换 |
| SVG | Blob URL iframe 渲染 |
| 图片 | 直接 `<img>` 显示 |
| 二进制 | Hex 查看器（offset + hex + ASCII） |

### 🔀 Git 集成

- 状态面板：分支名、变更文件、M/A/D/U 着色图标
- Diff 行标记：编辑器左侧绿色/橙色竖线
- 一键 Stage → Commit → Push
- Coder Agent 编译成功后自动提交

### 💬 智能对话

- 对话列表：创建 / 删除（二次确认） / 重命名
- 会话持久化到项目 `.tcide/chat/sessions.json`
- AI 响应自动扫描 `/read N-M` 指令，弹出确认卡片
- `/file` 命令生成文件结构大纲
- `/lines N-M` 精确行范围读取

### 🖥️ 终端

- xterm.js 多标签终端
- 标签切换 / 关闭自动重建
- 底部拖拽调整面板高度
- 保留各标签命令历史（`cmdBuffer`）

### 🏗️ 架构分析器

- 导入依赖分析 + 依赖图生成
- 代码异味检测
- 侧边栏可视化面板

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/Guanist/TCIDE/releases) 下载最新版：

- **安装版**：`TCIDE-1.1.0-x64.exe`（NSIS 安装器）
- **便携版**：`TCIDE-1.1.0-portable.exe`（免安装，即开即用）

### 开发环境

```bash
# 克隆仓库
git clone https://github.com/Guanist/TCIDE.git
cd TCIDE

# 安装依赖
npm install

# 开发模式
npm run dev

# 构建打包
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
| 运行时 | Node.js 22 |

---

## ⚙️ 配置 AI 模型

打开 TCIDE → 右上角 ⚙️ 设置 → 选择模型服务商：

| 服务商 | 需要填写 | 示例 |
|--------|---------|------|
| **DeepSeek** | API Key | `sk-xxxx` |
| **火山方舟** | API Key + Endpoint ID | Key: `ark-xxx`, Model: `ep-xxx` |
| **Ollama** | 本地模型名 | `qwen2.5:7b` |
| **自定义** | Base URL + API Key + Model | 任意 OpenAI 兼容接口 |

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
│   │   ├── ipc-handlers.ts # IPC 通信
│   │   ├── preload.ts      # 安全桥接
│   │   └── store.ts        # 配置持久化
│   └── renderer/           # 渲染进程 UI
│       ├── index.html      # 主布局
│       ├── main.ts         # 全部 UI 逻辑
│       └── styles/         # 样式表
├── resources/              # 图标 / 品牌素材
├── release/                # 打包产物
└── package.json
```

---

## 🧩 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+W` | 关闭当前文件 |
| `Ctrl+Tab` | 切换到下一个文件 |
| `Ctrl+Shift+Tab` | 切换到上一个文件 |
| `Ctrl+P` | 快速打开文件搜索 |
| `Ctrl+,` | 打开设置 |
| `Ctrl+Shift+I` | 展开/收起 AI 面板 |

---

## 📝 License

MIT © Guanist, Inc.

---

<p align="center">
  <sub>Built with ❤️ by AI Engineer Agent · 虎猫 🐅</sub>
</p>
