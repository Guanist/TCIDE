# 缺陷清单对照表（REPORT.md 的 60 条 + FEATURE_MATRIX §1/§4 → TCIDE 现状）

**这份文件的用途**：目标要求"逐条修复 FEATURE_MATRIX 记录的缺陷清单"。这份表把清单
**逐条**对照本仓库（`Guanist/TCIDE`，Python 版）的**当前真实状态**，并标出证据。

## 先说清"60 条"到底指什么（**我先前写错过，这里更正**）

我第一次查的时候只看了 `FEATURE_MATRIX.md` 的 §1（22 条）与 §4.3（19 条），据此写下
"**没有 60 条**" ✗ —— **这个结论是错的**。真正的出处是 `tcide-pawui/REPORT.md` §3：

> `## 3. 过程中发现并修复的问题（60 条）`，完整清单**声称**在 `FEATURE_MATRIX.md` §4

那 60 条是**五组之和**（算术吻合：24+8+3+12+13 = 60）：

| 类别 | 条数 |
|---|---|
| 应用自身逻辑缺陷 | 24 |
| 静默失败类 | 8 |
| PawUI 上游问题 | 3 |
| 验证/工具基建事故 | 12 |
| 测试自身缺陷 | 13 |
| **合计** | **60** |

**但还有一件事必须同时说清**：`REPORT.md` 指向的 `FEATURE_MATRIX.md` §4 里
**并没有这 60 条的逐条清单**（§4 只有 7 行数据 + §4.3 的 19 条）。所以：

- **文档声称**修复：**60 条**（按上面五组计数）
- **文档里能逐条枚举**：**41 条**（§1 的 22 + §4.3 的 19；这 19 条是否与上面的"应用自身逻辑缺陷 24"重叠，文档没说，我**不猜**）

对这 60 条整体，本页的结论是：它们都被记录为"**已在 PawUI 版修复**" ✓，其中后端逻辑类
已随本次模块移植进入本仓库 ✓；而 **PawUI 上游问题（3 条）**、**验证/工具基建事故（12 条）**、
**测试自身缺陷（13 条）** 属于 PawUI 版仓库自身的工程过程，与 Python 版不通用 ✓。

---

## A. §1 的 13 个"原版宣称但从未接线"的模块

**结论：13/13 现在都在本仓库有实现**（其中 12 个在本次移植前已就位，1 个本次补上）。

| 原版模块 | 声称能力 | 本仓库实现 | 本次状态 |
|---|---|---|---|
| context-trimmer / smart-trimmer | 32K 智能压缩 | `tcide_core/trimmer.py` | ✅ 已有 |
| entropy-controller | 智能上下文 | `tcide_core/pressure.py` | ✅ 已有（诚实改名：加权启发式，非"熵"） |
| entropy-evaluator | 代码熵评估 | `tcide_core/arch.py` | ✅ 已有（度量并入） |
| git-intelligence | Git 智能 | `tcide_core/gitintel.py` | ✅ **本次移植**（276 行） |
| warehouse-analyzer | 仓库分析 | `tcide_core/indexer.py` + `arch.py` | ✅ 已有 |
| unattended-runner | 无人值守 | `tcide_core/runner.py` | ✅ 已有（PawUI 版里那个假的 `UnattendedRunner` 已删除，指向真实现） |
| semantic-completion | 语义补全 | `tcide_core/completion.py` | ✅ **本次移植**（143 行；诚实定位：前缀补全，不是语义模型） |
| semantic-chunker | 大文件语义切块 | `indexer.chunks()` | ✅ 已有 |
| autoheal-manager | 编译错误自动修复 | `tcide_core/autoheal.py` | ✅ **本次移植**（341 行） |
| arch-analyzer | 架构分析 | `tcide_core/arch.py` | ✅ 已有（Tarjan 真算法） |
| lint-manager | 实时诊断 | `tcide_core/lint.py` | ✅ 已有（11 条规则，纯标准库） |
| perf-optimizer | 内存/性能监控 | `tcide_core/perf.py` | ✅ **本次移植**（196 行；tracemalloc，如实标注） |
| debug-manager | 调试管理 | `tcide_core/debug.py` **+ `dap.py`** | ✅ **本次移植 + 更强**：PawUI 版的 debug 明确不含 DAP 客户端，本仓库有真 DAP（debugpy，命中断点/变量/单步） |

## B. §1 的 3 个"原版前端文件从历史丢失"

| 丢失内容 | 本仓库状态 |
|---|---|
| `acceptDiff` / `closeDiffModal`（Diff 审核弹窗） | ✅ **已具备**（本次查证）：`web/assets/p2-modules.js` 明确引用 `window.acceptDiff` / `window.closeDiffModal` 并操作 `#diff-modal` 元素，实现在主 bundle 内；`p2-modules.js` 还提供"未初始化时只警告不崩"的兜底。前端还有 `getDiff → GET /api/git/diff`（后端 147 条路由中含 `/api/git/diff`） |
| `__tcide_listSnippets` → 实际返回空数组（50+ snippets 为空） | ✅ **本次移植** `tcide_core/snippets.py`（235 行，含 PawUI 专属条目） |
| `__tcide_originalSendToAI` 桥接 | 不适用（Python 版没有这个补丁层） |

