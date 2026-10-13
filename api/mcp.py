# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""MCP（Model Context Protocol）客户端：JSON-RPC 2.0 over **stdio**。

对应 TCIDE 原版 `main/mcp-tools.ts` 那批"宣称有、实际没接线"的能力。本文件提供
连接外部 MCP server、把它的工具并入本项目的工具表、并按名字路由调用。

## 这一版修掉的真问题（都是"接了真服务器才发现"的）

1. **帧协议用错了** ✗：原实现按 LSP 那样收发 ``Content-Length: N\\r\\n\\r\\n{json}``，
   而 **MCP stdio 的约定是"一行一个 JSON 对象"**。于是任何真服务器都**永远解析不到
   响应**，`tools/list` 只会一路超时 —— 客户端看起来"写了"，实际一次也用不了。
2. **阻塞读** ✗：原来直接 ``proc.stdout.read(4096)``，要凑满 4096 字节才返回；
   真服务器的响应往往只有一两百字节，于是每次都卡到超时。
   现在用**后台读线程**按行读、按 id 派发。
3. **命令没有解析成绝对路径** ✗：Windows 上 npm 装的服务器是 ``.CMD`` shim，
   ``CreateProcess`` 不认 —— 和本项目 LSP 客户端踩过的是**同一个坑**。
4. **`search_code` 绑死 `findstr`** ✗：Windows 专有，Linux/macOS 与 CI 上必坏。
   改成纯 Python 遍历。

设计取舍：传输层与工具路由都在这里，**不引入任何第三方依赖**（只用标准库），
所以能离线严格测试；测试里有一个**说 stdio JSON-RPC 的假服务器**（见
``tests/test_mcp.py``），另有 ``tools/verify_mcp.py`` 负责接**真**服务器出证据。
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time

#: 内置工具（与 tcide_core.tools 的注册表保持同名；这里是给 HTTP 层用的一份精简表）
BUILTIN_TOOLS = [
    {"name": "read_file", "description": "Read file contents",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}},
    {"name": "write_file", "description": "Write content to file",
     "parameters": {"type": "object",
                    "properties": {"path": {"type": "string"},
                                   "content": {"type": "string"}}}},
    {"name": "list_files", "description": "List directory contents",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}},
    {"name": "search_code", "description": "Search code in project",
     "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"name": "run_command", "description": "Run shell command",
     "parameters": {"type": "object", "properties": {"command": {"type": "string"}}}},
    {"name": "git_status", "description": "Get git status",
     "parameters": {"type": "object", "properties": {}}},
    {"name": "git_diff", "description": "Get git diff",
     "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}}},
]

#: 客户端状态：name -> _ServerState
_clients: dict = {}
_project_root: str = ""

#: 默认协议版本（MCP 服务器会回自己支持的版本，这里只是声明我们理解的版本）
PROTOCOL_VERSION = "2024-11-05"
#: 单次请求默认超时（秒）
DEFAULT_TIMEOUT = 30.0


def set_project_root(root: str) -> None:
    global _project_root
    _project_root = os.path.abspath(root or ".")


def resolve_command(command: str) -> str:
    """把命令解析成**绝对路径**。

    为什么必须这么做：Windows 上 npm/pip 装出来的 MCP 服务器是 ``.CMD`` shim，
    而 ``CreateProcess``（也就是 ``subprocess.Popen``）**不会**按 PATHEXT 去解析它 ——
    传裸名字会直接 ``FileNotFoundError: [WinError 2]``。本项目的 LSP 客户端踩过
    同一个坑，这里一开始就做对。
    """
    if not command:
        return command
    if os.path.isabs(command) or os.sep in command:
        return command
    return shutil.which(command) or command


class McpError(RuntimeError):
    """MCP 调用出错（连接失败、超时、服务器返回 error）。"""


