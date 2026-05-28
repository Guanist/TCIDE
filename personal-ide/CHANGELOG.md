# 🐅 虎猫 TCIDE v1.1.0 发布说明

> **2026-05-28** · 18 files changed, +7,836 / -1,228

---

## 🆕 新增功能

### 🎨 双主题切换：白虎 / 老虎
- 亮色（白虎）/ 暗色（老虎）一键切换，左下角 ☀️ 按钮
- Monaco 编辑器联动切换 `trae-light` / `trae-dark` 主题
- CSS 变量全覆盖：背景、文字、边框、按钮、面板
- 偏好持久化 localStorage，重启保持

### 💬 对话管理升级
- 对话列表删除（二次确认模态框）+ 重命名（prompt 弹窗）
- 会话持久化到项目 `.tcide/chat/sessions.json`
- 聊天列表操作按钮 hover 显示（✎ 重命名 / × 删除）

### 📄 文件预览增强
- **HTML / SVG / XML**：工具栏切换「👁 预览」↔「📝 源码」双模式
- **预览错误捕获**：postMessage → 底部红色错误控制台
- **DOCX**：EOCD 中央目录定位 + stored/deflate 双模式解压
- **DOC (OLE)**：二进制文本提取
- **PDF**：Blob URL iframe 替代 data URL
- **Hex 查看器**：offset + hex + ASCII 格式

### 🔀 Git 集成
- 侧边栏 Git 面板：分支名、变更文件列表、M/A/D/U 状态
- Monaco Diff 行标记：绿色竖线（新增）/ 橙色竖线（修改）
- 一键 Stage → Commit → Push
- Coder Agent 编译成功后自动提交

### 🖥️ 终端多标签
- xterm.js 多标签切换 + 关闭自动重建
- 各标签独立命令历史 buffer
- 底部拖动调整终端高度

### 🤖 AI 增强
- **自动读取协议**：AI 响应中 `/read N-M` 自动检测 → 确认卡片 → 注入上下文
- **/file 命令**：超过 20 万字符生成结构化大纲
- **/lines N-M**：精确行范围读取
- **AI 身份注入**：强制 IDE 上下文 + 禁止话术清单（不再说"我无法访问文件"）
- **火山方舟适配**：`coding-plan` 模型 + `ark-` 密钥免 endpoint ID
- AI 面板拉宽至 60% 窗口宽度

### 📂 文件管理
- 文件树图标：24+ emoji 文件夹 + 40+ PNG 文件类型图标
- 递归文件监听（`fs.watch` + 500ms 去抖）
- 右键菜单：重命名（带 prompt）、更多 emoji 图标前缀

### ✏️ 编辑器优化
- 自动保存：2 秒防抖 + 状态栏 `● 已保存 / ○ 未保存` 指示器
- 关闭 `unicodeHighlight` 警告（不弹 Non-Basic ASCII 提示）

### 🏗️ 架构分析器
- 导入依赖分析 + 依赖图 + 代码异味检测

### 📄 README.md
- 完整项目文档：功能矩阵、架构图、快捷键、配置指南

---

## 🔧 修复

- 文件树图标 404：绝对路径 → 相对路径 / emoji 回退
- PDF 预览：data URL → Blob URL（绕过 Electron file:// 限制）
- DOCX 解析：空条目检测 + 全 XML 降级扫描
- Office 临时文件 `~$` 前缀：识别并返回友好提示
- HTML 工具栏不显示：`class="hidden"` + `style="display:none"` 冲突修复
- 构建后 HTML 编码乱码：PowerShell Set-Content → Vite 原样输出
- 火山引擎 model 必填校验：`ark-` 密钥跳过

---

## 📦 下载

| 类型 | 文件 |
|------|------|
| 安装版 | `TCIDE-1.1.0-x64.exe` |
| 便携版 | `TCIDE-1.1.0-portable.exe` |

---

[View on GitHub](https://github.com/Guanist/TCIDE)
