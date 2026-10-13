"""
调试管理 API
断点管理（设置/移除/列出），调试状态跟踪
"""
import os
import uuid

# 断点存储 {id: {id, file, line, column, enabled, condition, hitCount, logMessage}}
_breakpoints: dict = {}

# 调试状态
_state = {
    "running": False,
    "paused": False,
    "reason": None,
    "currentFrame": None,
    "allFrames": [],
    "variables": [],
}

def set_breakpoint(file: str, line: int, condition: str = None, column: int = None, log_message: str = None) -> dict:
    """设置断点"""
    bp_id = f"{file}:{line}{':' + str(column) if column else ''}"
    existing = _breakpoints.get(bp_id)
    _breakpoints[bp_id] = {
        "id": bp_id,
        "file": file,
        "line": line,
        "column": column,
        "enabled": existing["enabled"] if existing else True,
        "condition": condition,
        "hitCount": existing["hitCount"] if existing else 0,
        "logMessage": log_message,
    }
    return {"success": True, "breakpoint": _breakpoints[bp_id]}

def remove_breakpoint(bp_id: str) -> dict:
    """移除断点"""
    if bp_id in _breakpoints:
        del _breakpoints[bp_id]
        return {"success": True}
    return {"error": f"Breakpoint not found: {bp_id}"}

def get_breakpoints(file: str = None) -> dict:
    """列出断点，可按文件过滤"""
    bps = list(_breakpoints.values())
    if file:
        bps = [b for b in bps if b["file"] == file]
    return {"breakpoints": bps, "total": len(bps)}

def toggle_breakpoint(bp_id: str) -> dict:
    """切换断点启用状态"""
    bp = _breakpoints.get(bp_id)
    if not bp:
        return {"error": f"Breakpoint not found: {bp_id}"}
    bp["enabled"] = not bp["enabled"]
    return {"success": True, "enabled": bp["enabled"]}

def clear_all_breakpoints() -> dict:
    """清除所有断点"""
    count = len(_breakpoints)
    _breakpoints.clear()
    return {"success": True, "removed": count}

def hit_breakpoint(bp_id: str) -> dict:
    """记录断点命中"""
    bp = _breakpoints.get(bp_id)
    if bp:
        bp["hitCount"] = bp.get("hitCount", 0) + 1
        return {"success": True, "hitCount": bp["hitCount"]}
    return {"error": "Not found"}

def has_enabled_breakpoint(file: str, line: int) -> dict:
    """检查某行是否有启用的断点"""
    bp_id = f"{file}:{line}"
    bp = _breakpoints.get(bp_id)
    enabled = bp is not None and bp.get("enabled", False)
    return {"hasBreakpoint": enabled, "breakpoint": bp}

def get_breakpoints_at(file: str, line: int) -> dict:
    """获取某行的所有断点"""
    bps = [b for b in _breakpoints.values() if b["file"] == file and b["line"] == line]
    return {"breakpoints": bps}

def update_state(partial: dict) -> dict:
    """更新调试状态"""
    _state.update(partial)
    return {"success": True, "state": get_state()}

def get_state() -> dict:
    """获取当前调试状态"""
    return dict(_state)

def get_variables() -> dict:
    """获取当前变量"""
    return {"variables": _state.get("variables", [])}

def get_call_stack() -> dict:
    """获取调用栈"""
    return {"frames": _state.get("allFrames", [])}

def reset() -> dict:
    """重置调试状态"""
    _state.update({
        "running": False, "paused": False, "reason": None,
        "currentFrame": None, "allFrames": [], "variables": [],
    })
    return {"success": True}
