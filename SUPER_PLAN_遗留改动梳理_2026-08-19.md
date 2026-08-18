# TCIDE 工作区遗留改动梳理 — 2026-08-19

## 背景
`d98aedc`（全局脚本修复）提交后，工作区仍剩 61 个未提交条目。本次逐类排查其性质，供提交/忽略决策。

## 分类结论

### A. 真实源码改动（需提交）
| 文件 | 性质 |
|------|------|
| `package.json` | 真实改动：`productName` TCIDE → 虎猫 TCIDE（2 处，name 与 build.productName） |
| `src/core/agent/agent-orchestrator.ts` | **仅换行符变化**（LF→CRLF，内容 100% 相同，numstat 空）——git status 显示 M 但实际无内容 diff |

### B. dist/*.js 编译产物（源已提交，dist 滞后）
真实内容 diff 的只有 5 个：
- `dist/core/agent/agent-orchestrator.js` (8/1)
- `dist/main/index.js` (9/1)
- `dist/main/ipc-handlers.js` (183/8) ← 对应 Step2-5（LSP诊断桥接+长期记忆+自动验证+reviewer回灌）
- `dist/main/mcp-tools.js` (212/2) ← 对应 Step1（真 MCP 外部连接层）
- `dist/main/preload.js` (23/0)

其余 30+ 个 dist/*.js 全是 LF→CRLF 换行警告，无内容变化（`core.autocrlf=true` 导致）。

**关键判断**：这些 dist 是编译产物。对应源码（src/main/ipc-handlers.ts、mcp-tools.ts 等）在 `b0d2f09`/`f36bbc7` 已提交。dist 只是后来 `tsc` 重编但没跟提交。因仓库 git 跟踪 dist/（electron-builder `main: dist/main/index.js`，打包用 dist），建议同步提交。

### C. dist/renderer 构建产物 hash 轮换（vite 每次 build 变 hash）
- 删除：旧 hash 的 codicon/editor.worker/index-BRKYKbfv/vendor-monaco-*/vendor-xterm-*
- 修改：index-C3IYXyMJ.css、vendor-xterm-Beg8tuEN.css、index.html(7/7)
- 新增未跟踪：新 hash 的 codicon-BuT2v_Yt/editor.worker-CDU2Z2yo/index-oVECYEfC/vendor-monaco-B3d8ybiG/vendor-xterm-DkwoqAX4

这些是 `npm run build` 的正常产物轮换，git 跟踪 dist/renderer 导致每次 build 都产生大量 churn。**建议整体忽略**（见 .gitignore 建议）。

### D. 未跟踪文件
| 文件 | 建议 |
|------|------|
| `LSP_fix_2026-08-18.md` | ✅ 提交（历史 bug 修复记录） |
| `LSP_fix_2026-08-19.md` | ✅ 提交（本次修复记录） |
| `SUPER_PLAN.md` | ✅ 提交（C 档实施计划，硬地基说明） |
| `resync_github.ps1` | ⚠️ 一次性运维脚本，含 GH_TOKEN 提示，建议提交作记录或忽略 |
| `recovered-modules/p2-modules.js` | ✅ 已在 d98aedc 提交 |
| `dist/locales/` | ❌ **孤儿产物**：无 src/locales 源、无任何 require 引用 → 忽略/删除 |
| `dist/main/handlers/` | ❌ **孤儿产物**：无 src/main/handlers 源、无 require 引用 → 忽略/删除 |
| `src/renderer/dist/` | ❌ **残留构建产物**（index-F9GNeaws.js 7453B + index.html 4975B），src 树内的历史残留 → 忽略/删除 |
| dist/renderer 新 hash assets | 构建产物，见 C |

## 关键事实（后续复用）
- `core.autocrlf=true`，无 `.gitattributes` → 大量 LF→CRLF 假 diff。可加 `.gitattributes` 固定换行。
- `f36bbc7` 是 HEAD 祖先（Step1 已在历史内），master 领先 origin/main 1 个提交（d98aedc）。
- 编译产物依赖：git 跟踪 `dist/`（93 文件，含 44 个 *.js），打包 `main=dist/main/index.js`、`files=dist/**/*`。
- 孤儿目录无引用证据：`dist/main/index.js`、`dist/**/*.js` 均无 `handlers/` 或 `locales` 的 require。

## 建议执行（待用户确认）
1. 提交真实改动：package.json + dist 同步（A+B 合并为一个 commit）。
2. 提交文档：LSP_fix_2026-08-18.md / LSP_fix_2026-08-19.md / SUPER_PLAN.md。
3. .gitignore 追加：`src/renderer/dist/`、`dist/locales/`、`dist/main/handlers/`（或直接删除这三个孤儿目录）。
4. `resync_github.ps1` 视用户意愿提交或忽略。
5. dist/renderer hash 轮换：可整体忽略（git 已跟踪，若要干净需 `git rm --cached` 或接受 churn）。
