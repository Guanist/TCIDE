# 🐯 虎猫 TCIDE — 个人专属超级 AI 编程 IDE

**把 AI 工程师装进你的 IDE，用对话驱动完整项目开发**

> Builder → Coder → Compile → Deploy，全链路自动化

[![Release](https://img.shields.io/github/v/release/Guanist/TCIDE?color=ff8c00)](https://github.com/Guanist/TCIDE/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

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
- 多模型支持：DeepSeek V4 / 火山方舟 / Ollama / Anthropic Claude / 自定义 OpenAI API

### 🎨 界面设计

| 特性 | 说明 |
|------|------|
| 🐯/🐅 双主题 | 老虎暗色 + 白虎亮色，Monaco 编辑器联动 |
| 🏷️ 活动栏 | 图标+功能名称垂直布局（文件/搜索/Git/架构/问题） |
| 📂 文件树 | 24+ emoji 文件夹图标 + 40+ 文件类型图标 + 递归监听 |
| 🐯 思考动画 | 虎猫弹跳 + 阶段文字（分析中→工具调用→深度思考） |
| 📊 AI 统计栏 | 实时显示工具调用次数 + 深度思考次数 |

### ✏️ 代码编辑器（Monaco）

- 23 种语言语法高亮 + Minimap
- LSP 语言服务：TS/JS 内置 + Python pyright + 5 语言自动检测
- Git Diff 行标记（绿色新增 / 橙色修改）+ Blame 行内标注
- 自动保存（2 秒去抖）+ 状态栏脏标记
- 多标签页切换 + 拖拽排序 + 右键菜单
- 分屏编辑器：双 Monaco 实例、Ctrl+\ 垂直 / Alt+2 水平
- Emmet 展开：Tab 触发、HTML/CSS/JSX
- Snippets 系统：50+ 预置片段（7 语言）

### 📄 文件预览

| 格式 | 预览方式 |
|------|---------|
| 🖼️ 图片 | PNG/JPG/GIF/WebP/BMP 内联预览 |
| 🎬 视频/音频 | MP4/WebM/MP3/WAV 媒体播放器 |
| PDF | iframe Blob URL |
| DOCX | EOCD 定位 ZIP 中央目录 |
| HTML / XML / SVG | iframe srcdoc 渲染 + 源码双模式 |
| 二进制 | Hex 查看器（offset + hex + ASCII） |

### 📦 代码块能力

- 长代码块（>10行）默认折叠为 ~8 行，展开/收起按钮
- 📂 在编辑器中打开 / 👁 预览 / ▶ 运行 / 💾 保存到项目 / 📋 复制

### 🔀 Git 集成

- 状态面板：分支名、变更文件、状态图标
- Diff 行标记：编辑器左侧绿色/橙色竖线
- 一键 Stage → Commit → Push
- 分支切换下拉选择
- Coder Agent 编译成功后自动提交

### 💬 AI 对话

- 对话列表：创建 / 删除 / 重命名（双击编辑）
- 会话持久化到项目 `.tcide/chat/sessions.json` + electron-store
- 全选 / 删除所选 / 清空全部 多选操作
- `/file` 命令发送文件（超大文件自动生成大纲）
- `/lines N-M` 命令发送指定行范围
- `/task` 命令：Builder → Coder 自动执行循环
- 代码块保存提示：关闭修改文件时弹出保存确认

### 🖥️ 终端

- xterm.js 多标签终端
- spawn 流式输出、增量渲染
- 标签切换 / 关闭自动重建
- 底部拖拽调整面板高度

### 🔧 工程能力

- **问题面板**：实时诊断、按严重度排序、点击跳转
- **调试面板**：断点/变量/调用栈/控制台
- **架构分析**：依赖图、代码异味检测、入口点分析
- **命令面板**（Ctrl+Shift+P）：21 内置命令、模糊搜索
- **Zen Mode**（Ctrl+Shift+Z）：全屏专注
- **代码大纲**（Ctrl+Shift+O）：符号提取、树形渲染
- **模板系统**：5 内置模板 + 自定义创建
- **快捷键编辑器**：可视化 CRUD、冲突检测
- **项目级搜索**（Ctrl+Shift+F）：跨文件正则搜索

---

## 📦 P0-P3 模块矩阵

### P0 核心能力（8模块）
| 模块 | 功能 |
|------|------|
| DebugManager | 断点/变量/调用栈/控制台面板 |
| LintManager | ESLint→Monaco波浪线+问题面板+角标 |
| SemanticChunker | 大文件AST边界智能分片 |
| ContextTrimmer | 对话压缩/Token预算自适应 |
| AutoHealManager | 编译错误自动解析+修复提案 |
| BatchModifier | 批量替换+Diff预览+一键回滚 |
| PerfOptimizer | 性能指标采集+GC清扫 |
| Keybindings | 可定制快捷键系统 |

### P1 智能增强（4模块）
| 模块 | 功能 |
|------|------|
| GitIntelligence | 智能Commit+Blame/Diff可视化 |
| ProjectMemory | 对话记忆+上下文窗口优化 |
| VectorIndexer | 全项目向量嵌入索引 |
| SemanticCompletion | 上下文感知代码补全 |

### P2 工程能力（3模块）
| 模块 | 功能 |
|------|------|
| AgentOrchestrator | Builder+Coder双Agent编排 |
| WarehouseAnalyzer | 元数据+依赖图+调用链 |
| UnattendedRunner | 沙箱执行+步骤跟踪 |

### P3 质量保障（3模块）
| 模块 | 功能 |
|------|------|
| EntropyEvaluator | 代码复杂度/耦合度评估 |
| EntropyController | 定时健康检查+会话建议 |
| SmartTrimmer | 智能上下文修剪策略 |

---

## 🚀 快速开始

### 下载安装

从 [Releases](https://github.com/Guanist/TCIDE/releases) 下载最新版：

- **安装版**：NSIS 安装器，含卸载程序和桌面快捷方式
- **便携版**：免安装，即开即用

### 开发环境

```bash
git clone https://github.com/Guanist/TCIDE.git
cd TCIDE
npm install
npm run build
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 编辑器 | Monaco Editor (VS Code 同款) |
| 终端 | xterm.js |
| 存储 | electron-store + SQLite |
| 构建 | Vite + electron-builder (NSIS) |
| 语言 | TypeScript / JavaScript |

---

## 📋 版本历史

### v1.5.1 (2026-05-30) — 体验打磨
- 🐯 虎猫思考动画: 弹跳虎猫 + 阶段指示
- 📊 AI统计栏: 实时工具调用/深度思考计数
- 📦 长代码块自动折叠 + 展开/收起
- 💾 关闭修改文件保存确认
- 🔧 MCP工具开关视觉反馈
- 🐛 修复: AI回复内容丢失 / 用户消息重复 / 回复中断

### v1.5.0-p0 (2026-05-30) — 全模块交付
- 🏗️ P0-P3 十八模块一次投产
- 🔌 57个IPC通道全通 + 397行Preload
- 📂 图片/视频/音频预览
- 📋 版本记录时间线
- 🏷️ 活动栏图标+名称布局
- 🧹 对话多选/全选/清空

### v1.4.0 (2026-05-30) — 专业完备
- 🧠 LSP 多语言服务（TS/JS/Python/5语言）
- ⚠️ Problems 面板
- 📐 分屏编辑器
- ⚡ Emmet 展开
- 📦 Snippets 系统
- 🔧 MCP 工具集成（9内置工具）

### v1.3.0 (2026-05-30) — 智能加持
- 📝 模板系统（5内置+自定义）
- 🎭 AI 角色系统
- 🔍 项目级搜索
- 🏠 欢迎页（最近项目）
- 🔔 Toast 通知系统
- 🩺 自诊断引擎

### v1.2.0 (2026-05-30) — 专业进化
- 📋 代码大纲面板
- ⌨️ 命令面板（21命令）
- 🧘 Zen Mode
- 🖥️ 终端流式输出
- 🧠 上下文管理器

### v1.1.0 (2026-05-28) — 全面升级
- 🎨 双主题切换
- 🔀 Git 集成
- 📄 文件预览（PDF/DOCX/HTML/SVG/Hex）
- 💬 对话管理
- 🖥️ xterm.js 多标签终端
- 🤖 AI 自动读取协议

### v1.0.0 (2026-05-26) — 虎猫诞生
- Electron 三进程架构
- Monaco Editor（23语言）
- AI 双 Agent 引擎
- 多模型支持
- 文件树 + 暗色主题

---

## 📊 项目统计

| 指标 | 数值 |
|------|------|
| 总代码行数 | 7,000+ 行 (src/) |
| TypeScript 模块 | 33+ |
| IPC 通道 | 57 |
| 支持文件格式 | 40+ 预览类型 |
| 支持编程语言 | 23+ 语法高亮 |
| LSP 语言 | 7 语言自动检测 |

---

## 🙏 致谢

- **Monaco Editor** — 微软开源编辑器内核
- **xterm.js** — 终端模拟器
- **Electron** — 跨平台桌面框架
- **Vite** — 下一代构建工具
- **DeepSeek / 火山方舟 / Anthropic** — AI 模型提供商

---

由 [Guanist, Inc.](https://github.com/guanist) 开发 | 作者：文森特骆 | 公众号：文森特骆
