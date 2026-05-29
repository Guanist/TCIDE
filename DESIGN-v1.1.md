# 虎猫 TCIDE v1.1 — 全面升级设计文档

**版本**: v1.1.0
**日期**: 2026-05-27
**作者**: AI 工程师 Agent
**目标**: 完成所有功能模块、优化 UI/UX、通过全面检测

---

## 一、项目现状评估

### 1.1 已完成模块（✅ 37项）

| 分类 | 模块 | 状态 |
|------|------|------|
| **框架** | Electron 主/渲染/preload 进程分离 | ✅ |
| **框架** | ContextIsolation + preload 安全桥接 | ✅ |
| **布局** | 三栏布局（文件树240px + 编辑器 + AI面板360px） | ✅ |
| **布局** | 面板拖拽调整器（sidebar/ai-panel resizer） | ✅ |
| **编辑器** | Monaco Editor + 暗色主题(trae-dark) + 23种语言 | ✅ |
| **编辑器** | Minimap（色块模式，hover滑块） | ✅ |
| **编辑器** | 实时代码补全（23种语言，350ms防抖） | ✅ |
| **编辑器** | AI Diff 预览（并排对比 + 接受/拒绝） | ✅ |
| **编辑器** | AI 一键编程 Action（Ctrl+Shift+I/E） | ✅ |
| **AI面板** | 流式 Markdown 输出 + 对话历史 | ✅ |
| **AI面板** | 终止/重试按钮 + 附件上传 + 模型快速切换 | ✅ |
| **AI面板** | /task Agent 自动循环（Builder→Coder） | ✅ |
| **智能体** | Builder Agent（需求→JSON任务拆分） | ✅ |
| **智能体** | Coder Agent（文件读写+终端+自动快照） | ✅ |
| **智能体** | TaskRunner（拓扑排序+编译验证+自动修复3次） | ✅ |
| **模型** | 4种 Provider（DeepSeek/Ollama/Anthropic/OpenAI） | ✅ |
| **模型** | SSE 流式 + 请求重试（指数退避） | ✅ |
| **模型** | 22个内置模型元数据注册表 | ✅ |
| **模型** | Token 用量记录（SQLite + 5维度） | ✅ |
| **模型** | API Key 加密存储（safeStorage） | ✅ |
| **数据** | sql.js WASM 数据库 | ✅ |
| **数据** | electron-store 配置持久化 | ✅ |
| **项目** | CLAUDE.md 规则注入（3层+5种格式+hash缓存） | ✅ |
| **项目** | 项目索引引擎（文件树+符号+模块） | ✅ |
| **项目** | 工程兼容（.qclaw/.codebuddy/.trae） | ✅ |
| **项目** | Git 集成（分支显示+复制+用户身份） | ✅ |
| **项目** | Gradle 快捷面板（Debug/Test/Clean） | ✅ |
| **项目** | 断点续做 + 快照恢复 | ✅ |
| **UI** | 关于对话框 + 帮助/快捷键弹窗 | ✅ |
| **UI** | 余额不足弹窗 + 上下文菜单 | ✅ |
| **UI** | 设置面板（服务商配置+自定义配置） | ✅ |
| **UI** | 用量统计面板（今日/累计/按项目/30天趋势） | ✅ |
| **UI** | 状态栏（Git/编码/语言/Gradle/token/位置/模型） | ✅ |
| **终端** | xterm.js + FitAddon | ✅ |
| **构建** | electron-builder 打包（NSIS安装包+便携版） | ✅ |

### 1.2 部分完成模块（⚠️ 7项）

| 模块 | 当前状态 | 问题 |
|------|----------|------|
| Zen Mode | 状态变量存在，快捷键绑定，未完整实现面板切换动画 | 切换有闪烁，终端未联动 |
| Coder Action 解析 | 纯正则匹配 | 无法处理嵌套参数，容错性差 |
| Builder JSON 解析 | 正则兜底 | 复杂任务拆分可能失败 |
| 终端面板 | xterm已初始化，但未与Coder/TaskRunner终端操作完全联通 | 终端输出不显示 |
| 编辑器标签页 | 基础切换存在，无关闭/拖拽/右键菜单 | 交互不完整 |
| 文件树 | 基础渲染存在，无拖拽/搜索/外部变更刷新 | 交互不完整 |
| 命令面板 | 快捷键绑定存在，无UI实现 | 功能缺失 |