class _ServerState:
    """一个 MCP server 的运行时状态（进程 + 读线程 + 待回响应表）。"""

    def __init__(self, name: str, command: str, args: list, cwd: str,
                 env: dict) -> None:
        self.name = name
        self.command = resolve_command(command)
        self.args = list(args or [])
        self.cwd = cwd
        self.env = env
        self.process: subprocess.Popen | None = None
        self.tools: list[dict] = []
        self.ready = False
        self.started_at = time.time()
        #: 我方发出的请求 id -> {"event": Event, "result": ..., "error": ...}
        self.pending: dict[int, dict] = {}
        #: 服务器主动发来的通知（日志等），保留最后若干条便于排查
        self.notifications: list[dict] = []
        self.error = ""
        self._next_id = 1
        self._reader: threading.Thread | None = None
        self._lock = threading.Lock()

    # -- 生命周期 ---------------------------------------------------------

    def start(self) -> None:
        argv = [self.command, *self.args]
        try:
            self.process = subprocess.Popen(
                argv, cwd=self.cwd or None, env=self.env,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, text=True, encoding="utf-8",
                errors="replace", bufsize=1,
                creationflags=(subprocess.CREATE_NO_WINDOW
                               if os.name == "nt" else 0),
            )
        except FileNotFoundError as exc:
            raise McpError(f"命令不存在: {self.command}（{exc}）") from exc
        except OSError as exc:
            raise McpError(f"启动失败: {type(exc).__name__}: {exc}") from exc
        self._reader = threading.Thread(target=self._read_loop, daemon=True)
        self._reader.start()

    def alive(self) -> bool:
        return self.process is not None and self.process.poll() is None

    def stop(self) -> None:
        process, self.process = self.process, None
        if process is None:
            return
        for stream in (process.stdin,):
            try:
                if stream:
                    stream.close()
            except Exception:      # noqa: BLE001
                pass
        try:
            process.terminate()
            process.wait(timeout=5)
        except Exception:      # noqa: BLE001
            try:
                process.kill()
                process.wait(timeout=5)
            except Exception:      # noqa: BLE001
                pass

    # -- 传输（**一行一个 JSON**，不是 Content-Length）--------------------

    def notify(self, method: str, params: dict | None = None) -> None:
        self._write({"jsonrpc": "2.0", "method": method,
                     "params": params or {}})

    def request(self, method: str, params: dict | None = None,
                *, timeout: float = DEFAULT_TIMEOUT):
        with self._lock:
            message_id = self._next_id
            self._next_id += 1
            slot = {"event": threading.Event(), "result": None, "error": None}
            self.pending[message_id] = slot
        self._write({"jsonrpc": "2.0", "id": message_id, "method": method,
                     "params": params or {}})
        if not slot["event"].wait(timeout):
            self.pending.pop(message_id, None)
            raise McpError(f"{method} 超时（{timeout:.0f}s）")
        self.pending.pop(message_id, None)
        if slot["error"] is not None:
            raise McpError(str(slot["error"]))
        return slot["result"]

    def _write(self, message: dict) -> None:
        process = self.process
        if process is None or process.poll() is not None or process.stdin is None:
            raise McpError("服务器未运行")
        line = json.dumps(message, ensure_ascii=False)
        try:
            process.stdin.write(line + "\n")
            process.stdin.flush()
        except Exception as exc:      # noqa: BLE001
            raise McpError(f"写入失败: {type(exc).__name__}: {exc}") from exc

    def _read_loop(self) -> None:
        """按行读 stdout；响应按 id 派发，其余当通知留档。

        **按行**是关键：MCP stdio 的每一行就是一个完整 JSON 对象。
        （原实现按 Content-Length 解析，永远拿不到东西。）
        """
        process = self.process
        if process is None or process.stdout is None:
            return
        try:
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue
                try:
                    message = json.loads(line)
                except json.JSONDecodeError:
                    # 服务器往 stdout 打了非 JSON（有些实现会这样）——留档，不致命
                    self.notifications.append({"raw": line[:500]})
                    continue
                if isinstance(message, dict) and "id" in message \
                        and message["id"] in self.pending:
                    slot = self.pending[message["id"]]
                    if "error" in message:
                        slot["error"] = message["error"].get("message", message["error"])
                    else:
                        slot["result"] = message.get("result")
                    slot["event"].set()
                else:
                    self.notifications.append(message)
                    del self.notifications[:-50]
        except Exception as exc:      # noqa: BLE001
            self.error = f"读线程异常: {type(exc).__name__}: {exc}"
        finally:
            # 进程结束 → 唤醒所有等待者，避免它们白等到超时
            for slot in list(self.pending.values()):
                if slot["error"] is None and slot["result"] is None:
                    slot["error"] = self.error or "服务器已退出"
                slot["event"].set()


