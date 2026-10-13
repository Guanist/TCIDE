"""
文件操作 API
增强: read_file_raw / search_files / get_file_tree / format_file
"""
import base64
import os
import shutil
import subprocess
from pathlib import Path

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
    """读取文本文件"""
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
    """写入文本文件"""
    fp = _safe_path(path)
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    Path(fp).write_text(content, encoding="utf-8")
    return {"success": True, "path": fp}

def delete_file(path: str) -> dict:
    """删除文件或目录"""
    fp = _safe_path(path)
    if os.path.isdir(fp):
        shutil.rmtree(fp)
    else:
        os.remove(fp)
    return {"success": True}

def rename_file(old_path: str, new_path: str) -> dict:
    """重命名/移动文件"""
    fp_old = _safe_path(old_path)
    fp_new = _safe_path(new_path)
    os.rename(fp_old, fp_new)
    return {"success": True, "path": fp_new}

def read_dir(path: str = "", depth: int = 1) -> list:
    """读取目录结构"""
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
        item = {"name": entry.name, "path": entry.path, "type": "directory" if entry.is_dir() else "file"}
        if entry.is_dir() and current_depth < max_depth:
            item["children"] = _scan_dir(entry.path, max_depth, current_depth + 1)
        items.append(item)
    return items

def create_directory(path: str) -> dict:
    """创建目录"""
    fp = _safe_path(path)
    os.makedirs(fp, exist_ok=True)
    return {"success": True}

def get_file_stats(path: str) -> dict:
    """获取文件统计信息"""
    fp = _safe_path(path)
    if not os.path.exists(fp):
        return {"error": "File not found"}
    s = os.stat(fp)
    return {
        "size": s.st_size,
        "modified": int(s.st_mtime * 1000),
        "created": int(s.st_ctime * 1000),
        "isDir": os.path.isdir(fp),
        "isFile": os.path.isfile(fp),
        "extension": os.path.splitext(fp)[1],
    }

def read_file_raw(path: str) -> dict:
    """读取文件原始内容，二进制文件返回 base64"""
    fp = _safe_path(path)
    if not os.path.exists(fp):
        return {"error": "File not found"}
    stat = os.stat(fp)
    if stat.st_size > 50 * 1024 * 1024:
        return {"error": "File too large (>50MB)"}
    try:
        raw = Path(fp).read_bytes()
        text = raw.decode("utf-8")
        return {"content": text, "path": fp, "size": stat.st_size, "encoding": "utf-8", "binary": False}
    except (UnicodeDecodeError, ValueError):
        b64 = base64.b64encode(raw).decode("ascii")
        return {"content": b64, "path": fp, "size": stat.st_size, "encoding": "base64", "binary": True}

def search_files(query: str, file_pattern: str = "*") -> dict:
    """在项目内全文搜索 grep/findstr"""
    if not query:
        return {"error": "Query is empty"}
    try:
        if os.name == "nt":
            cmd = f'findstr /s /i /n /c:"{query}" "{file_pattern}" 2>nul'
        else:
            cmd = f"grep -rn --include='{file_pattern}' '{query}' . 2>/dev/null"
        result = subprocess.run(cmd, shell=True, cwd=_project_root, capture_output=True, text=True,
                                timeout=15, encoding="utf-8", errors="replace")
        lines = [l for l in result.stdout.split("\n") if l.strip()]
        matches = []
        for line in lines[:100]:
            parts = line.split(":", 2)
            if len(parts) >= 3:
                matches.append({"file": parts[0].strip(), "line": parts[1].strip(), "text": parts[2].strip()})
        return {"matches": matches, "total": len(lines)}
    except subprocess.TimeoutExpired:
        return {"error": "Search timed out"}
    except Exception as e:
        return {"error": str(e)}

_ICON_MAP = {
    ".py": "py", ".js": "js", ".ts": "ts", ".jsx": "js", ".tsx": "ts",
    ".json": "json", ".md": "md", ".html": "html", ".css": "css",
    ".go": "go", ".rs": "rs", ".java": "java", ".xml": "xml", ".sh": "sh",
    ".c": "c", ".cpp": "cpp", ".vue": "vue", ".yaml": "yaml", ".toml": "toml",
}

def _get_icon(name: str, is_dir: bool) -> str:
    if is_dir:
        return "folder"
    ext = os.path.splitext(name)[1].lower()
    return _ICON_MAP.get(ext, "default")

def get_file_tree(path: str = "", depth: int = 3) -> dict:
    """递归文件树，带图标类型标记"""
    target = _safe_path(path) if path else _project_root
    if not os.path.isdir(target):
        return {"error": "Not a directory"}
    return {"tree": _build_tree(target, depth, 0), "root": target}

def _build_tree(dirpath: str, max_depth: int, cur_depth: int) -> list:
    skip = {".git", "node_modules", "__pycache__", ".venv", "dist", ".next", ".tcide", "build", "target"}
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
        is_dir = entry.is_dir()
        node = {
            "name": entry.name,
            "path": os.path.relpath(entry.path, _project_root).replace("\\", "/"),
            "type": "directory" if is_dir else "file",
            "icon": _get_icon(entry.name, is_dir),
        }
        if is_dir:
            node["children"] = _build_tree(entry.path, max_depth, cur_depth + 1) if cur_depth < max_depth else []
        else:
            try:
                node["size"] = os.path.getsize(entry.path)
            except OSError:
                node["size"] = 0
        items.append(node)
    return items

_FORMATTERS = {
    ".py": ["black", "--quiet", "--line-length", "120"],
    ".js": ["npx", "prettier", "--write", "--single-quote"],
    ".ts": ["npx", "prettier", "--write", "--single-quote"],
    ".json": ["npx", "prettier", "--write"], ".css": ["npx", "prettier", "--write"],
    ".go": ["gofmt", "-w"], ".rs": ["rustfmt"],
}

def format_file(path: str) -> dict:
    """根据扩展名调用格式化工具"""
    fp = _safe_path(path)
    if not os.path.exists(fp):
        return {"error": "File not found"}
    ext = os.path.splitext(fp)[1].lower()
    formatter = _FORMATTERS.get(ext)
    if not formatter:
        return {"error": f"No formatter for {ext}"}
    try:
        result = subprocess.run(formatter + [fp], capture_output=True, text=True, timeout=30,
                                encoding="utf-8", errors="replace")
        if result.returncode == 0:
            try:
                c = Path(fp).read_text(encoding="utf-8")
            except UnicodeDecodeError:
                c = Path(fp).read_text(encoding="latin-1")
            return {"success": True, "path": fp, "content": c}
        return {"success": False, "error": result.stderr.strip() or "Format failed"}
    except FileNotFoundError:
        return {"success": False, "error": f"Not installed: {formatter[0]}"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Format timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}
