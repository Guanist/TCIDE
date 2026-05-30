# 虎猫 TCIDE v1.4.0 更新说明

**发布日期**: 2026-05-30

## 新增功能

### LSP 语言服务集成（Phase 2 — 外部服务器支持）
- **Python**: 集成 pyright 语言服务器，自动补全/悬停提示/跳转定义/查找引用/实时诊断
- **多语言检测**: Go (gopls)、Rust (rust-analyzer)、C++ (clangd)、Java、Bash
- **安装指引**: 语言服务器未安装时自动提示安装命令
- **架构**: 主进程管理语言服务器生命周期，渲染进程通过 IPC 桥接 JSON-RPC

### LSP 语言服务集成（Phase 1 — TypeScript/JavaScript）
- Monaco 内置 TypeScript 编译器，提供 Go to Definition / Find References / Rename / Quick Fix
- Bracket Pair Colorization、Parameter Hints、Quick Suggestions

### Problems 面板
- 活动栏 ⚠️ 按钮 + 独立面板，实时诊断列表
- 按严重度排序、点击跳转、Badge 显示错误+警告数
- 快捷键: Ctrl+Shift+M 打开面板

### 编辑器增强
- **Emmet 展开**: Tab 键触发，HTML/CSS/JSX 内建解析器
- **Snippets 代码片段**: 50+ 预置片段（HTML/CSS/TS/JS/Python/Go/Rust），设置面板查看
- **分屏编辑器**: 双 Monaco 实例，Ctrl+\ 垂直 / Alt+2 水平

### Git 增强
- **分支切换**: Git 面板下拉选择分支，切换后自动刷新文件树
- **Git Blame**: 行内作者标注，悬停详情

### MCP 工具集成
- **9 个内置工具**: read_file / write_file / list_files / search_code / run_command / git_status / git_diff / get_diagnostics / get_open_files
- **AI Function Calling**: 聊天中 AI 可自动调用工具读写文件、执行命令
- **工具调用显示**: 聊天气泡中显示工具执行状态（⏳/✅/❌）

### AI 聊天增强
- **消息操作按钮**: hover 显示复制/编辑/删除/分享
- **右键菜单**: 右键消息弹出操作菜单
- **多选删除**: ☑ 按钮进入多选模式，批量删除消息
- **可折叠思考过程**: `[reasoning]...[/reasoning]` 自动折叠展示
- **代码块全链路**: 📂打开/👁预览/▶运行/💾保存到项目/📋复制
- **编辑用户消息**: ✏️ 回填到输入框修改后重发
- **对话内联重命名**: 双击标题编辑，Enter 保存 / Escape 取消

### 多格式预览
- 🖼️ **图片**: PNG/JPG/GIF/WebP/BMP/ICO
- 🎬 **视频**: MP4/WebM/OGG/MOV/AVI/MKV
- 🎵 **音频**: MP3/WAV/FLAC/AAC/M4A
- 📄 **PDF**: 调用系统默认阅读器打开
- 📝 **DOCX**: 文本提取渲染
- 🖼️ **SVG**: 预览/源码双模式

### API 配置管理
- **已保存的 API 配置列表**: 显示所有已配置的 API Key（掩码保护）
- **一键切换**: 点击切换使用的 API
- **删除配置**: ✕ 按钮删除不再使用的 Key

### 版本记录
- 设置 → 📋 版本记录：v1.0 ~ v1.4 完整迭代时间线

## 修复

- 修复图片/PDF 在编辑区打开乱码问题
- 修复 SVG 源码模式不显示代码
- 修复文件标签栏和预览/源码按钮消失
- 修复 `renderTabs` 未定义导致标签栏不渲染
- 修复附件上传时非 txt 文件 AI 无法识别
- 修复图片附件无法多模态发送给 AI
- 修复对话重命名后仍显示旧名称
- 修复对话列表重复显示
- 修复聊天消息重复渲染
- 修复 `renderChatSessions` 拼写错误导致会话恢复失败

## 技术改进

- Model Adapter 升级支持 OpenAI Vision 多模态格式
- `readFileAsDataURL` MIME 映射扩展（PDF/视频/音频）
- 文件大小限制从 5MB 提升至 50MB
- 构建脚本 `dist` 自动执行 tsc + vite build
