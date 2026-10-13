# TCIDE-Py — 虎猫 AI 编程 IDE（Python 版）

[![License](https://img.shields.io/badge/license-LGPL--3.0-blue.svg)](LICENSE)

虎猫 TCIDE 的 Python 重写版，基于 FastAPI + PyWebView + Monaco Editor。

## 界面截图

两张图都是**真实渲染**：用 Edge 无头模式打开本机正在运行的服务页面截的
（`--headless=new --screenshot`），不是设计稿也不是拼图。

### 深色（默认，黑橙）

![虎猫 TCIDE 深色主题](docs/screenshots/dark.png)

### 浅色（白橙，右下角按钮或有 `?theme=light` 切换）

![虎猫 TCIDE 浅色主题](docs/screenshots/light.png)

两套主题**共用同一支橙**（`#E8802A`）—— 那是这只虎猫的标识色，与桌面端 PawUI 版同源。
配色变量写在 `src/renderer/styles/main.css` 里，浅色主题只是覆盖同一批变量的值。

**看图时请知道的几点（如实标注）**：

- **浅色主题覆盖外壳、面板、AI 侧栏与编辑器** —— 编辑器（Monaco）跟随 `?theme=`、
  `.theme-light` 类与 `data-tcide-theme` 属性三者中的任意一个变化（`isLightThemeActive()`
  是唯一判断依据）。之所以 Monaco 需要**单独一套主题定义**而不是靠 CSS 变量：
  它的主题 API 只接受具体色值，不接受 `var()` —— 所以 `trae-light` 里的颜色是与
  `main.css` 的浅色变量**逐条对齐**的（暖白底 `#FDFAF5`、橙色光标 `#C2651A`）。
- 左下角原有一个**上下文菜单伪影**（应用启动时把 `#tab-context-menu` 显示了出来）。
  产物 CSS 里的 `.context-menu.hidden{display:none}` 是完好的，覆盖层也没有任何
  菜单相关规则，所以**不是主题层造成的**；但具体触发原因本轮**没有查清**，
  因此只是把那一小块按页面底色填掉，特此说明。
- **版本串已统一**：界面（`main.ts` 的 `FIRST_LAUNCH_README`，也就是首启的
  `Welcome.md`）与 `package.json` 的 `versionName` 都显示 `v0.0.1.2`，与发布版本一致。
  `package.json.version` 保持合法 semver（`0.0.1`）—— 四段的 `0.0.1.2` 会被 npm 拒绝，
  真正对外的是 `versionName`。一致性由 `tests/test_frontend_version.py` 钉住。

## 下载与安装（发布包）

除了从源码安装，也可以直接下载发布包：

- **`tcide-0.0.1.2-py3-none-any.whl`** —— 装它即可，前端资源已随包分发：
  ```bash
  pip install tcide-0.0.1.2-py3-none-any.whl
  tcide --browser
  ```
- **`tcide-0.0.1.2.tar.gz`** —— 完整源码包（含前端源码 `src/`、`vite.config.ts`、
  测试与工具），可以自己重建前端。

发布产物本身也有验证脚本（内容断言 + 真装进干净 venv 并起服务）：

```bash
python tools/verify_release.py
```

## 安装与运行

**推荐：用 pip 装**（已验证，见下）

```bash
pip install .          # 从源码目录安装
# 或者隔离安装（推荐，不污染全局环境）
pipx install .
```

装完会得到 `tcide` 命令：

```bash
tcide                  # 打开原生窗口（PyWebView）
tcide --browser        # 用系统浏览器打开
tcide --no-window      # 只跑后端服务（无界面，适合服务器/CI）
tcide /path/to/project # 指定要打开的项目目录
```

**开发时（不安装）**：装好 `requirements.txt` 后直接 `python main.py`。

### 为什么推荐的安装方式是 pip 而不是"冻结打包"

- 本项目的**冻结打包产物在本机无法验证**：冻结后的 PySide6 在 `QApplication()` 处崩溃
  （`0xC0000005`），且已用 5 行最小探针证明**与本项目、spec、QtWebEngine 无关**
  （去掉 WebEngine 的轻量构建同样崩）。
- **pip 安装这条路是本机实测通过的**：
  ```bash
  python tools/verify_install.py
  ```
  它会在一个干净 venv 里真装真跑，并断言：`pip install` 成功、`tcide` 命令生成、
  `web/` 前端资源随包分发到 site-packages、服务能起、首页与 `/assets/...` 都返回 200。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面窗口 | PyWebView |
| 后端 | FastAPI + uvicorn |
| 前端 | Monaco Editor + xterm.js（CDN 加载） |
| AI | OpenAI 兼容 API / Anthropic / Ollama |
| Git | GitPython |
| 终端 | subprocess 多实例 |
| LSP | pyright/gopls/rust-analyzer/clangd |
| MCP | JSON-RPC 2.0 stdio transport |

## 快速开始

```bash
pip install -r requirements.txt
python main.py
```

## 目录结构

```
├── main.py              # 入口：PyWebView 窗口 + FastAPI 后台线程
├── server.py            # FastAPI 路由注册（13个API模块）
├── requirements.txt     # Python 依赖
├── api/
│   ├── files.py         # 文件操作（树/读写/搜索/统计）
│   ├── git_ops.py       # Git 操作（status/diff/commit/push/pull/log/branches）
│   ├── terminal.py      # 终端管理（subprocess 多实例）
│   ├── ai.py            # AI 对话 + Agent 调用（流式/工具调用）
│   ├── settings.py      # 设置管理（JSON 持久化）
│   ├── lsp.py           # LSP 客户端（诊断/补全/跳转/格式化）
│   ├── mcp.py           # MCP 外部工具连接（JSON-RPC 2.0）
│   ├── memory.py        # 上下文记忆（技术栈/风格自动检测）
│   ├── vector.py        # 向量索引（TF-IDF + BM25 语义搜索）
│   ├── snapshot.py      # 文件快照（保存/恢复/对比）
│   ├── usage.py         # 用量统计（token/成本/历史）
│   └── debug.py         # 调试工具（断点/表达式求值）
├── agents/
│   ├── builder.py       # Builder Agent：需求分析 → 任务拆解
│   ├── coder.py         # Coder Agent：代码生成 + 自动重试修复
│   ├── reviewer.py      # Reviewer Agent：代码审查
│   └── orchestrator.py  # Orchestrator：Builder→Coder→Reviewer 流水线
├── adapters/
│   └── llm.py           # 多提供商 LLM 适配器（OpenAI/Anthropic/Ollama）
├── core/                # 核心模块（架构/压缩/批处理等）
└── static/
    └── index.html       # IDE 前端（Monaco + xterm + AI 聊天）
```

## 功能

### 核心功能
- 📂 文件树浏览 + 多标签编辑
- 🖥️ xterm.js 终端（WebSocket 交互）
- 💬 AI 对话（流式输出 + 工具调用循环）
- 🤖 Builder + Coder + Reviewer 三 Agent 协作
- 🔀 Git 全操作（status/diff/commit/push/pull/branches）
- ⚙️ 设置管理（AI/编辑器/主题配置）
- 🎨 暗色主题（VS Code 风格）

### 扩展功能
- 🔗 MCP 工具连接（内置 + 外部服务器）
- 📝 LSP 语言服务（诊断/补全/跳转/格式化）
- 🧠 上下文记忆（技术栈/编码风格自动检测）
- 🔍 语义搜索（TF-IDF + BM25 向量索引）
- 📸 文件快照（保存/恢复/版本对比）
- 📊 用量统计（token/成本/历史记录）
- 🐛 调试工具（断点管理/表达式求值）

## 许可证

[GNU Lesser General Public License v3.0](LICENSE) —— **仅第 3 版**
（SPDX：`LGPL-3.0-only`，**不含** "or any later version"）

本仓库是自由软件：你可以按自由软件基金会发布的 GNU 宽通用公共许可证**第 3 版**
（且**不包括**"或任何更新版本"这一选项）的条款重新发布和/或修改它。

- 各源文件头部带 `SPDX-License-Identifier: LGPL-3.0-only`
- `LICENSE` 是 LGPL-3.0 标准全文；其中附录里的 "or later" 示例声明属于 FSF 文本本身，
  **未作改动** —— 表达"仅第 3 版"靠的是上面这句我们自己的声明
- `web/assets/vendor-xterm-*` 是第三方（xterm.js），**保持它自己的 MIT 授权**
- `tcide_core/` 从 `tcide-pawui` 搬运而来，同样是 `LGPL-3.0-only`

## 分支

| 分支 | 说明 |
|------|------|
| **main** | Python 版（FastAPI + PyWebView + `web/`）—— 当前主线 |
| **tcide-py** | 同一内容的开发分支（与 main 同步） |
| **tag `archive/electron-v0.0.9`** | 旧的 TypeScript Electron 版（已归档保留，可 `git checkout` 找回） |
