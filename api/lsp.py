"""
LSP 客户端 API
启动/停止语言服务器、发送 LSP 请求，Content-Length 帧解析 + initialize 握手
"""
import json
import os
import subprocess
import threading
import time
import uuid

# 语言服务器配置表
LSP_CONFIGS = {
    "python": {"command": "pyright-langserver", "args": ["--stdio"]},
    "go": {"command": "gopls", "args": []},
    "rust": {"command": "rust-analyzer", "args": []},
    "cpp": {"command": "clangd", "args": []},
    "java": {"command": "jdtls", "args": []},
    "bash": {"command": "bash-language-server", "args": ["start"]},
}

# 服务器状态 {key: {process, config, project_path, buffer, next_id, pending, initialized}}
_servers: dict = {}
_lock = threading.Lock()

def _make_key(language: str, project_path: str = "") -> str:
    """生成服务器 key"""
    return f"{language}:{project_path}" if project_path else language

def _find_server(language: str, project_path: str = "") -> dict | None:
    """查找服务器实例"""
    key = _make_key(language, project_path)
    if key in _servers:
        return _servers[key]
    prefix = f"{language}:"
    for k, v in _servers.items():
        if k.startswith(prefix):
            return v
    return None

def _parse_frames(buffer: bytes) -> tuple[list, bytes]:
    """解析 Content-Length 帧，返回 (messages, remaining_buffer)"""
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

def _send_message(state: dict, method: str, params: dict, is_notification: bool = False) -> dict | None:
    """发送 LSP 消息，非通知则等待响应"""
    proc = state.get("process")
    if not proc or proc.poll() is not None:
        return {"error": "Server not running"}

    msg_id = None if is_notification else state.get("next_id", 1)
    if msg_id is not None:
        state["next_id"] = msg_id + 1
        state.setdefault("pending", {})

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

    # 等待响应（最多30秒）
    deadline = time.time() + 30
    while time.time() < deadline:
        if proc.poll() is not None:
            return {"error": "Server exited"}
        # 读取 stdout
        try:
            raw = proc.stdout.read(4096)
            if raw:
                msgs, state["buffer"] = _parse_frames(state.get("buffer", b"") + raw)
                for m in msgs:
                    if m.get("id") == msg_id:
                        if "error" in m:
                            return {"error": m["error"].get("message", str(m["error"]))}
                        return m.get("result")
                    # 通知消息暂存
                    state.setdefault("notifications", []).append(m)
        except Exception:
            time.sleep(0.01)
    return {"error": "Request timed out"}

def start_server(language: str, project_path: str) -> dict:
    """启动语言服务器"""
    config = LSP_CONFIGS.get(language)
    if not config:
        return {"error": f"Unsupported language: {language}"}

    key = _make_key(language, project_path)
    with _lock:
        # 已有则先停
        if key in _servers:
            stop_server(language, project_path)

        cmd = config["command"]
        args = config["args"]
        # 某些需要 npx
        if language == "python":
            cmd = "npx"
            args = ["pyright-langserver", "--stdio"]

        try:
            proc = subprocess.Popen(
                [cmd] + args, cwd=project_path,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        except FileNotFoundError:
            return {"error": f"Command not found: {config['command']}"}

        state = {
            "process": proc, "config": config, "project_path": project_path,
            "buffer": b"", "next_id": 1, "pending": {}, "notifications": [],
            "initialized": False, "started_at": time.time(),
        }
        _servers[key] = state

    # initialize 握手
    init_result = _send_message(state, "initialize", {
        "processId": os.getpid(),
        "capabilities": {},
        "rootUri": "file:///" + project_path.replace("\\", "/"),
        "clientInfo": {"name": "TCIDE", "version": "0.1.0"},
    })
    if init_result and "error" in init_result:
        return init_result

    _send_message(state, "initialized", {}, is_notification=True)
    state["initialized"] = True
    return {"success": True, "language": language, "pid": proc.pid}

def stop_server(language: str, project_path: str = "") -> dict:
    """停止语言服务器"""
    key = _make_key(language, project_path)
    state = _servers.pop(key, None)
    if not state:
        # 查找并删除
        prefix = f"{language}:"
        for k in list(_servers.keys()):
            if k.startswith(prefix):
                state = _servers.pop(k)
                break
    if not state:
        return {"error": "Server not found"}

    proc = state.get("process")
    if proc:
        try:
            _send_message(state, "shutdown", {}, is_notification=True)
            _send_message(state, "exit", {}, is_notification=True)
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

def get_status(language: str, project_path: str = "") -> dict:
    """查询服务器状态"""
    state = _find_server(language, project_path)
    if not state:
        return {"running": False}
    proc = state.get("process")
    alive = proc is not None and proc.poll() is None
    return {
        "running": alive,
        "language": language,
        "initialized": state.get("initialized", False),
        "pid": proc.pid if proc else None,
        "uptime": time.time() - state.get("started_at", time.time()),
    }

def send_request(language: str, method: str, params: dict, project_path: str = "") -> dict:
    """发送 LSP 请求"""
    state = _find_server(language, project_path)
    if not state:
        return {"error": f"Server not running for {language}"}
    return _send_message(state, method, params) or {"result": None}

def shutdown_all() -> dict:
    """停止所有服务器"""
    keys = list(_servers.keys())
    for key in keys:
        lang = key.split(":")[0]
        pp = key.split(":", 1)[1] if ":" in key else ""
        stop_server(lang, pp)
    return {"success": True, "stopped": len(keys)}
