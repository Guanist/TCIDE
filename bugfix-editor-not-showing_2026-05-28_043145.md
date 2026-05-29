# TCIDE v1.2 Bug #3 — 文件树可加载但无法打开编辑

**时间**: 2026-05-28 04:30-04:31 CST

## 现象
- 打开项目后文件树正常加载
- 点击文件树中的文件：无任何反应，编辑器不出现

## 根因
v1.2 UI 升级时，`#editor-area` 从单纯编辑器容器变为包含 `welcome-page` + `editor-tabs` + `monaco-container` + 底部面板的 Flex Column 布局。

`welcome-page` 有 `flex: 1`，当它可见时（无 `.hidden` 类），会**占满整个 editor-area 空间**，导致后面的 `editor-tabs` 和 `monaco-container` 被 `overflow: hidden` 裁剪到可视区之外。

旧版代码中 `openFile()` 没有调用 `hideWelcomePage()`，因为旧布局中 welcome-page 和编辑器是独立区域。新版中它们在同一 flex 容器中，所以打开文件时必须隐藏欢迎页释放空间。

## 修复
`openFile()` 函数开头添加 `hideWelcomePage()` 调用（单行改动）。

## 编译
✅ tsc 双零 + Vite build 8.74s
