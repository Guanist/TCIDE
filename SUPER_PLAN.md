# TCIDE「超级化」实施计划（C 档：真 MCP + 真 LSP + 长期记忆 + 多 Agent 并行 + 自动验证）

> 目标：让虎猫 TCIDE 真正配得上"个人专属超级 AI 编程 IDE"，在真实项目里闭环干活、接入生态。
> 作者：AI 工程师。基于 2026-08-18 实挖源码（非推测）。

## 一、真实能力基准（已实挖确认）

**已在的硬地基（不要动）：**
- 8 轮自主 Agent 工具循环：`src/main/ipc-handlers.ts` `ai:send-with-tools`，真实 `executeTool` 调文件/终端/git/子 Agent
- 92 个 IPC 通道齐全
- 多 Agent orchestrator 真串联：`src/core/agent/agent-orchestrator.ts`（builder→coder→reviewer→task-runner，392 行）
- LSP 引擎**不是空壳**：`src/main/lsp-manager.ts` 顶部 `@ts-nocheck`（整文件 CRLF 压成一行），内是完整手写 LSP 客户端（spawn + Content-Length 帧解析 + initialize 握手 + hover/definition/references + publishDiagnostics 钩子），且已接进 `ipc-handlers`
- 熵评估接进 context trimming

**真实缺口（C 档要补）：**
1. **MCP 是伪的**：`mcp:listTools` 直接 `return listTools()`（只内置 BUILTIN_TOOLS），`mcp:callTool` 直接 `executeTool`，**无外部 MCP server 连接层**（无 connectServer/spawn/JSON-RPC）
2. **LSP 诊断没桥接 renderer**：`lsp-manager` 有 `onServerMessage` + publishDiagnostics 钩子，但 `ipc-handlers` 里 `publishDiagnostics:false`——诊断产生后没发到渲染进程显示
3. **项目级长期记忆为零**：`vector-indexer` 文件存在但 `ipc-handlers` 和 `renderer` 均无引用，未接
4. **多 Agent reviewer 未真审**：orchestrator 调了 reviewer，但需确认 reviewer 输出是否回灌 coder 修正循环
5. **Agent 循环不知编译/测试失败**：能改文件，但改完不自动跑 lint/test 验证

## 二、分步方案（每步独立可验证，不破坏现有循环）

### Step 1 — 真 MCP 连接层（最高杠杆，先做）
文件：`src/main/mcp-tools.ts`（新增 `connectServer`/`disconnectServer`/`listExternalTools`/`callExternalTool`，用 `child_process.spawn` + stdio JSON-RPC 2.0 帧解析）+ `src/main/ipc-handlers.ts`（mcp handler 改合并内置+外部工具）

实现要点：
- 支持 stdio transport 的 MCP server（社区主流，如 `@modelcontextprotocol/server-*`）
- 启动时发 `initialize` → `notifications/initialized` → `tools/list`
- 缓存工具清单到 `mcp:listTools`（合并 BUILTIN_TOOLS + 外部）
- `mcp:callTool` 按工具来源路由到 `executeTool` 或外部 server 的 `tools/call`
- 配置：在 projectRules/settings 加 `mcpServers` 段（沿用竞品格式 `{ "mcpServers": { "name": { "command": "...", "args": [...] } } }`）
- 进程管理：app 退出时全部 kill；server 崩溃自动重连一次

验证：配置一个本地 `everything`/`filesystem` MCP server → 聊天里让 AI 调它 → 返回真实结果。

### Step 2 — LSP 诊断桥接 renderer（让编辑器"活"起来）
文件：`src/main/ipc-handlers.ts`（在 `onServerMessage` 回调里 `win.webContents.send('lsp:diagnostics', ...)`）+ `src/renderer/lsp-client.ts` 接收并渲染到 Monaco markers + 设置面板加"语言服务器状态"显示
- 修复 `publishDiagnostics:false` 的缺口
- 项目打开时按语言自动 startServer（python/go/rust/cpp 等）

验证：打开 TS 项目 → 故意写错 → 红波浪线出现 → hover 显示类型。

### Step 3 — 项目级长期记忆（vector-indexer 接活）
文件：`src/core/indexer/vector-indexer.ts`（确认现有实现是否真能 embed；若无 embed 模型则改用轻量 BM25/关键词 + 语义分块）+ 接 `ipc-handlers` 的 `ai:send-with-tools` 注入检索上下文 + 设置面板"重建索引"

验证：打开大项目 → 问"我们项目里 X 是怎么实现的" → 返回基于代码库的检索结果。

### Step 4 — Agent 循环接验证（改完自动跑测试）
文件：`src/main/ipc-handlers.ts` 的 agent 循环，在每轮工具调用后若改了文件，自动触发 `run_command`（如 `npm test`/`pytest`/lint）并把结果回灌下一轮

验证：让 AI "修复这个 bug" → 它改完自动跑测试 → 测试失败则自我修正。

### Step 5 — 多 Agent reviewer 真审闭环
文件：`src/core/agent/agent-orchestrator.ts` 确认 reviewer 输出回灌 coder 的修正轮（目前 orchestrator 392 行，需读全确认链路）

验证：复杂任务 → builder 出方案 → coder 写 → reviewer 审出 3 个问题 → coder 改 → 通过。

## 三、风险与约束
- 改主进程 `src/main/*.ts` 后必须 `tsc -p tsconfig.main.json` 单独重编（vite 不编主进程）
- vite build 清空 assets → 每次补回 p0/p1/p2 模块
- `lsp-manager.ts` 的 `@ts-nocheck` 是历史 CRLF 乱行遗留，Step 2 时可一并整理成正常换行（不引入新功能风险）
- MCP server spawn 需用户机器有 node/npx（已知有）
- 不提交 dist/，发布靠本地打包

## 四、执行顺序建议
按 Step 1 → 2 → 3 → 4 → 5，每步完成即单独 commit + 让用户本机打包验证。
最先做 Step 1（MCP），因为它是和 Codex/Claude Code 对话的入场券，且独立于其他步骤。