# ---------------------------------------------------------------------------
# 公开 API（HTTP 层按这些名字调用）
# ---------------------------------------------------------------------------


def connect_server(name: str, command: str, args: list | None = None,
                   env: dict | None = None, project_path: str = "") -> dict:
    """连接一个外部 MCP server：起进程 → initialize → notifications/initialized → tools/list。"""
    if name in _clients:
        disconnect_server(name)
    target = project_path or _project_root or os.getcwd()
    state = _ServerState(name, command, args or [], target,
                         {**os.environ, **(env or {})})
    try:
        state.start()
        state.request("initialize", {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "clientInfo": {"name": "TCIDE", "version": "0.0.1.2"},
        })
        state.notify("notifications/initialized", {})
        result = state.request("tools/list", {})
    except McpError as exc:
        state.stop()
        return {"error": str(exc)}

    tools: list[dict] = []
    for item in (result or {}).get("tools", []):
        if not isinstance(item, dict) or not item.get("name"):
            continue
        tools.append({
            # 前缀避免与内置工具重名；调用时再拆回来
            "name": f"{name}__{item['name']}",
            "description": item.get("description", ""),
            "parameters": item.get("inputSchema") or {"type": "object"},
            "_source": "mcp",
            "_server": name,
            "_remote": item["name"],
        })
    state.tools = tools
    state.ready = True
    _clients[name] = state
    return {"success": True, "name": name, "tools": len(tools),
            "command": state.command}


def disconnect_server(name: str) -> dict:
    state = _clients.pop(name, None)
    if state is None:
        return {"error": f"Server {name} not found"}
    state.stop()
    return {"success": True}


def disconnect_all() -> None:
    for name in list(_clients):
        disconnect_server(name)


def list_tools() -> dict:
    """合并内置 + 外部工具（外部工具带 ``_source: mcp`` 标记，界面据此区分）。"""
    all_tools = list(BUILTIN_TOOLS)
    for state in _clients.values():
        all_tools.extend(state.tools)
    return {"tools": all_tools, "builtin": len(BUILTIN_TOOLS),
            "external": sum(len(s.tools) for s in _clients.values())}


def call_tool(name: str, args: dict | None = None) -> dict:
    """按名字路由：内置工具本地执行；``server__tool`` 转发给对应 MCP server。"""
    arguments = dict(args or {})
    if name in {tool["name"] for tool in BUILTIN_TOOLS}:
        return _call_builtin(name, arguments)
    if "__" not in name:
        return {"error": f"Unknown tool: {name}"}
    server_name, tool_name = name.split("__", 1)
    state = _clients.get(server_name)
    if state is None:
        return {"error": f"MCP server '{server_name}' not connected"}
    try:
        result = state.request("tools/call",
                               {"name": tool_name, "arguments": arguments})
    except McpError as exc:
        return {"error": str(exc)}
    if not isinstance(result, dict):
        return {"result": str(result)}
    texts = []
    for item in result.get("content") or []:
        if isinstance(item, dict):
            texts.append(item.get("text") or json.dumps(item, ensure_ascii=False))
        else:
            texts.append(str(item))
    payload = {"result": "\n".join(texts) or json.dumps(result, ensure_ascii=False)}
    if result.get("isError"):
        payload["error"] = payload["result"]
    return payload


