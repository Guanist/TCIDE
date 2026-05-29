# TCIDE 功能补齐 & 打包 — 2026-05-26

## 概述
补齐 TCIDE vs CodeBuddy 的 4 个核心 P0 差距 + 编辑器润色，最终打包成功。

## 一、CLAUDE.md 规则注入修复（关键 Bug）

**问题**: renderer main.ts 中使用了 `adapter.setSystemRules(rules)`，但 `adapter` 不存在于渲染进程——会导致运行时崩溃。

**修复**: 
- `ipc-handlers.ts`: 新增 `let projectRules = '';` 模块级变量；在 `ai:send`、`ai:send-stream`、`agent:builder`、`agent:coder`、`task:runLoop` 五个 adapter 创建点注入 `adapter.setSystemRules(projectRules)`
- 新增 `config:setRules` IPC handler
- `preload.ts`: 新增 `setProjectRules` 绑定
- `main.ts`: 两处 `adapter.setSystemRules(rules)` → `window.api.setProjectRules(rules)`
- `types.d.ts`: 新增 `setProjectRules(rules: string): Promise<void>`

## 二、AI 实时代码补全（Inline Completion）

**实现**: 
- `ipc-handlers.ts`: 新增 `ai:complete` IPC handler，调用 AI 做代码补全（temperature=0.1, maxTokens=64）
- `preload.ts` / `types.d.ts`: 新增 `aiComplete(context, language)` 绑定
- `main.ts`: 为 23 种语言注册 `monaco.languages.registerInlineCompletionsProvider`
  - 策略: 350ms 防抖、仅行尾触发、取前 25 行上下文
  - 覆盖: js/ts/python/java/kotlin/go/rust/cpp/c/csharp/swift/ruby/php/html/css/scss/json/yaml/xml/markdown/shell/sql/dart

## 三、AI Diff 预览

**实现**:
- `main.ts`: 
  - `showDiffModal()` — 并排显示原始代码 vs AI 建议
  - `computeLineDiff()` — 逐行比较，标注 added/removed/unchanged
  - `acceptDiff()` / `closeDiffModal()` — 接受/拒绝变更
  - 修改 `aiGenerateAndInsert()` — 有原始选中文本时弹 diff 弹窗，无原文时空选择直接插入
- `index.html`: Diff 弹窗 HTML（遮罩+双栏对比+按钮）
- `main.css`: Diff 弹窗完整样式（暗色主题，绿=新增，红=删除）
- 键盘: Enter=接受, Esc=拒绝（在全局 keydown handler 中优先处理）

## 四、Agent 自动执行循环（/task 命令）

**实现**:
- `main.ts`:
  - `sendToAI()` 新增 `/task` 命令检测，触发 `executeTaskAgentLoop()`
  - `executeTaskAgentLoop()` 流程:
    1. Builder 分解需求 → 显示执行计划
    2. Coder 逐个执行子任务
    3. 失败自动重试（最多 2 次），将错误信息注入修复 prompt
    4. 成功时预览输出代码
  - `/task` 用法提示: `/task 创建用户登录 API`、`/task 添加缓存层`

## 五、编辑器润色

- Monaco minimap 启用: `{ enabled: true, scale: 1, showSlider: 'mouseover', renderCharacters: false, maxColumn: 80 }`
- 轻量模式：色块代替字符，仅 hover 显示滑块

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `src/main/ipc-handlers.ts` | +projectRules 变量, +5 处 adapter.setSystemRules, +ai:complete handler, +config:setRules handler |
| `src/main/preload.ts` | +setProjectRules, +aiComplete 绑定 |
| `src/renderer/types.d.ts` | +setProjectRules, +aiComplete 类型声明 |
| `src/renderer/main.ts` | 修复 2 处 adapter → window.api, +InlineCompletionsProvider(~50行), +Diff 弹窗系统(~70行), +executeTaskAgentLoop(~70行), minimap 启用 |
| `src/renderer/index.html` | +Diff 弹窗 HTML(~25行) |
| `src/renderer/styles/main.css` | +Diff 弹窗样式(~40行) |

## 构建产物

| 文件 | 大小 |
|------|------|
| `release/TCIDE-1.0.0-x64.exe` (NSIS 安装包) | 99.8 MB |
| `release/TCIDE-1.0.0-portable.exe` (便携版) | 82.94 MB |
| `release/win-unpacked/` (解压即用) | ~ |

- 主进程 tsc: 零错误
- Vite 构建: 1062 模块, ~9s
- electron-builder: exit code 0 (仅 chunk size 警告)