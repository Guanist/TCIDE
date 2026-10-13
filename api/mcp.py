"""
MCP 外部 Server 连接 API
JSON-RPC 2.0 + stdio transport，连接外部 MCP server，合并内置+外部工具
"""
import json
import os
import subprocess
import threading
import time

# 内置工具定义（来自 ai.py 的精简版）
BUILTIN_TOOLS = [
    {"name": "read_file", "description": "Read file contents", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}},
    {"name": "write_file", "description": "Write content to file", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "content": {"type": "string"}}}},
    {"name": "list_files", "description": "List directory contents", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}}},
    {"name": "search_code", "description": "Search code in project", "parameters": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"name": "run_command", "description": "Run shell command", "parameters": {"type": "object", "properties": {"command": {"type": "string"}}}},
    {"name": "git_status", "description": "Get git status", "parameters": {"type": "object", "properties": {}}},
    {"name": "git_diff", "description": "Get git diff", "parameters": {"type": "object", "properties": {"file_path": {"type": "string"}}}},
]

# 外部 MCP 客户端状态
_clients: dict = {}  # name -> {process, config, buffer, next_id, pending, tools}
_project_root: str = ""

def set_project_root(root: str):
    global _project_root
    _project_root = os.path.abspath(root)

def _parse_frames(buffer: bytes) -> tuple:
    """Content-Length 帧解析"""
    messages = []
    while True:
        sep = buffer.find(b"\r\n\r\n")
        if sep == -1:
            break
        header = buffer[:sep].decode("utf-8", errors="replace")
        length = 0
        for line in header.split("\r\n"):
            if line.lower().startswith("content-length:"):
                length = int(line.split(":", 1)[1].strip())
        if length == 0:
            buffer = buffer[sep + 4:]
            continue
        body_start = sep + 4
        if len(buffer) < body_start + length:
            break
        body = buffer[body_start:body_start + length].decode("utf-8")
        buffer = buffer[body_start + length:]
        try:
            messages.append(json.loads(body))
        except json.JSONDecodeError:
            pass
    return messages, buffer

def _send_rpc(state: dict, method: str, params: dict, is_notification: bool = False):
    """发送 JSON-RPC 消息"""
    proc = state.get("process")
    if not proc or proc.poll() is not None:
        return {"error": "Server not running"}

    msg_id = None if is_notification else state.get("next_id", 1)
    if msg_id is not None:
        state["next_id"] = msg_id + 1

    message = {"jsonrpc": "2.0", "method": method, "params": params}
    if msg_id is not None:
        message["id"] = msg_id

    body = json.dumps(message)
    payload = f"Content-Length: {len(body.encode('utf-8'))}\r\n\r\n{body}"

    try:
        proc.stdin.write(payload.encode("utf-8"))
        proc.stdin.flush()
    except Exception as e:
        return {"error": f"Write failed: {e}"}

    if is_notification:
        return None

    # 等待响应
    deadline = time.time() + 30
    while time.time() < deadline:
        if proc.poll() is not None:
            return {"error": "Server exited"}
        try:
            raw = proc.stdout.read(4096)
            if raw:
                msgs, state["buffer"] = _parse_frames(state.get("buffer", b"") + raw)
                for m in msgs:
                    if m.get("id") == msg_id:
                        return {"error": m["error"]["message"]} if "error" in m else m.get("result")
        except Exception:
            time.sleep(0.01)
    return {"error": "Request timed out"}

def connect_server(name: str, command: str, args: list = None, env: dict = None, project_path: str = "") -> dict:
    """连接外部 MCP server（stdio transport）"""
    if name in _clients:
        disconnect_server(name)

    pp = project_path or _project_root
    full_env = {**os.environ, **(env or {})}

    try:
        proc = subprocess.Popen(
            [command] + (args or []), cwd=pp, env=full_env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except FileNotFoundError:
        return {"error": f"Command not found: {command}"}

    state = {
        "process": proc, "config": {"command": command, "args": args or [], "env": env or {}},
        "project_path": pp, "buffer": b"", "next_id": 1, "pending": {},
        "tools": [], "ready": False, "started_at": time.time(),
    }
    _clients[name] = state

    # stderr 输出线程
    def _read_stderr():
        try:
            while proc.poll() is None:
                data = proc.stderr.read(4096)
                if data:
                    pass  # 可扩展日志
        except Exception:
            pass
    threading.Thread(target=_read_stderr, daemon=True).start()

    # MCP 握手
    init_result = _send_rpc(state, "initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {"tools": {}},
        "clientInfo": {"name": "TCIDE", "version": "0.1.0"},
    })
    if init_result and isinstance(init_result, dict) and "error" in init_result:
        disconnect_server(name)
        return init_result

    _send_rpc(state, "notifications/initialized", {}, is_notification=True)

    # 获取工具列表
    tools_result = _send_rpc(state, "tools/list", {})
    external_tools = []
    if tools_result and isinstance(tools_result, dict):
        for t in tools_result.get("tools", []):
            tool_def = {
                "name": f"{name}__{t['name']}",
                "description": t.get("description", ""),
                "parameters": t.get("inputSchema", {}),
                "_source": "mcp",
                "_server": name,
            }
            external_tools.append(tool_def)
    state["tools"] = external_tools
    state["ready"] = True
    return {"success": True, "name": name, "tools": len(external_tools)}

