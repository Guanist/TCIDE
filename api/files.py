"""
文件操作 API
"""
import os
import shutil
from pathlib import Path

# 安全限制：只允许访问项目目录内的文件
_project_root: str = ""


def set_project_root(root: str):
    global _project_root
    _project_root = os.path.abspath(root)


def _safe_path(p: str) -> str:
    """防止路径遍历攻击"""
    full = os.path.abspath(os.path.join(_project_root, p) if not os.path.isabs(p) else p)
    if not full.startswith(_project_root) and _project_root:
        raise PermissionError(f"Access denied: {p}")
    return full


def read_file(path: str) -> dict:
    fp = _safe_path(path)
    if not os.path.exists(fp):
        return {"error": "File not found"}
    stat = os.stat(fp)
    if stat.st_size > 50 * 1024 * 1024:
        return {"error": "File too large (>50MB)"}
    try:
        content = Path(fp).read_text(encoding="utf-8")
    except UnicodeDecodeError:
        content = Path(fp).read_text(encoding="latin-1")
    return {"content": content, "path": fp, "size": stat.st_size}


def write_file(path: str, content: str) -> dict:
    fp = _safe_path(path)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    Path(fp).write_text(content, encoding="utf-8")
    return {"success": True, "path": fp}


def delete_file(path: str) -> dict:
    fp = _safe_path(path)
    if os.path.isdir(fp):
        shutil.rmtree(fp)
    else:
        os.remove(fp)
    return {"success": True}


def rename_file(old_path: str, new_path: str) -> dict:
    fp_old = _safe_path(old_path)
    fp_new = _safe_path(new_path)
    os.rename(fp_old, fp_new)
    return {"success": True, "path": fp_new}


def read_dir(path: str = "", depth: int = 1) -> list:
    target = _safe_path(path) if path else _project_root
    if not os.path.isdir(target):
        return []
    return _scan_dir(target, depth, 0)


def _scan_dir(dirpath: str, max_depth: int, current_depth: int) -> list:
    skip = {".git", "node_modules", "__pycache__", ".venv", "dist", ".next", ".tcide"}
    items = []
    try:
        entries = sorted(os.scandir(dirpath), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return []
    for entry in entries:
        if entry.name.startswith(".") and entry.name not in (".env", ".gitignore"):
            continue
        if entry.name in skip:
            continue
        item = {
            "name": entry.name,
            "path": entry.path,
            "type": "directory" if entry.is_dir() else "file",
        }
        if entry.is_dir() and current_depth < max_depth:
            item["children"] = _scan_dir(entry.path, max_depth, current_depth + 1)
        items.append(item)
    return items


def create_directory(path: str) -> dict:
    fp = _safe_path(path)
    os.makedirs(fp, exist_ok=True)
    return {"success": True}


def get_file_stats(path: str) -> dict:
    fp = _safe_path(path)
    s = os.stat(fp)
    return {
        "size": s.st_size,
        "modified": int(s.st_mtime * 1000),
        "isDir": os.path.isdir(fp),
    }
