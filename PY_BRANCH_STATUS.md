# tcide-py 分支改造记录（去 PawUI + 补齐前端契约）

> 本文记录这一轮对 `tcide-py` 分支做的改动、验证方式与**诚实的限制**。
> 验证脚本都随仓库提供，可复现。

## 一、结论

| 指标 | 改前 | 改后 |
|---|---|---|
| 前端调用但后端**没有/对不上**的接口 | **42** | **0** |
| 后端路由数 | 105 | **147** |
| 离线测试 | **0（仓库此前没有任何测试）** | **48 条全过** |
| `pawui` 依赖 | `requirements.txt` 里有 | **已移除** |

复现：

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/ -q            # 48 passed
python tools/api_audit.py             # 前端调用 vs 后端路由对账（缺口应为 0）
python main.py --no-window --port 18430   # 真启动，再用 HTTP 打接口
```

## 二、去掉 PawUI

- `main.py`：删掉 `import pawui` / `pawui.run(tcide.paw)`，窗口改用 **PyWebView**；
  另加 `--browser`（用系统浏览器）与 `--version`。
- `requirements.txt`：移除 `pawui`；新增 `requirements-dev.txt`（pytest）。
- 界面本体仍是 **`web/`**（原 Electron 渲染层的 Vite 构建产物 + `electron-shim.js`
  把 `window.api.*` 映射成 REST 调用）。PawUI 那条路是并行的第二套 UI，
  同一份功能要维护两遍，故去掉。

> 遗留：`tcide.paw` / `tcide_pawui.py` / `main_pawui.py` / `tcide_pawui_v2.py` /
> `richweb.py` 这些文件仍在仓库里（未删，避免误删可能仍有参考价值的内容），
> 但它们**已不在启动路径上**。

## 三、修掉的真实缺陷（都不是猜的）

| 症状 | 根因 | 修法 |
|---|---|---|
| 界面上「打开项目」直接失败 | `POST /api/project/open` 解析 JSON body，而前端**只带 `?path=`** → `JSONDecodeError` | 新增宽容的 `read_json()`；query 与 body 都接受 |
| 「代码熵评估」永远 422 | 前端发 `?path=`，后端只声明 `file_path` | 两个参数名都接受 |
| LSP 在界面上永远起不来 | `/api/lsp/start|stop` 同样解 body（前端不带 body） | 同上；并**先探测服务器是否可用**，没装就返回安装指引（原来直接 spawn → `OSError WinError 123` → 500） |
| 换端口/换地址后前端**全部请求打空** | `electron-shim.js` 把后端地址硬编码成 `127.0.0.1:18420` | 改为跟随 `location.origin`（页面本来就是后端发的） |
| 文件树空的（只有 12 字节） | `main.py` 把默认项目**硬编码**成一台机器上的私人路径 | 默认 = 参数 → `TCIDE_PROJECT` → 当前目录（实测列表 12 → 9274 字节） |
| 「无人值守执行」看起来成功其实没干活 | `advanced.UnattendedRunner.run_task` 只是塞几条 `"running"` 就返回 `"completed"` | 新增真执行入口（`tcide_core.runner`：真跑子进程 + 超时/重试/检查点），并用测试钉住"必须有真实输出" |

## 四、补齐的 42 个接口，按"实现方式"分类（便于审阅）

1. **接线到仓库已有引擎**（`advanced.py` 里的对象在启动时就已实例化，但此前
   **从未被任何路由使用**）：代码熵 `/api/entropy/*`、仓库分析 `/api/warehouse/*`、
   分块 `/api/chunker/needs-chunking`、向量 `/api/vector/{init,index-all}`、
   记忆 `/api/memory/init`。
2. **复用 `tcide_core/`**（从 `tcide-pawui` 搬运的纯标准库后端，LGPL-3.0-only，
   不含 PawUI/Qt）：静态检查 `/api/lint`、调用链与影响面 `/api/warehouse/{call-chain,impact}`、
   十六进制 `/api/files/hex`、LSP 透传 `/api/lsp/{request,notify,install-guide}`、
   真执行 `/api/runner/*`、双 Agent `/api/orchestrator/{init,run}`、
   搜索 `/api/search/batch`、会话 `/api/session/{save,restore}`。
3. **直接用标准库/系统能力**：`/api/files/{open,show,open-url}`（系统打开/定位/开链接）、
   `/api/git/stage-all`、`/api/project/watch`（快照比对的变更检测）、
   `/api/project/dialog`（子进程调系统目录选择框）、`/api/debug/*`（**真实 pdb 会话**）、
   `/api/ai/{abort,task-session,chat/tools}`。

**安全边界**：`/api/files/{open,show}` 限制在项目目录内；`open-url` 只允许 http/https；
后端默认只监听 `127.0.0.1`。

## 五、诚实的限制

- **调试**用的是 **pdb**（标准库）驱动真实进程，**不是 DAP**。`continue/next/
  step-in/step-out` 一一映射到 pdb 命令，语义一致；`debugpy` 未安装（装了会出现在
  `/api/debug/adapters` 里）。前端那套 DAP 风格的断点/变量视图需要 DAP 客户端，尚未接入。
- **双 Agent 编排**需要先配置模型（设置 → AI 填 API Key）。未配置时接口返回
  `status: "unconfigured"` + 操作提示，**不会假装跑过**。
- **格式化**目前只支持 Python（且需 `black`）；其它语言如实返回"暂未接入"。
- **文件监听**是快照比对（轮询式），不是 inotify/推送。前端轮询该接口即可；
  推送式需要 WebSocket 广播（仓库已有 WS 基础设施，可作为后续增强）。
- **`advanced.UnattendedRunner` 的"演戏"实现我没删**（改动最小原则），但新增的
  `/api/runner/execute` **绕过它**，并在代码注释与本文件里标注。
- **`api/lsp.py` 的方法包装**仍走原来的实现；通用 `request/notify` 走 `tcide_core`。
  两套并存是刻意的最小改动，后续可合并。

## 六、测试策略

- 全部**离线**（FastAPI `TestClient` + 本地假服务/临时目录），不需要网络与图形界面。
- **不碰真实仓库**：所有会写盘/跑命令的用例都在临时项目目录里做，用完还原项目根
  （历史教训：`tcide-pawui` 那边曾因测试夹具把提交写进真实仓库）。
- 关键用例是"**证明功能是真的**"：`runner` 必须出现真实命令输出、失败命令必须让整体失败、
  调试会话必须真的起进程并单步、未配置模型时必须如实报错。
