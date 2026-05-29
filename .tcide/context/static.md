# 虎猫 TCIDE 项目静态上下文

## 技术栈
- Electron + TypeScript + Monaco Editor + Vite
- xterm.js 终端
- sql.js WASM 数据库
- electron-builder 打包（NSIS 安装包 + 便携版）

## 整体架构
- src/main/ → Electron 主进程（窗口管理、IPC、文件服务、数据库）
- src/renderer/ → 渲染进程（Monaco 编辑器、UI 组件、AI 面板）
- src/core/ → 核心业务逻辑（Agent、模型适配、任务引擎、项目索引）
- dist/ → Vite 构建输出

## 核心模块说明
### Agent 系统
- BuilderAgent：需求→JSON 任务拆分
- CoderAgent：文件读写+终端执行+自动快照
- TaskRunner：拓扑排序+编译验证+自动修复（最多3次）

### 模型层
- 支持 Provider：DeepSeek/Ollama/Anthropic/OpenAI
- SSE 流式响应 + 请求重试（指数退避）
- API Key 加密存储（safeStorage）
- Token 用量记录（SQLite）

### 上下文管理
- 自动读取根目录 CLAUDE.md 全局规则
- 静态上下文缓存（.tcide/context/static.md）
- 会话历史仅保留最近 3 轮
- 单次上下文最多 3 个依赖文件
- 单会话 Token 上限 50000

## 全局编码规范
- Kotlin：官方编码规范 + Jetpack 组件最佳实践
- TypeScript：严格模式，ESModule
- Android：AGP 8.2.2 + SDK 34 + JDK 24
- 构建命令：gradlew assembleDebug / npm run build

## 外部工具兼容
- Trae：自动识别根目录 CLAUDE.md
- QClaw：兼容 Claude 生态，规则自动生效
- 三方工具共享同一份 CLAUDE.md，无需额外配置
