# 虎猫 TCIDE v1.2.0 更新说明

**发布日期**: 2026-05-30

## 新增功能

### 代码大纲面板 (Ctrl+Shift+O)
- 支持 6 种语言符号提取（JS/TS/Python/Go/Rust/Java）
- 树形结构渲染，分类展示（函数、类、变量、接口等）
- 点击符号跳转到对应代码位置
- 关键字过滤搜索

### 命令面板 (Ctrl+Shift+P)
- 21 个内置命令，覆盖文件操作、编辑、视图、AI、终端
- 模糊搜索匹配
- 键盘导航（上下箭头 + Enter）
- 快捷键提示

### Zen Mode (Ctrl+Shift+Z)
- 一键进入专注模式
- GPU 加速动画过渡
- 自动收缩侧边栏、隐藏面板
- 居中编辑器，迷你状态栏

### 终端流式输出
- 终端命令输出实时推送（spawn 替代 exec）
- Coder Agent 执行过程流式显示
- xterm.js 增量渲染

### 上下文管理器
- `CLAUDE.md` 编码规范与 Token 管控规则
- `contextManager.ts` 自动读取上下文规则
- 静态记忆文件 `.tcide/context/static.md`
- 3 文件上限、3 轮对话窗口、50K 单文件截断

## 技术改进

- 内置 HTTP 渲染服务器（兼容性增强）
- 构建管线重建（package.json / tsconfig.json / vite.config.ts）
- IPC 通信流式改造
- 依赖锁定（electron-store 8.2 / sql.js 1.14 / monaco 0.52 / xterm 5.3）

## 已知限制

- 托盘图标在部分系统不可见（不影响功能）
- file:// 协议加载在部分 Windows 版本不兼容（已通过内置 HTTP 服务器绕过）

---

**原始版本**: 虎猫 TCIDE v1.1.0