def get_servers() -> dict:
    servers = []
    for name, state in _clients.items():
        servers.append({
            "name": name,
            "ready": state.ready,
            "command": state.command,
            "tools": len(state.tools),
            "pid": state.process.pid if state.process else None,
            "running": state.alive(),
            "error": state.error,
        })
    return {"servers": servers}


# ---------------------------------------------------------------------------
# 内置工具（HTTP 层用；与 tcide_core.tools 的完整实现并存，这里保持精简）
# ---------------------------------------------------------------------------

#: 搜索时跳过的目录（与 tcide_core.tools 的约定一致）
_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist",
              "build", ".mypy_cache", ".pytest_cache"}
#: 单个文件超过这个大小就不搜（避免在产物文件上卡住）
_MAX_SEARCH_BYTES = 512 * 1024


def _call_builtin(name: str, args: dict) -> dict:
    try:
        root = _project_root or os.getcwd()
        if name == "read_file":
            path = os.path.join(root, args.get("path", ""))
            with open(path, "r", encoding="utf-8", errors="replace") as handle:
                return {"result": handle.read()[:8000]}
        if name == "write_file":
            path = os.path.join(root, args.get("path", ""))
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(args.get("content", ""))
            return {"result": f"Written to {args.get('path')}"}
        if name == "list_files":
            directory = os.path.join(root, args.get("path", "."))
            entries = [item for item in sorted(os.listdir(directory))
                       if item not in _SKIP_DIRS and not item.startswith(".")]
            return {"result": "\n".join(entries[:100])}
        if name == "search_code":
            return {"result": _search_code(root, str(args.get("query", "")))}
        if name == "run_command":
            completed = subprocess.run(args.get("command", ""), shell=True,
                                       cwd=root, capture_output=True, text=True,
                                       timeout=30, encoding="utf-8",
                                       errors="replace")
            return {"result": (completed.stdout + completed.stderr)[:4000]}
        if name == "git_status":
            completed = subprocess.run(["git", "status", "--short"], cwd=root,
                                       capture_output=True, text=True, timeout=10,
                                       encoding="utf-8", errors="replace")
            return {"result": completed.stdout.strip() or "Clean"}
        if name == "git_diff":
            command = ["git", "diff", "HEAD"]
            if args.get("file_path"):
                command.extend(["--", args["file_path"]])
            completed = subprocess.run(command, cwd=root, capture_output=True,
                                       text=True, timeout=10, encoding="utf-8",
                                       errors="replace")
            return {"result": completed.stdout.strip()[:4000] or "No changes"}
        return {"error": f"Unknown builtin: {name}"}
    except Exception as exc:      # noqa: BLE001 - 工具失败不该把请求打挂
        return {"error": f"{type(exc).__name__}: {exc}"}


def _search_code(root: str, query: str, *, limit: int = 30) -> str:
    """纯 Python 的子串搜索。

    原实现调 Windows 专有的 ``findstr`` —— 在 Linux/macOS（以及 CI）上必然失败，
    而且 ``shell=True`` 拼用户输入本身也不安全。这里改成自己遍历，跨平台且可控。
    """
    if not query:
        return ""
    hits: list[str] = []
    for base, dirs, files in os.walk(root):
        dirs[:] = [item for item in dirs if item not in _SKIP_DIRS]
        for filename in files:
            if len(hits) >= limit:
                break
            path = os.path.join(base, filename)
            try:
                if os.path.getsize(path) > _MAX_SEARCH_BYTES:
                    continue
                with open(path, "r", encoding="utf-8", errors="replace") as handle:
                    for number, line in enumerate(handle, 1):
                        if query in line:
                            relative = os.path.relpath(path, root)
                            hits.append(f"{relative}:{number}: {line.strip()[:160]}")
                            if len(hits) >= limit:
                                break
            except (OSError, UnicodeDecodeError):
                continue
    return "\n".join(hits)


