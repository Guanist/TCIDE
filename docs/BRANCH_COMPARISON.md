# 两条分支的真实状态对照（目标里的"实地勘察"结论）

> 这份文件补上目标里"先实地勘察 main（Electron/TS）与 tcide-py（Python）两条分支的
> 真实状态与缺陷，**选定主攻栈**"这一步的书面结论。数据都是实测（`git ls-tree` /
> `gh api`），不是叙述。

## 1. 现在的分支拓扑

| 引用 | 提交 | 是什么 |
|---|---|---|
| `main` | `aaf50a1` | **Python 版**（FastAPI + PyWebView + `web/`）—— 已经取代 Electron 版成为主线 |
| `tcide-py` | `aaf50a1` | 与 `main` **完全一致**（差异为空）。本次勘察发现它一度落后 28 个文件 / 5,074 行，已快进同步 |
| tag `archive/electron-v0.0.9` | `e8583cb` | **旧的 Electron/TS 版**（已归档，可随时找回） |
| tag `v0.0.1.3` | 见 release | Python 版当前发布（LGPL-3.0 严格第 3 版） |
| tag `v0.0.1.2` | 见 release | 上一版，不含桌面宠物 |

**可找回性**：`git checkout archive/electron-v0.0.9` 即可回到 Electron 版；标签已推送到
GitHub（`gh api .../git/ref/tags/archive/electron-v0.0.9` 有记录），所以**没有丢**。

## 2. 两条分支的实测对比

| 指标 | Electron/TS 版（`archive/electron-v0.0.9`） | Python 版（`main`） |
|---|---|---|
| 文件总数 | 403 | 136 |
| `dist/` 提交占比 | **93 个（23.1%）** | 0 |
| `src/` 下文件 | 99 | —（改为 `api/` 13 个 + `tcide_core/` 34 个模块） |
| 测试文件 | **0** | **9 个文件 / 213 条用例** |
| LICENSE | **无** | 有（LGPL-3.0 全文 + 45 个源文件 SPDX 头 `LGPL-3.0-only`） |
| CI | 无 | `.github/workflows/tests.yml`（已实证为绿） |
| 后端形态 | `server.js` + `dist/core/**`（构建产物入库） | `server.py`（147 条路由）+ `api/` 分层 + 纯标准库 `tcide_core/` |

**一处更正**：项目早期文档（`FEATURE_MATRIX.md` §1）写"`dist/` 提交占仓库 60%"。
实测按**文件数**是 **23.1%**（若按体积可能更高，但我没有量体积，所以这里只写能证实的数）。
不拿旧数字当结论。

## 3. 为什么选 Python 版作为主攻栈

| 理由 | 证据 |
|---|---|
| 原版的核心病是"**说了但没接线**" | §1 记录了 13 个模块的 preload/IPC 从未接线；Electron 版 **0 测试**，无从验证 |
| 后端可以做到**不依赖界面框架** | `tcide_core/` 34 个模块、纯标准库，测试**完全不依赖 Qt** → 所以 CI 能在 ubuntu 上 4.94 秒跑完 |
| 前端可以复用 | `web/electron-shim.js` 把 `window.api.*` 映射到 REST，于是原本写给 Electron 的渲染层能继续用（含 `acceptDiff`/`closeDiffModal`/`#diff-modal`） |
| 接口缺口可以量化并收敛 | `tools/api_audit.py` 对账：前端调用 82 个接口 / 后端 147 条路由 / **缺口 0** |
| 授权能统一 | 整仓 LGPL-3.0-only（Electron 版连 LICENSE 都没有） |

## 4. Electron 版没有被"丢掉"的部分

- **完整源码**：`archive/electron-v0.0.9`（403 个文件，含 `src/` 99 个、`recovered-modules/`）
- **前端产物**：Python 版的 `web/` 里沿用了原渲染层（`index-*.js`、`p2-modules.js` 等）
- **资源**：`pet_assets/` 等随 main 保留

## 5. 结论

主攻栈 = **Python 版（`main`）**；Electron/TS 版作为**归档分支**保留，随时可对照或找回。
两条分支现在**内容一致**（`tcide-py` 与 `main` 同一个提交），因此不存在"该看哪条"的歧义。