### 1.3 缺失模块（❌ 18项）

| 分类 | 模块 | 优先级 |
|------|------|--------|
| **编辑器** | 代码大纲/符号导航（Outline） | P0 |
| **编辑器** | 查找替换增强（项目级搜索 Ctrl+Shift+F） | P0 |
| **编辑器** | 文件树搜索/过滤 | P0 |
| **编辑器** | 面包屑导航 | P1 |
| **编辑器** | 分屏编辑器 | P2 |
| **编辑器** | 代码诊断/错误波浪线 | P2 |
| **项目** | 欢迎页/最近项目列表 | P0 |
| **项目** | 新建项目向导 | P1 |
| **UI** | 命令面板（Ctrl+Shift+P）完整实现 | P0 |
| **UI** | Toast 通知系统 | P0 |
| **UI** | 加载状态指示器 | P0 |
| **UI** | 空状态引导 | P1 |
| **UI** | 键盘快捷键自定义面板 | P2 |
| **UI** | 设置导入/导出 | P2 |
| **系统** | 原生菜单栏（File/Edit/View/Help） | P1 |
| **系统** | 系统托盘增强（后台运行/快速恢复） | P2 |
| **系统** | 自动更新机制 | P2 |
| **测试** | 性能验证（80MB/180MB/2s） | P0 |

---

## 二、功能模块设计

### 模块1: 编辑器增强

#### 1.1 代码大纲（Outline/Symbol Navigation）

```
┌───────────── 大纲面板 ─────────────┐
│ 🔍 搜索符号...                      │
│ ─────────────────────────────────── │
│ 📦 MainActivity                     │
│   ├─ onCreate()                     │
│   ├─ onStart()                      │
│   └─ onDestroy()                    │
│ 📦 UserRepository                   │
│   ├─ getUser(id: String)            │
│   ├─ updateUser(user: User)         │
│   └─ deleteUser(id: String)         │
│ 📦 data/models/User.kt              │
│   └─ class User                     │
│       ├─ id: String                 │
│       ├─ name: String               │
│       └─ email: String              │
└─────────────────────────────────────┘
```

**实现方案**:
- 在右侧AI面板新增"大纲"Tab
- 利用 Monaco Editor 的 `getModel()` + 正则解析当前文件符号
- 支持语言: Kotlin, Java, TypeScript, Python, Go, Rust
- 点击符号跳转到对应行
- 搜索框实时过滤

**核心代码路径**: `src/renderer/main.ts` 新增 `renderOutline()` + `src/renderer/index.html` 新增 outline tab

#### 1.2 项目级搜索（Ctrl+Shift+F）

```
┌───────── 搜索面板 ─────────┐
│ 🔍 [搜索内容____]  [📁 文件类型▼] │
│ ─────────────────────────── │
│ 结果: 找到 12 个匹配         │
│ ─────────────────────────── │
│ 📄 UserService.kt           │
│   42: fun getUser(id: Str.. │
│   108: val user = getUser(..│
│ 📄 UserRepository.kt        │
│   15: suspend fun getUser.. │
│ ─────────────────────────── │
│ [替换: ___________] [全部替换] │
└─────────────────────────────┘
```

**实现方案**:
- 在编辑器区域顶部新增搜索面板（可折叠）
- 使用 Node.js fs 递归搜索
- 结果列表可点击跳转
- 支持文件类型过滤（glob pattern）
- 支持替换功能

#### 1.3 面包屑导航

```
📁 src > main > java > com > example > ui > MainActivity.kt > onCreate()
```

**实现方案**:
- 编辑器标签页上方显示面包屑
- 基于文件路径 + 光标所在符号生成
- 点击可快速导航

#### 1.4 文件树搜索/过滤

```
┌── EXPLORER ──────────────────┐
│ 🔍 [UserService________] [✕] │
│ ───────────────────────────  │
│ 📁 src/main/java/com/example/│
│   📁 service/                │
│     📄 UserService.kt    ✓   │
│   📁 repository/             │
│     📄 UserRepository.kt     │
└──────────────────────────────┘
```

