# 🐯 虎猫 TCIDE — 更新日志

## v1.5.1 (2026-05-30) — 体验打磨

### 🆕 新增功能
- 🐯 **虎猫思考动画**：发送消息后显示虎猫弹跳 + 阶段指示（分析中→调用工具中→深度思考），用户不再觉得「没反应」
- 📊 **AI 统计栏**：聊天上方实时显示 `🔧 工具调用 N 次 · 🧠 深度思考 N 次`
- 📦 **长代码块折叠**：>10 行的代码块默认折叠为 ~8 行高度，点击「展开 ▼ (N行)」查看全部
- 💾 **关闭保存提示**：关闭有未保存修改的文件时，弹出「保存/不保存」确认对话框
- 🏷️ **活动栏标签**：左侧图标改为垂直图标+功能名称布局（文件/搜索/Git/架构/问题/主题）
- 🔧 **MCP 工具开关视觉反馈**：开启时按钮有橙色背景光晕
- 🧹 **对话全选/清空**：多选模式增加「全选」和「清空全部」按钮

### 🐛 Bug 修复
- **AI 回复内容丢失**：`stopStreaming()` 在读取 `currentStreamContent` 前就清空了它，导致保存的 content 始终为空串。修复：先读后清
- **用户消息重复**：`addChatMessage` 已推送用户消息，`sendToAI` 又推了一次。修复：移除冗余 push。此 Bug 影响所有对话路径
- **AI 回复频繁中断**：流式请求未传 `max_tokens`，API 服务商默认值过低。修复：OpenAI 兼容路径默认 `max_tokens: 8192`
- **Chunker 异常崩溃**：`chunkFile()` 在 IO/编码错误时抛出未捕获异常。修复：添加 try/catch 降级为简单按行分片

### 🎨 体验优化
- `showConfirm` 支持自定义按钮文字和取消回调
- 首次对话自动命名（此前因重复推送 count=2 从未触发）

---

## v1.5.0-p0 (2026-05-30) — 全模块交付

### 🆕 P0 核心能力（8模块）
- **DebugManager**：断点/变量/调用栈/控制台面板，15 个 IPC 通道
- **LintManager**：ESLint → Monaco 波浪线 + 问题面板 + 状态栏角标，8 个 IPC 通道
- **SemanticChunker**：大文件按 AST 边界智能分片预览，6 个 IPC 通道
- **ContextTrimmer**：对话压缩/Token 预算自适应，8 个 IPC 通道
- **AutoHealManager**：编译错误自动解析 + 修复提案，2 个 IPC 通道
- **BatchModifier**：批量搜索替换 + Diff 预览 + 回滚，8 个 IPC 通道
- **PerfOptimizer**：性能指标采集 + GC 清扫，3 个 IPC 通道
- **快捷键配置**：可定制快捷键系统

### 🆕 P1 智能增强（4模块）
- **GitIntelligence**：智能 Commit 消息生成 + Blame/Diff 可视化
- **ProjectMemory**：对话记忆管理 + 上下文窗口优化
- **VectorIndexer**：全项目向量嵌入索引
- **SemanticCompletion**：上下文感知代码补全

### 🆕 P2 工程能力（3模块）
- **AgentOrchestrator**：Builder + Coder 双 Agent 编排调度
- **WarehouseAnalyzer**：项目元数据 + 依赖图 + 调用链分析
- **UnattendedRunner**：代码执行沙箱 + 步骤跟踪

### 🆕 P3 质量保障（3模块）
- **EntropyEvaluator**：代码复杂度/耦合度评估
- **EntropyController**：定时健康检查 + 会话建议
- **SmartTrimmer**：智能上下文修剪策略引擎

### 🔌 基础设施
- 57 个 IPC 通道全部接通（Main ↔ Renderer）
- 397 行 Preload 桥接代码
- TypeScript 类型声明补全全部 P0-P3 API

### 🐛 Bug 修复
- 图片关闭时残留在编辑区
- 版本记录 Tab 无法打开

---

## v1.4.0 (2026-05-30) — 专业完备

### 🆕 新增功能
- 🧠 LSP 语言服务：TS/JS 内置 + Python pyright + 5 语言自动检测
- ⚠️ Problems 面板：实时诊断、按严重度排序、点击跳转
- 📐 分屏编辑器：双 Monaco 实例
- ⚡ Emmet 展开：Tab 触发、HTML/CSS/JSX
- 📦 Snippets 系统：50+ 预置片段（7 语言）
- 🔧 MCP 工具集成：9 内置工具、AI function calling
- 🌿 Git 分支切换：下拉选择
- ⌨️ 快捷键编辑器：可视化 CRUD
- 🔀 Git Blame：行内作者标注

---

## v1.3.0 (2026-05-30) — 智能加持

### 🆕 新增功能
- 📝 模板系统：5 内置模板（React/Express/Python/Go/Kotlin）
- 🎭 AI 角色系统：4 内置角色（开发/审查/架构师/测试）
- 🔍 项目级搜索（Ctrl+Shift+F）：跨文件正则搜索
- 🏠 欢迎页：最近项目列表、一键打开
- 🔔 Toast 通知系统
- 🩺 自诊断引擎：规则检测代码异味

---

## v1.2.0 (2026-05-30) — 专业进化

### 🆕 新增功能
- 📋 代码大纲面板（Ctrl+Shift+O）：6 语言符号提取
- ⌨️ 命令面板（Ctrl+Shift+P）：21 内置命令、模糊搜索
- 🧘 Zen Mode（Ctrl+Shift+Z）：全屏专注
- 🖥️ 终端流式输出：spawn + xterm.js 增量渲染
- 🧠 上下文管理器：CLAUDE.md 编码规范

---

## v1.1.0 (2026-05-28) — 全面升级

### 🆕 新增功能
- 🎨 双主题切换（老虎暗色/白虎亮色）
- 🔀 Git 面板：Status / Diff / Stage → Commit → Push
- 📄 文件预览：PDF / DOCX / HTML / SVG / Hex
- 💬 对话管理：删除 / 重命名 / 会话持久化
- 🖥️ xterm.js 多标签终端
- 🤖 AI 自动读取协议 + /file / /lines 命令
- 🏗️ 架构分析器：依赖分析 + 代码异味检测

---

## v1.0.0 (2026-05-26) — 虎猫诞生

### 🆕 首发功能
- ⚡ Electron 三进程架构（Main / Renderer / Preload）
- ✏️ Monaco Editor：23 种语言语法高亮
- 🤖 AI 双 Agent 引擎：Builder 需求拆分 + Coder 代码执行
- 🔌 DeepSeek / Ollama / Anthropic / 自定义 OpenAI 多模型支持
- 📂 文件树 + 拖拽面板 + 右键菜单
- 🗄️ SQLite 项目索引 & Schema 理解
- 🎨 暗色主题（Trae 风格）+ 虎猫品牌
- 🖼️ 三栏布局：文件树 / 编辑器 / AI 面板
