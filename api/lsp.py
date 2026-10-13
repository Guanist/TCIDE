"""LSP 适配层：以 ``tcide_core.lsp`` 为**唯一实现**，保留本模块原有的函数名。

## 为什么合并

原来这里是**一套手写的 LSP 客户端**，而它只有 9 个函数 —— 但 ``server.py`` 的
LSP 路由在调用 ``did_open`` / ``did_change`` / ``get_diagnostics`` /
``format_document`` / ``goto_definition`` / ``find_references`` / ``completion``，
这些函数**根本不存在**：路由一旦被前端调到就是 ``AttributeError``。

现在统一走 ``tcide_core.lsp``（纯标准库、带回归测试），并把缺的函数补齐。
对外契约保持**完全不变**，``server.py`` 一行都不用改：

    start_server / stop_server / get_status / did_open / did_change /
    get_diagnostics / format_document / goto_definition / find_references /
    send_request / completion / shutdown_all / LSP_CONFIGS

## 诚实的边界

- **诊断**用 LSP 的"拉取模型"（``textDocument/diagnostic``）。只推
  （``publishDiagnostics``）不拉的服务器会返回空列表 —— 那需要常驻读帧线程，
  本适配层没有，于是**不伪造**诊断。
- 服务器没安装时 ``start_server`` 返回 ``{"error": ..., "hint": ...}``（含安装指引），
  而不是让 ``subprocess`` 抛 ``OSError``（原实现会抛 WinError 123 → 前端只看到 500）。
"""

from __future__ import annotations

import os
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tcide_core.lsp import (LspClient, detect_servers,  # noqa: E402
                            diagnostics_to_issues, path_to_uri, uri_to_path)

#: 语言 → 服务器命令。保留这个名字（原来就是它），内容来自 tcide_core 的探测结果。
#: 初始值与原实现一致，探测后可得到 available/hint（更准）。
LSP_CONFIGS: dict[str, dict] = {
    "python": {"command": "pyright-langserver", "args": ["--stdio"]},
    "go": {"command": "gopls", "args": []},
    "rust": {"command": "rust-analyzer", "args": []},
    "cpp": {"command": "clangd", "args": []},
    "java": {"command": "jdtls", "args": []},
    "bash": {"command": "bash-language-server", "args": ["start"]},
}

_lock = threading.Lock()
#: key = "language:project_path" → LspClient
_clients: dict[str, LspClient] = {}
_configs_loaded = False


def _key(language: str, project_path: str = "") -> str:
    """会话键。与原实现保持一致：没有 project_path 时只用语言名。"""
    return f"{language}:{project_path}" if project_path else language


def _refresh_configs() -> None:
    """把探测结果合并进 LSP_CONFIGS（只做一次）。"""
    global _configs_loaded
    if _configs_loaded:
        return
    try:
        for status in detect_servers():
            entry = LSP_CONFIGS.setdefault(status.language, {})
            entry.update({"command": status.command or entry.get("command", ""),
                          "args": list(status.args or entry.get("args", [])),
                          "available": status.available,
                          "hint": status.hint})
        _configs_loaded = True
    except Exception:      # noqa: BLE001 - 探测失败不影响既有配置
        pass


def _status_for(language: str):
    for status in detect_servers([language]):
        if status.language == language:
            return status
    return None


def _client(language: str, project_path: str = "", *, autostart: bool = True):
    """取（必要时启动）某语言的客户端；返回 ``(client, error)``。"""
    _refresh_configs()
    key = _key(language, project_path)
    with _lock:
        client = _clients.get(key)
    if client is not None and client.running:
        return client, None
    if not autostart:
        return None, f"{language} 的语言服务器尚未启动"
    status = _status_for(language)
    if status is None:
        return None, f"不支持的语言：{language}"
    if not status.available:
        return None, (f"{language} 的语言服务器不可用"
                      f"（{status.command or '未找到'}）{status.hint or ''}").strip()
    client = LspClient(status, os.path.abspath(project_path or "."))
    if not client.start():
        return None, f"{language} 的语言服务器启动失败：{status.command}"
    with _lock:
        _clients[key] = client
    return client, None


def start_server(language: str, project_path: str) -> dict:
    """启动语言服务器（前端 ``lspStart``）。"""
    client, error = _client(language, project_path)
    if error is not None:
        status = _status_for(language)
        return {"error": error,
                "hint": (status.hint if status else "") or
                        "安装对应语言的 LSP 服务器后重试",
                "servers": [item.to_dict() for item in detect_servers([language])]}
    return {"success": True, "language": language, "running": True,
            "key": _key(language, project_path)}


def stop_server(language: str, project_path: str = "") -> dict:
    """停止语言服务器（前端 ``lspStop``）。"""
    key = _key(language, project_path)
    with _lock:
        client = _clients.pop(key, None)
    if client is None:
        return {"success": True, "stopped": False, "reason": "没有正在运行的会话"}
    client.stop()
    return {"success": True, "stopped": True, "language": language}


def get_status(language: str = "", project_path: str = "") -> dict:
    """查询状态。``language == ""`` 时给总览（``server.py`` 就是这么调的）。"""
    _refresh_configs()
    with _lock:
        sessions = sorted(_clients)
    if language:
        client, error = _client(language, project_path, autostart=False)
        return {"language": language, "running": bool(client and client.running),
                "error": error or ""}
    servers = [item.to_dict() for item in detect_servers()]
    return {"running": bool(sessions), "sessions": sessions, "servers": servers,
            "available": [item["language"] for item in servers if item["available"]],
            "configs": LSP_CONFIGS}