**实现方案**:
- 文件树标题栏新增搜索框
- 输入时实时过滤（文件名模糊匹配）
- 清空搜索框恢复完整树
- 支持快捷键 Ctrl+F（在文件树聚焦时）

---

### 模块2: 命令面板（Ctrl+Shift+P）

```
┌─────── 命令面板 ───────────────────────┐
│ ▸ [搜索命令...________________]         │
│ ────────────────────────────────────── │
│ 📂 文件                                 │
│   新建文件           Ctrl+N             │
│   新建文件夹         Ctrl+Shift+N       │
│   保存文件           Ctrl+S             │
│   打开项目           Ctrl+O             │
│ 🔍 搜索                                 │
│   全局搜索           Ctrl+Shift+F       │
│   跳转到行...        Ctrl+G             │
│ 🤖 AI                                   │
│   AI 生成代码        Ctrl+Shift+I       │
│   AI 解释代码        Ctrl+Shift+E       │
│   Builder 架构模式   Ctrl+Shift+B       │
│   Coder 编程模式     Ctrl+Shift+C       │
│   /task 任务循环                        │
│ 👁️ 视图                                │
│   切换 AI 面板       Ctrl+\             │
│   Zen 专注模式       Ctrl+Shift+M       │
│   切换终端           Ctrl+`             │
│ ⚙️ 设置                                │
│   打开设置           Ctrl+,             │
└────────────────────────────────────────┘
```

**实现方案**:
- 模态弹窗，背景半透明遮罩
- 搜索框自动聚焦，支持模糊匹配
- 键盘 ↑↓ 导航，Enter 执行，Esc 关闭
- 注册命令系统 `commandRegistry: Map<string, {label, category, shortcut, action}>`
- 显示快捷键（右侧对齐）
- 支持中文拼音搜索

---

### 模块3: Zen Mode 完善

**当前问题**: 状态变量存在但切换有闪烁，终端未联动隐藏

**优化方案**:
1. 面板隐藏改用 CSS `transform: translateX()` + `opacity`（GPU加速，无闪烁）
2. 编辑器区域扩展到全屏（`flex: 1, margin: 0`）
3. 终端容器同步隐藏
4. 状态栏缩小为底部迷你栏（仅显示行号/列号/语言）
5. 进入/退出动画（200ms ease-in-out）
6. Zen Mode 下增加居中编辑器（max-width: 900px，自动居中）
7. 状态栏显示"Zen Mode · 按 Ctrl+Shift+M 退出"

---

### 模块4: 终端增强

**当前问题**: xterm 已初始化但未与 Coder/TaskRunner 的终端操作联通

**优化方案**:
1. **IPC 桥接**: 新增 `terminal:write` / `terminal:exec` IPC channel
2. **Coder 集成**: CoderAgent 的 `run_terminal` 操作输出实时显示在终端面板
3. **终端面板改进**:
   - 多终端 Tab（可创建多个终端实例）
   - 终端输出高亮（stdout=白色, stderr=红色, 编译错误=橙色）
   - 快捷命令按钮（./gradlew assembleDebug, npm run dev 等）
   - 终端搜索（Ctrl+F 在终端内搜索）
4. **终端切换按钮**: 状态栏新增终端图标，点击切换显示/隐藏

---

### 模块5: 欢迎页重新设计

```
┌──────────────────────────────────────┐
│                                      │
│        🐯 虎猫 TCIDE                  │
│    个人专属 AI 编程 IDE               │
│                                      │
│  ┌────────────┐  ┌────────────┐     │
│  │ 📂 打开项目 │  │ 🆕 新建项目 │     │
│  └────────────┘  └────────────┘     │
│                                      │
│  ─── 最近项目 ────────────────────   │
│  📁 MyAndroidApp    /path/to/project │
│  📁 TCIDE           今天 22:30       │
│  📁 BackendService  昨天             │
│                                      │
│  ─── 快速开始 ────────────────────   │
│  • 配置 API Key 开始使用 AI 功能      │
│  • Ctrl+O 打开已有项目               │
│  • 在 AI 面板输入需求开始编码         │
│                                      │
└──────────────────────────────────────┘
```

**实现方案**:
- 无项目打开时，编辑器区域显示欢迎页
- 最近项目列表（存 electron-store，最多10个）
- 快速操作按钮
- 快捷键提示

---

### 模块6: Toast 通知系统

```
┌──────────────────────────┐
│ ✅ 文件已保存              │  ← 成功
│ ⚠️ 编译失败，查看终端输出   │  ← 警告
│ ❌ API 连接失败，请检查配置  │  ← 错误
│ ℹ️ 已恢复上次快照           │  ← 信息
└──────────────────────────┘
```

**实现方案**:
- 右下角弹出，自动消失（3秒）
- 4种类型：success / warning / error / info
- 队列管理（同时最多显示2条）
- 可手动关闭
- 支持 action 按钮（如"撤销"）

---

### 模块7: 原生菜单栏

```
File    Edit    View    AI    Help
────    ────    ────    ──    ────
Open    Undo    Zen     Chat  About
New     Redo    Panel   Task  Shortcuts
Save    Cut     Term    Build Docs
Exit    Copy    Full           │
        Paste   Screen
        Find