# ---------------------------------------------------------------------------
# 配置与"把外部工具交给 AI"
# ---------------------------------------------------------------------------
#
# 背景：MCP 客户端能连上真服务器之后，**AI 仍然用不到它** —— agent 走的是
# tcide_core.tools.ToolRegistry，而外部工具从来没注册进去。也就是
# "能力在、接线没接"。下面这几个函数就是那根线。

#: 配置文件：``<配置目录>/mcp.json``（配置目录遵循 TCIDE_CONFIG_DIR，便于测试隔离）
CONFIG_NAME = "mcp.json"


def config_path() -> str:
    from tcide_core.settings import config_dir

    return str(config_dir() / CONFIG_NAME)


def load_config() -> dict:
    """读 MCP 配置。缺文件/坏文件都返回空配置（**不抛异常**）。

    格式照抄主流客户端（Claude Desktop / Codex 那一类），便于用户直接搬过来::

        {"servers": {"fs": {"command": "npx",
                            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"],
                            "env": {}}}}
    """
    path = config_path()
    if not os.path.isfile(path):
        return {"servers": {}}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {"servers": {}}
    servers = data.get("servers") if isinstance(data, dict) else None
    return {"servers": servers if isinstance(servers, dict) else {}}


def connect_configured(*, project_path: str = "") -> dict:
    """按配置连接所有 MCP server（已连的复用）。返回逐个结果。"""
    results: dict = {}
    for name, spec in load_config().get("servers", {}).items():
        if name in _clients:
            results[name] = {"success": True, "name": name,
                             "tools": len(_clients[name].tools), "cached": True}
            continue
        if not isinstance(spec, dict) or not spec.get("command"):
            results[name] = {"error": "配置缺少 command"}
            continue
        results[name] = connect_server(
            name, str(spec["command"]), list(spec.get("args") or []),
            dict(spec.get("env") or {}), project_path=project_path)
    return results


def tool_specs() -> list:
    """把已连接的外部工具转成 ``tcide_core.tools.ToolSpec``。

    两个关键决定：

    1. **handler 走 :func:`call_tool`** —— 于是权限策略、调用记录、错误包装都用
       注册表那一套，不另开旁路；
    2. **``dangerous=True``** —— 外部工具对我们来说是黑盒（可能写文件、执行命令、
       联网）。不标危险的话，只读档下它会被**直接放行**：权限策略按工具名判断，
       而外部工具名是 ``server__tool``，策略原本认不出来。这是一个真实的安全洞。
    """
    from tcide_core.tools import ToolResult, ToolSpec

    specs = []
    for state in _clients.values():
        for item in state.tools:
            remote_name = item["name"]

            def handler(_name=remote_name, **arguments):
                outcome = call_tool(_name, arguments)
                if outcome.get("error"):
                    return ToolResult(ok=False, error=str(outcome["error"]))
                return ToolResult(ok=True, output=str(outcome.get("result", "")))

            specs.append(ToolSpec(
                name=remote_name,
                description=item.get("description", ""),
                parameters=item.get("parameters") or {"type": "object"},
                handler=handler,
                dangerous=True,
            ))
    return specs


def register_into(registry, *, project_path: str = "") -> int:
    """把已配置的外部工具注册进工具表；返回注册数量。

    幂等；连不上服务器时**不抛异常**（一个 MCP server 挂掉不该让 IDE 起不来），
    失败原因留在 :func:`connect_configured` 的返回值里。
    """
    connect_configured(project_path=project_path)
    count = 0
    for spec in tool_specs():
        registry.register(spec)
        count += 1
    return count
