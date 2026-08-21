# TCIDE TypeScript 版本功能清单

> 基于 main 分支源码分析，生成时间：2026-08-21

---

## 1. 文件操作

### 基础文件 CRUD
- readFile(filePath) - 读取文件内容
- writeFile(filePath, content) - 写入文件内容
- deleteFile(filePath) - 删除文件
- renameFile(oldPath, newPath) - 重命名/移动文件
- createDirectory(dirPath) / createDir(dirPath) - 创建目录
- readDirectory(dirPath) - 读取目录结构
- getFileStats(filePath) - 获取文件元信息（大小、修改时间、是否目录）
- createFile(filePath, content?) - 创建文件

### 文件监听
- watchProject(projectPath, enable) - 递归监听项目文件变化，去抖500ms
- onFileChanged(callback) - 文件变化事件回调，通知渲染进程刷新文件树

### 附件上传 & 多格式读取
- openFileDialog() - 系统文件选择对话框（多选）
- readTextFile(filePath) - 文本文件（限制10MB）
- readFileAsDataURL(filePath) - 图片/附件预览（限制50MB）
- readDocxText(filePath) - DOCX 文档提取纯文本
- readHex(filePath, maxBytes?) - 十六进制预览（限制1MB）
- readPdfBase64(filePath) - PDF Base64 编码
- readPdfDataUrl(filePath) - PDF Data URL 预览
- extractTextFromBinary() - .doc 旧格式文本提取
- parseZipEntries() - ZIP/DOCX 内容解析

---

## 2. AI 聊天

### 对话核心
- sendToAI(messages, options?) - 非流式 AI 对话
- sendToAIStream(messages, options?) - 流式 AI 对话
- abortAI() - 中断当前 AI 请求
- aiComplete(context, language) - 实时代码补全（Inline Completion）

### 流式响应事件
- ai-stream-chunk - 流式输出 chunk
- ai-stream-end - 流式输出结束
- ai-stream-error - 流式输出错误

### 对话管理
- 多会话（ChatSession）管理
- 会话重命名、创建、删除
- 消息复制、编辑、删除、分享
- 多选消息批量操作
- 清空全部消息

### 附件支持
- 图片附件（base64 data URL）
- 文件附件（代码/文档）
- 超大文件自动转大纲摘要

### AI 工具调用循环
- 自动检测 MCP 工具调用
- 执行工具并回灌结果
- 最大 8 轮工具调用循环
- 工具结果截断（节省 token）
- 写入文件后自动检测验证命令（gradlew/npm/yarn/pnpm/go/cargo）
- 验证结果自动回灌 AI 对话

---

## 3. Agent 系统

### Agent Orchestrator（多 Agent 协作引擎）
- Pipeline 架构: Builder -> Coder (并行) -> Reviewer -> Tester -> Integrator
- Builder: 需求拆解 -> 任务 DAG（JSON 依赖图）
- Coder Pool: 最多 4 个并行 Coder，按 DAG 拓扑调度
- Reviewer: 代码审查门禁，不通过退回 Coder
- Tester: 构建 + 测试验证
- Integrator: 冲突检查 + 合并
- 文件锁: 防止并行修改冲突
- 最大重试: 2次（MAX_CODER_RETRY）
- 阶段事件: onPhaseChange / onTaskProgress

### Builder Agent
- runBuilder(requirement, projectContext) - 需求 -> 任务列表
- 输出: Task[] (id, desc, dep, files, status)

### Coder Agent
- runCoder(task, projectRoot) - 单任务编码，自动读写文件

### TaskRunner（任务循环）
- runTaskLoop(tasks, projectRoot) - 批量任务执行
- abortTaskLoop() - 中断任务循环
- 进度回调: task-progress 事件

---

## 4. Git 操作

### 基础 Git
- getGitBranch(projectPath) - 获取当前分支
- getGitStatus(projectPath) - Git 状态（分支、文件列表、ahead/behind）
- stageAll(projectPath) - git add -A
- commit(projectPath, message) - git commit
- push(projectPath) - git push origin
- pull(projectPath) - git pull
- getDiff(filePath, projectPath) - 文件 diff（added/removed/modified 行号）
- getGitLog(projectPath, count?) - git log --oneline