```

**实现方案**:
- `src/main/index.ts` 中 `Menu.buildFromTemplate()` 创建
- macOS 适配（app menu 放在系统菜单栏）
- 快捷键绑定在菜单中显示
- "Help → About" 触发关于对话框

---

### 模块8: 编辑器标签页增强

**当前问题**: 基础切换存在，无关闭/拖拽/右键菜单

**优化方案**:
1. **关闭按钮**: 每个标签页右侧 × 按钮（hover 显示）
2. **标签页右键菜单**: 关闭 / 关闭其他 / 关闭右侧 / 复制路径
3. **标签页拖拽排序**: 使用原生 drag & drop API
4. **未保存指示器**: 标签页名称前显示 ● 圆点
5. **标签页溢出**: 溢出时显示 » 按钮，下拉显示隐藏标签
6. **双击关闭**: 双击标签页关闭（可选）

---

### 模块9: 性能优化与验证

#### 9.1 目标指标

| 指标 | SPEC 目标 | 当前状态 | 验证方法 |
|------|-----------|----------|----------|
| 安装包体积 | ≤80MB | ~100MB | electron-builder 分析 + 移除冗余 |
| 启动内存 | ≤180MB | 待测 | Task Manager / process.memoryUsage() |
| 启动时间 | ≤2秒 | 待测 | performance.now() 测量 |
| 24h 内存增长 | ≤50MB | 待测 | 长期运行 + 内存快照对比 |

#### 9.2 优化措施

1. **包体积优化**:
   - Monaco Editor 按需裁剪（移除不用的语言支持）
   - 移除重复的 release 构建产物
   - 压缩资源文件（PNG→WebP）

2. **启动优化**:
   - 延迟加载非关键模块（lazy import）
   - 欢迎页优先渲染，Monaco 延迟初始化
   - SQLite 索引异步创建

3. **内存优化**:
   - 编辑器 model 缓存限制（最多10个打开文件）
   - AI 对话历史分页加载
   - 文件树虚拟滚动（大量文件时）

---

### 模块10: UI/UX 全面优化

#### 10.1 视觉一致性

| 问题 | 优化 |
|------|------|
| 动画不统一 | 统一使用 CSS transition（200ms ease） |
| 间距不一致 | 统一 8px 网格系统，CSS 变量管理 |
| 颜色分散 | 统一 CSS 变量体系（--bg-*, --text-*, --accent-*, --border-*） |
| 字体大小 | 统一 13px(UI) / 14px(编辑器) / 12px(次要) |

#### 10.2 交互体验

| 问题 | 优化 |
|------|------|
| 无加载状态 | 所有异步操作添加 spinner/skeleton |
| 无空状态 | 文件树/任务列表/聊天面板添加引导文案 |
| 无错误恢复 | 关键操作添加 try-catch + 友好错误提示 |
| 无键盘导航 | Tab/Focus 顺序优化，支持全键盘操作 |

#### 10.3 主题系统

- 暗色主题变量完整定义（当前已有，补全）
- 虎猫品牌色强化（橙色 #FF8C00 在交互元素中的一致使用）
- 状态栏颜色与品牌色统一

---

## 三、实现计划

### Phase 1: P0 核心功能（预计 3-4 小时）

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 1 | 代码大纲面板 | index.html + main.ts + main.css | 1h |
| 2 | 命令面板完整实现 | index.html + main.ts + main.css | 1h |
| 3 | Zen Mode 完善 | main.ts + main.css | 30min |
| 4 | 欢迎页重新设计 | index.html + main.ts + main.css | 30min |
| 5 | 终端增强（IPC桥接+Coder联通） | ipc-handlers.ts + preload.ts + main.ts + index.html | 1h |
| 6 | 项目级搜索 | index.html + main.ts + main.css | 1h |
| 7 | 文件树搜索/过滤 | index.html + main.ts + main.css | 30min |

### Phase 2: P1 体验优化（预计 2-3 小时）

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 8 | Toast 通知系统 | main.ts + main.css | 30min |
| 9 | 编辑器标签页增强（关闭/右键/拖拽） | main.ts + main.css | 1h |
| 10 | 原生菜单栏 | index.ts | 30min |
| 11 | 面包屑导航 | index.html + main.ts + main.css | 30min |
| 12 | UI 一致性优化（CSS变量/间距/颜色） | main.css | 30min |
| 13 | 加载状态 & 空状态引导 | index.html + main.ts + main.css | 30min |

### Phase 3: P2 进阶功能（预计 1-2 小时）

| # | 任务 | 文件 | 工时 |
|---|------|------|------|
| 14 | 性能基准测试 | perf-test.ts | 30min |
| 15 | 包体积优化 | vite.config.ts + monaco裁剪 | 30min |
| 16 | 键盘快捷键自定义 | index.html + main.ts + main.css | 30min |
| 17 | 设置导入/导出 | ipc-handlers.ts + main.ts | 30min |

### Phase 4: 检测与修复（预计 1 小时）

| # | 任务 | 工具 | 工时 |
|---|------|------|------|
| 18 | TypeScript 编译检测 | tsc --noEmit | 15min |
| 19 | 构建测试 | npm run build + electron-builder | 20min |
| 20 | 功能回归测试 | 手动验证所有模块 | 30min |
| 21 | UI 走查 | 视觉一致性检查 | 15min |

---

## 四、文件变更清单

### 修改文件

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/renderer/index.html` | 增强 | +大纲面板 +命令面板 +搜索面板 +欢迎页 +面包屑 |
| `src/renderer/main.ts` | 增强 | +outline +commandPalette +searchPanel +welcome +toast |
| `src/renderer/styles/main.css` | 增强 | +全部新增组件样式 +CSS变量体系完善 |
| `src/renderer/types.d.ts` | 增强 | +新增 API 类型声明 |
| `src/main/ipc-handlers.ts` | 增强 | +terminal IPC +search IPC |
| `src/main/preload.ts` | 增强 | +terminal API +search API |
| `src/main/index.ts` | 增强 | +原生菜单 +启动性能埋点 |
| `src/core/agent/coder-agent.ts` | 增强 | +终端输出回传 |
| `package.json` | 修改 | +版本号升级到 1.1.0 |