def disconnect_server(name: str) -> dict:
    """断开 MCP server"""
    state = _clients.pop(name, None)
    if not state:
        return {"error": f"Server {name} not found"}
    proc = state.get("process")
    if proc:
        try:
            _send_rpc(state, "notifications/cancelled", {}, is_notification=True)
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    return {"success": True}

def list_tools() -> dict:
    """合并内置+外部工具"""
    all_tools = list(BUILTIN_TOOLS)
    for name, state in _clients.items():
        all_tools.extend(state.get("tools", []))
    return {"tools": all_tools, "builtin": len(BUILTIN_TOOLS),
            "external": sum(len(s.get("tools", [])) for s in _clients.values())}

def call_tool(name: str, args: dict) -> dict:
    """路由执行工具调用"""
    # 内置工具
    if name in [t["name"] for t in BUILTIN_TOOLS]:
        return _call_builtin(name, args)
    # 外部 MCP 工具
    if "__" in name:
        server_name, tool_name = name.split("__", 1)
        state = _clients.get(server_name)
        if not state:
            return {"error": f"MCP server '{server_name}' not connected"}
        result = _send_rpc(state, "tools/call", {"name": tool_name, "arguments": args})
        if isinstance(result, dict) and "content" in result:
            texts = [c.get("text", str(c)) for c in result.get("content", []) if isinstance(c, dict)]
            return {"result": "\n".join(texts)}
        return {"result": str(result)}
    return {"error": f"Unknown tool: {name}"}

def _call_builtin(name: str, args: dict) -> dict:
    """执行内置工具"""
    try:
        if name == "read_file":
            fp = os.path.join(_project_root, args.get("path", ""))
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                return {"result": f.read()[:8000]}
        elif name == "write_file":
            fp = os.path.join(_project_root, args.get("path", ""))
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(args.get("content", ""))
            return {"result": f"Written to {args.get('path')}"}
        elif name == "list_files":
            d = os.path.join(_project_root, args.get("path", "."))
            skip = {".git", "node_modules", "__pycache__", ".venv", "dist"}
            entries = [e for e in sorted(os.listdir(d)) if e not in skip and not e.startswith(".")]
            return {"result": "\n".join(entries[:100])}
        elif name == "search_code":
            import subprocess as sp
            q = args.get("query", "")
            r = sp.run(f'findstr /s /i /n /c:"{q}" *', shell=True, cwd=_project_root,
                       capture_output=True, text=True, timeout=10, encoding="utf-8", errors="replace")
            return {"result": "\n".join(r.stdout.split("\n")[:30])}
        elif name == "run_command":
            import subprocess as sp
            r = sp.run(args.get("command", ""), shell=True, cwd=_project_root,
                       capture_output=True, text=True, timeout=30, encoding="utf-8", errors="replace")
            return {"result": (r.stdout + r.stderr)[:4000]}
        elif name == "git_status":
            import subprocess as sp
            r = sp.run(["git", "status", "--short"], cwd=_project_root,
                       capture_output=True, text=True, timeout=10, encoding="utf-8", errors="replace")
            return {"result": r.stdout.strip() or "Clean"}
        elif name == "git_diff":
            import subprocess as sp
            cmd = ["git", "diff", "HEAD"]
            fp = args.get("file_path", "")
            if fp:
                cmd.extend(["--", fp])
            r = sp.run(cmd, cwd=_project_root, capture_output=True, text=True,
                       timeout=10, encoding="utf-8", errors="replace")
            return {"result": r.stdout.strip()[:4000] or "No changes"}
        return {"error": f"Unknown builtin: {name}"}
    except Exception as e:
        return {"error": str(e)}

def get_servers() -> dict:
    """列出已连接的 MCP servers"""
    servers = []
    for name, state in _clients.items():
        proc = state.get("process")
        servers.append({
            "name": name,
            "ready": state.get("ready", False),
            "tools": len(state.get("tools", [])),
            "pid": proc.pid if proc else None,
            "running": proc is not None and proc.poll() is None,
        })
    return {"servers": servers}