### 高级 Git
- listBranches(projectPath) - 分支列表（--sort=-committerdate）
- checkout(branch, projectPath) - 切换分支
- blame(filePath, projectPath) - git blame（每行作者、日期、代码）
- getGitUser(projectPath) - git user.name / user.email

---

## 5. LSP（语言服务器协议）

### LSP 管理器
- lspStart(language, projectPath) - 启动语言服务器
- lspStop(language, projectPath?) - 停止语言服务器
- lspStatus(language, projectPath?) - 查询服务器状态
- lspAvailable(language) - 检查系统是否已安装
- lspInstallGuide(language) - 获取安装指引

### LSP 请求/通知
- lspRequest(language, method, params, projectPath?) - LSP 请求
- lspNotify(language, method, params, projectPath?) - LSP 通知

### LSP 功能（渲染进程侧）
- textDocument/didOpen - 文件打开
- textDocument/didChange - 内容变化（300ms 防抖）
- textDocument/didClose - 文件关闭
- textDocument/completion - 代码补全
- textDocument/definition - 跳转定义 (F12)
- textDocument/references - 查找引用 (Shift+F12)
- textDocument/rename - 重命名 (F2)
- textDocument/codeAction - 快速修复 (Ctrl+.)
- textDocument/diagnostic - 诊断标记（错误/警告波浪线）

### 支持语言
- Python, JavaScript, TypeScript, Go, Rust, C/C++, Java, Kotlin, Shell

---

## 6. MCP（Model Context Protocol）

### MCP 工具
- listTools() - 列出可用工具
- executeTool(toolCall) - 执行工具调用
- loadMcpServers(projectPath) - 按项目配置加载 MCP server
- disconnectAllMcp() - 断开所有连接
- listConnectedServers() - 列出已连接 server

---

## 7. 编辑器 UI

### Monaco Editor
- 暗色主题（trae-dark / 老虎）
- 亮色主题（trae-light / 白虎）
- 主题切换持久化（localStorage）
- 自动保存（3秒无操作 / 失焦立即保存）
- 光标位置同步状态栏

### 编辑器功能
- 智能补全（IntelliSense）
- 参数提示（Parameter Hints）
- 代码片段（Snippets）
- 内联 AI 补全
- Emmet 扩展（HTML/CSS 缩写展开）
- 右键菜单：AI 生成/解释/修复/重构/预览/发送给 AI

### TypeScript/JavaScript 语言服务
- 编译器选项配置（ES2020/ESNext/React JSX）
- 语法/语义诊断
- 浏览器 DOM 类型声明

### 文件标签页
- 标签页切换 (Ctrl+Tab)
- 标签页拖拽排序
- 关闭标签 (Ctrl+W)
- 关闭其他/右侧/全部
- 修改标记（dirty）

---

## 8. 面板 UI

### 左侧边栏
- 文件树（递归渲染、展开/折叠、文件图标）
- 快速搜索（Ctrl+P）

### 底部面板
- 终端面板（xterm.js）
- AI 面板
- Git 面板
- 搜索面板
- 设置面板
- 调试面板
- 架构分析面板
- 问题面板
- 大纲面板（符号导航）

### 右侧面板
- AI 聊天面板（多会话）
- 使用量统计面板

### 状态栏
- 光标位置 / 文件类型 / 编码 / 修改标记 / 使用量统计

### 主题系统
- 虎猫配色（--tc-orange）
- 暗色/亮色切换
- 主题持久化

---

## 9. 像素宠物

- initPixelPet() - 初始化宠物
- petToolCallStart() - 工具调用开始动画
- petToolCallEnd() - 工具调用结束动画

---

## 10. 其他

### 用量统计
- recordUsage(rec) - 记录 token 用量
- getUsageToday() / getUsageTotal() / getUsageByProject() / getUsageByDate(days?)
- 余额不足警告（onBalanceWarning）
- 成本计算（costRmb）