## C. §1 的 6 条"原版工程缺口"

| 原版缺口 | 本仓库现状 |
|---|---|
| 0 测试 | ✅ **213 条**（本次从 62 涨到 199，再加 14 条权限测试；本地 212 passed + 1 skipped） |
| 无 CI | ✅ **已修**：新增 `.github/workflows/tests.yml`（push/PR 自动跑测试）。**已实证**：运行 [38373327750](https://github.com/Guanist/TCIDE/actions/runs/38373327750) → `success`，日志里 `212 passed, 1 skipped in 4.94s`（与本地结果一致，**不是空跑**）。刻意不装 `pywebview`（Linux 需 GTK 系统库，而测试完全不依赖 Qt） |
| 无 LICENSE 文件 | ✅ **已修**：`LICENSE` = LGPL-3.0 标准全文；45 个源文件 SPXD 头统一 `LGPL-3.0-only`；有 6 条许可证门禁测试 |
| `dist/` 提交占仓库 60% | ✅ 不适用/已避免：Python 版仓库树里没有 `dist/`（PawUI 版有，那是另一仓库的事） |
| 165 份重复图片 | ✅ 不适用：Python 版没有那批资源 |
| `main.ts` 7,048 行单体 | ✅ 已重写：`server.py`（FastAPI，147 条路由）+ `api/` 分层 + `tcide_core/` 34 个模块 |
| `@ts-nocheck` 11 处 / API key 明文存储 | ✅ key 现在只存用户目录配置文件、界面**脱敏显示**（见 `tcide_core/settings.py` 的 `masked()`），并有测试钉住不泄漏 |

## D. §4.3 的 19 条真 bug

状态：**均已在 PawUI 版修复**，其中与后端逻辑相关的已随模块移植进入本仓库
（`trimmer` / `pressure` / `arch` / `lint` / `runner` / `diff` / `lsp` 等）。
逐条复述见 `tcide-pawui/FEATURE_MATRIX.md` §4.3 —— 这里不重复，避免两份清单漂移。

---

## 仍缺（**如实列出**，不粉饰）

> 原先这里叫"仍缺 / 待核"。第 1、5、6 项已修/已查证（见上表删除线），**现在没有"待核"项了** ——
> 剩下 3 项都是明确的"未做/不做"，不是"没查"。

| # | 项 | 说明 | 影响 |
|---|---|---|---|
| ~~1~~ | ~~`permissions.py` 在本仓库未接线~~ | ✅ **已修**：钩子加在 `tcide_core/tools.py` 的 `call()`（所有工具调用的唯一咽喉），两个 `ToolRegistry` 构造点都注入 `policy=current_policy()`。因为注册表**每次请求新建**，所以档位一改**下次请求即生效**。`current_policy()` 读设置，**读不到就退回 `ask`**（保守方向：宁可多问一次，不默认放行）。新增 14 条测试，其中决定性那条断言"**只读档下写文件返回失败，且文件确实没被写出来**" | — |
| 2 | `tcide_core/term.py` 未移植 | 它直接依赖 Qt/PawUI（移植脚本按规则跳过）。Python 版有自己的 `api/terminal.py` | 低 |
| 3 | 3 个移植测试被移除 | `test_theme.py`（读 PawUI 的 `app.paw`）、`test_panels.py`（依赖 PawUI 夹具）、`test_gitintel.py`（同上）。**模块保留**，只是测试与 PawUI 应用层耦合 | 低：这些模块在本仓库暂无测试 |
| 4 | DAP 集成测试改为开关 | `TCIDE_DAP_TESTS=1` 才跑。默认跳过是因为它与临时目录清理有竞态（会偶发红）。**不是**功能缺失 —— 设开关后 2 条全过 | 低 |
| ~~5~~ | ~~web 前端的 Diff 审核 UI~~ | ✅ **查证为已具备**：`web/assets/p2-modules.js` 引用 `window.acceptDiff` / `window.closeDiffModal` 并操作 `#diff-modal`（实现于主 bundle），前端有 `getDiff → GET /api/git/diff` | — |
| ~~6~~ | ~~CI 是否真的在跑~~ | ✅ **已修并实证**：新增工作流，运行 38373327750 `success`，日志 `212 passed, 1 skipped in 4.94s` | — |

## 本次为这份对照表做了什么

- 把 §1 中**尚缺的 16 个纯 Python 模块**从 `tcide-pawui/tcide/` 移植进本仓库
  `tcide_core/`（导入前缀改写、不覆盖本仓库自己的 `__init__.py`、**不带**依赖 Qt 的部分）
- 连**配套测试**一起搬，并逐个文件验证自洽：保留 6 个（137 条），移除 3 个与 PawUI
  应用层耦合的
- `tcide_core` 模块数 **18 → 34**；用例数 **62 → 199**
- `gitintel` / `completion` / `autoheal` / `perf` / `debug` / `snippets` / `tabs` /
  `panels` / `cli` / `pet` / `plans` / `trace` / `changes` / `theme` / `settings` /
  `permissions` 现在都可被 Python 版直接复用
