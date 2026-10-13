# SUPER_PLAN v2 - TCIDE 务实改进计划

> 更新时间：2026-08-21 | 状态：进行中

## 现状评估

### TS 版（main分支）- 功能完整
- 10大模块，150+ 功能点
- VS Code 风格三栏布局
- Monaco Editor 多标签
- Agent 多协作引擎
- MCP 工具调用循环

### Python 版（tcide-py分支）- 基础框架
- FastAPI + PyWebView 后端
- Monaco + xterm.js 前端
- 基础文件/AI/终端功能
- 需要功能对齐

---

## 阶段 1: 后端 API 扩展 [进行中]

### 已完成
- [x] files.py - 基础文件 CRUD
- [x] git_ops.py - Git 操作
- [x] ai.py - AI 对话
- [x] terminal.py - 终端
- [x] settings.py - 设置

### 待完成
- [ ] lsp.py - LSP 诊断桥接
- [ ] mcp.py - MCP 工具连接
- [ ] memory.py - 上下文记忆
- [ ] vector.py - 向量索引
- [ ] snapshot.py - 文件快照
- [ ] usage.py - 用量统计
- [ ] debug.py - 调试工具

---

## 阶段 2: 前端重写 [待开始]

### 目标
让 Python 版前端匹配 TS 版的 VS Code 风格

### 组件清单
- [ ] Activity Bar（活动栏）
- [ ] Sidebar（文件树）
- [ ] Editor Tabs（多标签编辑器）
- [ ] Panel（底部面板）
- [ ] Status Bar（状态栏）
- [ ] AI Chat 面板
- [ ] Agent 进度面板
- [ ] MCP 工具面板

---

## 阶段 3: SUPER_PLAN 特性实现 [待开始]

### 3.1 MCP 连接
- [ ] MCP 服务器连接管理
- [ ] 工具列表获取
- [ ] 工具调用执行
- [ ] 结果回灌 AI

### 3.2 LSP 诊断桥接
- [ ] LSP 服务器启动
- [ ] 诊断信息收集
- [ ] 编辑器错误标记
- [ ] 自动修复建议

### 3.3 Agent 自动验证
- [ ] 写入文件后自动检测
- [ ] 执行验证命令（gradlew/npm/yarn/pnpm/go/cargo）
- [ ] 验证结果回灌 AI

### 3.4 Reviewer 闭环
- [ ] 代码审查任务分发
- [ ] 审查结果反馈
- [ ] 不通过退回 Coder

---

## 阶段 4: 测试与优化 [待开始]

- [ ] 功能测试
- [ ] 性能优化
- [ ] 文档更新
- [ ] README 修正（去除夸大宣传）

---

## 进度追踪

| 阶段 | 状态 | 完成度 |
|------|------|--------|
| 1. 后端 API | 进行中 | 70% |
| 2. 前端重写 | 待开始 | 0% |
| 3. SUPER_PLAN | 待开始 | 0% |
| 4. 测试优化 | 待开始 | 0% |

---

## 注意事项

1. **两版功能必须对齐** - Python 版需实现 TS 版所有核心功能
2. **前端必须相似** - VS Code 风格三栏布局
3. **README 必须诚实** - 只列出已实现功能
4. **两个分支都要 push** - main 和 tcide-py

---

*更新 SUPER_PLAN 时请同步更新此文档*
