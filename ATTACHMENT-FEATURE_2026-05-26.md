# 附件上传 + 模型快捷切换 — 实施记录

## 时间
2026-05-26 20:52-20:58

## 需求
在 TCIDE 聊天窗口实现：(1) IDE 风格附件上传 (2) 底部模型快速切换

## 修改文件清单

### 1. `src/renderer/index.html`
- 聊天输入区重构：新增 `#attachment-preview` 附件预览栏 + `.chat-input-toolbar` 工具栏
- 新布局：`[📎附件] [输入框] [模型选择器▼] [▶发送] [■终止]`
- 模型选择器 `<select id="quick-model-select">` + 连接状态指示灯 `#model-status`

### 2. `src/renderer/styles/main.css`
- 新增 ~130 行样式：附件预览栏、附件项（图标/名称/大小/删除）、附件按钮 hover 效果
- 模型选择器（32px 高度、暗色主题）、连接状态点（绿/红/黄脉冲动画）
- 聊天消息中附件展示（`.msg-attachments` / `.msg-attachment-img`）
- 布局从单行 flex → flex-direction: column（预览栏 + 工具栏）

### 3. `src/renderer/main.ts`
- **状态扩展**：`AttachmentMeta` 接口 + `attachments` 全局数组 + 文件类型常量
- **附件管理**：`openAttachDialog()` / `removeAttachment()` / `renderAttachmentBar()` / `formatFileSize()` / `fileIcon()`
- **模型选择器**：`populateModelSelector()` / `onQuickModelChange()` / `updateModelStatusDot()`
- **发送增强**：`sendToAI()` 现在读取文本附件内容拼入 `attachContext`，图片附件保留元数据
- **聊天展示**：`addChatMessage()` 新增 `attachList` 参数，渲染附件缩略图/文件图标
- **事件绑定**：📎按钮点击 → `openAttachDialog()`，拖拽区域 drop 事件，模型 select → `onQuickModelChange()`

### 4. `src/main/ipc-handlers.ts`
- `dialog:openFiles` — 调用 `dialog.showOpenDialog`，返回 `{name, path, size, mtime}[]`
- `file:readText` — 读取文本文件 utf-8 内容（≤10MB）

### 5. `src/main/preload.ts`
- `openFileDialog()` → `ipcRenderer.invoke('dialog:openFiles')`
- `readTextFile()` → `ipcRenderer.invoke('file:readText')`

### 6. `src/renderer/types.d.ts`
- TcIdeApi 新增 `openFileDialog()` / `readTextFile()` 类型签名

## 构建结果
- tsc 主进程：零错误
- Vite 渲染进程：零错误（1062 模块，8.88s）
- 打包产出：TCIDE-1.0.0-x64.exe (NSIS) + portable
- 已启动 TCIDE 验证

## 功能覆盖
| 需求项 | 状态 |
|--------|------|
| 附件按钮（📎图标/hover提示） | ✅ |
| 图片/文本文件上传 | ✅ |
| 多选上传 | ✅ |
| 文件大小限制（10MB/5MB） | ✅ |
| 附件预览栏（缩略图/图标+名称+大小） | ✅ |
| 单附件删除（✕按钮） | ✅ |
| 拖拽上传 | ✅ |
| 附件随消息发送 | ✅ |
| 聊天消息中附件展示 | ✅ |
| 模型选择器下拉 | ✅ |
| 连接状态指示灯 | ✅ |
| 模型切换仅对后续对话生效 | ✅ |
| 暗色主题一致 | ✅ |
| 布局适配（📎→输入→模型→发送） | ✅ |

## 未覆盖（低优先级/后续迭代）
- 图片大图预览、放大交互
- Ctrl+Shift+M 快捷键唤起模型选择器
- API配置面板内嵌（需较大改动）
- 多配置管理 CRUD（当前复用 Settings 面板）
- 图片 base64 传入多模态 API（当前传元数据，DeepSeek 不支持多模态）