### 快照系统
- saveSnapshot(projectPath, taskId, filePath, content)
- listSnapshots(projectPath, filePath)
- restoreSnapshot(id)

### 会话持久化
- saveSession(state) / restoreSession()
- 保存：项目路径、打开文件、标签页、聊天记录、滚动位置

### 任务会话（断点续做）
- saveTaskSession(projectPath, tasksJson, currentIndex)
- getTaskSession(projectPath) / clearTaskSession(projectPath)

### 项目长期记忆
- memory:init(projectPath) - 初始化项目记忆
- memory:getInjection() - 获取记忆注入文本
- memory:search(query) - 搜索模式 + 决策记忆

### 向量搜索
- vector:init(projectPath) / vector:indexAll() / vector:search(query, options?) / vector:stats()

### 熵评估 & 上下文裁剪
- entropyEvaluator / entropyController / contextTrimmer / smartTrimmer

### Git 智能
- gitIntelligence - Git 智能分析

### 仓库分析
- warehouseAnalyzer - 仓库结构分析

### 无人值守
- unattendedRunner - 无人值守执行

### 语义补全
- semanticChunker / semanticCompletion

### 自动修复
- autoHealManager - 自动修复管理

### Lint & 性能
- lintManager / perfOptimizer

### 调试
- debugManager - 调试管理

### 架构分析
- analyzeArchitecture(projectPath)

### Gradle
- gradleExec(projectPath, task)

### 代码搜索
- project:search(query) - 项目内全文搜索（递归，限 200 条）

### 最近项目
- project:getRecent() / project:addRecent(projectPath)（最多 20 个）

### AI 行为规则
- getProjectRules(projectPath) / setProjectRules(rules) - CLAUDE.md 规则

### 系统操作
- showItemInFolder(path) / getClipboardText() / openExternal(target) / openBrowser(url)

### 安全存储
- crypto:encrypt(plainText) / crypto:decrypt(encrypted) - safeStorage

### 数据库
- dbQuery(sql, params?) - SQL 查询（仅 SELECT）
- dbRun(sql, params?) - SQL 执行（禁止 DROP TABLE）

### 工程兼容
- loadProjectCompat(projectRoot) / saveProjectCompat(projectRoot, data)

### 系统设置
- getSettings() / saveSettings(settings)

### 模型配置
- getModelConfig() / saveModelConfig(config) / testModelConnection(params)
- listModelMeta(provider?) / getModelMeta(provider, modelId)
- API 配置管理（getApiConfigs / saveApiConfigs）

### 模型适配器（ModelAdapter）
- OpenAI 兼容协议（DeepSeek / 火山方舟 / 自定义）
- Anthropic Messages 协议
- Ollama 协议
- 自动检测协议类型
- 指数退避重试（最多3次，429/500/502/503/504）
- Token 用量追踪
- 系统规则注入（CLAUDE.md）
- 成本计算（model-meta 动态计费）

### 快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl+P | 快速打开文件 |
| Ctrl+W | 关闭当前文件 |
| Ctrl+Tab | 切换文件标签 |
| Ctrl+J | 打开底部面板 |
| Ctrl+, | 打开设置 |
| Ctrl+Shift+I | AI 面板 / AI 生成代码插入 |
| Ctrl+N | 新建文件 |
| F12 | 跳转定义 |
| Shift+F12 | 查找引用 |
| F2 | 重命名 |
| Ctrl+. | 快速修复 |

---

## 附录：打包内容（dist/renderer/assets/index-h-KTZIGz.js）

- Monaco Editor（vendor-monaco）
- xterm.js（vendor-xterm）
- 内联 Emmet 解析器
- LSP 客户端逻辑
- 像素宠物
- 调试面板
- 语法片段服务
- 文件树渲染
- AI 聊天 UI
- 设置面板 / 架构分析面板 / Git 面板 / 搜索面板
- 终端面板 / 问题面板 / 大纲面板
- 使用量统计
- 快照系统 / 会话持久化
- 任务执行 UI
- Agent 模式切换（对话/工具/Builder/流水线）
- 工具模式（AI 可读写文件/执行命令）
- 多选消息 / 上下文菜单