def did_open(language: str, uri: str, text: str, project_path: str = "") -> dict:
    """``textDocument/didOpen``。"""
    client, error = _client(language, project_path)
    if error is not None:
        return {"success": False, "error": error}
    ok = client.open_file(uri_to_path(uri), text, language=language)
    return {"success": bool(ok), "uri": uri, "language": language}


def did_change(language: str, uri: str, text: str, version: int = 1,
               project_path: str = "") -> dict:
    """``textDocument/didChange``。"""
    client, error = _client(language, project_path)
    if error is not None:
        return {"success": False, "error": error}
    ok = client.change_file(uri_to_path(uri), text)
    return {"success": bool(ok), "uri": uri, "version": version}


def send_request(language: str, method: str, params: dict,
                 project_path: str = "") -> dict:
    """通用请求（前端 ``lspRequest``）。"""
    client, error = _client(language, project_path)
    if error is not None:
        return {"error": error}
    try:
        return {"result": client.request(method, params or {})}
    except Exception as exc:      # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}"}


def send_notify(language: str, method: str, params: dict,
                project_path: str = "") -> dict:
    """通用通知（前端 ``lspNotify``）：不回结果，只报是否送达。"""
    client, error = _client(language, project_path)
    if error is not None:
        return {"sent": False, "error": error}
    try:
        return {"sent": bool(client.notify(method, params or {}))}
    except Exception as exc:      # noqa: BLE001
        return {"sent": False, "error": f"{type(exc).__name__}: {exc}"}


def completion(language: str, uri: str, line: int, character: int,
               project_path: str = "") -> dict:
    """补全（``textDocument/completion``）。"""
    client, error = _client(language, project_path)
    if error is not None:
        return {"items": [], "error": error}
    return _request_list(client, "textDocument/completion", uri, line, character,
                         key="items")


def get_diagnostics(uri: str, language: str = "", project_path: str = "") -> list:
    """诊断（拉取模型；只推不拉的服务器返回空列表，见模块开头）。"""
    language = language or _language_for_path(uri)
    if not language:
        return []
    client, error = _client(language, project_path)
    if error is not None:
        return []
    try:
        result = client.request("textDocument/diagnostic",
                                {"textDocument": {"uri": path_to_uri(uri)}})
    except Exception:      # noqa: BLE001
        return []
    items = result.get("items") if isinstance(result, dict) else result
    issues = diagnostics_to_issues(uri, items or [], root=project_path or "")
    return [issue.to_dict() for issue in issues]


def format_document(language: str, uri: str, text: str,
                    project_path: str = "") -> list:
    """格式化编辑（``textDocument/formatting``）→ 编辑数组。"""
    client, error = _client(language, project_path)
    if error is not None:
        return []
    try:
        result = client.request("textDocument/formatting", {
            "textDocument": {"uri": path_to_uri(uri)},
            "options": {"tabSize": 4, "insertSpaces": True}})
    except Exception:      # noqa: BLE001
        return []
    return result if isinstance(result, list) else []


def goto_definition(language: str, uri: str, line: int, character: int,
                    project_path: str = "") -> list:
    """跳转定义（``textDocument/definition``）→ 位置数组。"""
    client, error = _client(language, project_path)
    if error is not None:
        return []
    return _position_request(client, "textDocument/definition", uri, line, character)


def find_references(language: str, uri: str, line: int, character: int,
                    project_path: str = "") -> list:
    """查找引用（``textDocument/references``）→ 位置数组。"""
    client, error = _client(language, project_path)
    if error is not None:
        return []
    return _position_request(client, "textDocument/references", uri, line, character,
                             extra={"context": {"includeDeclaration": True}})


def _position_params(uri: str, line: int, character: int,
                     extra: dict | None = None) -> dict:
    params = {"textDocument": {"uri": path_to_uri(uri)},
              "position": {"line": max(0, int(line)),
                           "character": max(0, int(character))}}
    params.update(extra or {})
    return params


def _position_request(client, method: str, uri: str, line: int, character: int,
                      extra: dict | None = None) -> list:
    try:
        result = client.request(method, _position_params(uri, line, character, extra))
    except Exception:      # noqa: BLE001
        return []
    if isinstance(result, dict):
        return [result]
    return result if isinstance(result, list) else []


def _request_list(client, method: str, uri: str, line: int, character: int,
                  *, key: str) -> dict:
    try:
        result = client.request(method, _position_params(uri, line, character))
    except Exception as exc:      # noqa: BLE001
        return {"items": [], "error": f"{type(exc).__name__}: {exc}"}
    items = result.get(key) if isinstance(result, dict) else result
    return {"items": items or [], "raw": result}


def shutdown_all() -> dict:
    """停止所有服务器（lifespan 退出时调用）。"""
    with _lock:
        keys = list(_clients)
    stopped = []
    for key in keys:
        language, _, project_path = key.partition(":")
        stop_server(language, project_path)
        stopped.append(key)
    return {"success": True, "stopped": stopped}


#: 扩展名 → 语言（``get_diagnostics`` 在没给 language 时用）
_EXT_LANGUAGE = {".py": "python", ".go": "go", ".rs": "rust", ".ts": "typescript",
                 ".tsx": "typescript", ".js": "javascript", ".java": "java",
                 ".c": "cpp", ".cc": "cpp", ".cpp": "cpp", ".h": "cpp", ".sh": "bash"}


def _language_for_path(uri: str) -> str:
    return _EXT_LANGUAGE.get(os.path.splitext(uri_to_path(uri))[1].lower(), "")