### 新增文件

| 文件 | 说明 |
|------|------|
| `src/renderer/components/command-palette.ts` | 命令面板组件 |
| `src/renderer/components/toast.ts` | Toast 通知组件 |
| `src/renderer/components/outline.ts` | 代码大纲组件 |
| `src/renderer/components/search-panel.ts` | 项目搜索组件 |
| `src/renderer/components/welcome.ts` | 欢迎页组件 |

---

## 五、验收标准

1. ✅ 所有 P0 功能模块完整实现且可正常使用
2. ✅ TypeScript 主进程 + 渲染进程零编译错误
3. ✅ Vite 构建成功，无阻塞性警告
4. ✅ electron-builder 打包成功，EXE 可独立运行
5. ✅ 命令面板 Ctrl+Shift+P 正常工作
6. ✅ 代码大纲实时更新，点击跳转正确
7. ✅ 终端实时显示 Coder/TaskRunner 执行输出
8. ✅ Zen Mode 无闪烁切换
9. ✅ 欢迎页显示最近项目，可点击打开
10. ✅ Toast 通知在各操作场景正常显示
11. ✅ 标签页右键菜单功能完整
12. ✅ 原生菜单栏功能完整
13. ✅ UI 视觉一致性（颜色/间距/字体）
14. ✅ 性能指标达标（包体/内存/启动时间）
