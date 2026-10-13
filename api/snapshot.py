"""
文件快照 API
保存/恢复文件快照，用于任务回滚
"""
import json
import os
import time
import uuid
from pathlib import Path

_project_root = ""
_snapshots_dir = ""

def init_snapshots(project_path: str) -> dict:
    """初始化快照目录"""
    global _project_root, _snapshots_dir
    _project_root = os.path.abspath(project_path)
    _snapshots_dir = os.path.join(_project_root, ".tcide", "snapshots")
    os.makedirs(_snapshots_dir, exist_ok=True)
    return {"success": True, "dir": _snapshots_dir}

def save_snapshot(project_path: str, task_id: str, file_path: str, content: str = None) -> dict:
    """保存文件快照"""
    pp = os.path.abspath(project_path)
    sd = os.path.join(pp, ".tcide", "snapshots")
    os.makedirs(sd, exist_ok=True)

    fp = os.path.join(pp, file_path) if not os.path.isabs(file_path) else file_path
    # 如果没传 content，从磁盘读
    if content is None:
        if not os.path.exists(fp):
            return {"error": f"File not found: {file_path}"}
        try:
            content = Path(fp).read_text(encoding="utf-8")
        except UnicodeDecodeError:
            content = Path(fp).read_text(encoding="latin-1")

    snap_id = str(uuid.uuid4())[:12]
    snap = {
        "id": snap_id, "task_id": task_id,
        "file_path": os.path.relpath(fp, pp).replace("\\", "/") if os.path.isabs(fp) else file_path,
        "content": content, "size": len(content),
        "created_at": int(time.time() * 1000),
    }
    snap_file = os.path.join(sd, f"{snap_id}.json")
    try:
        with open(snap_file, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False)
        return {"success": True, "snapshotId": snap_id, "filePath": snap["file_path"], "size": len(content)}
    except Exception as e:
        return {"error": str(e)}

def list_snapshots(project_path: str, file_path: str = None) -> dict:
    """列出快照"""
    pp = os.path.abspath(project_path)
    sd = os.path.join(pp, ".tcide", "snapshots")
    if not os.path.isdir(sd):
        return {"snapshots": []}

    snapshots = []
    for fname in os.listdir(sd):
        if not fname.endswith(".json"):
            continue
        try:
            fp = os.path.join(sd, fname)
            with open(fp, "r", encoding="utf-8") as f:
                snap = json.load(f)
            if file_path and snap.get("file_path") != file_path:
                continue
            snapshots.append({
                "id": snap["id"], "task_id": snap.get("task_id", ""),
                "file_path": snap.get("file_path", ""), "size": snap.get("size", 0),
                "created_at": snap.get("created_at", 0),
            })
        except Exception:
            continue
    snapshots.sort(key=lambda x: -x.get("created_at", 0))
    return {"snapshots": snapshots, "total": len(snapshots)}

def restore_snapshot(snapshot_id: str, project_path: str = "") -> dict:
    """恢复快照到文件"""
    pp = os.path.abspath(project_path) if project_path else _project_root
    sd = os.path.join(pp, ".tcide", "snapshots")
    snap_file = os.path.join(sd, f"{snapshot_id}.json")
    if not os.path.exists(snap_file):
        return {"error": f"Snapshot not found: {snapshot_id}"}
    try:
        with open(snap_file, "r", encoding="utf-8") as f:
            snap = json.load(f)
        content = snap.get("content", "")
        file_path = snap.get("file_path", "")
        fp = os.path.join(pp, file_path)
        os.makedirs(os.path.dirname(fp), exist_ok=True)
        Path(fp).write_text(content, encoding="utf-8")
        return {"success": True, "filePath": file_path, "size": len(content)}
    except Exception as e:
        return {"error": str(e)}

def delete_snapshot(snapshot_id: str, project_path: str = "") -> dict:
    """删除快照"""
    pp = os.path.abspath(project_path) if project_path else _project_root
    sd = os.path.join(pp, ".tcide", "snapshots")
    snap_file = os.path.join(sd, f"{snapshot_id}.json")
    if os.path.exists(snap_file):
        os.remove(snap_file)
        return {"success": True}
    return {"error": f"Snapshot not found: {snapshot_id}"}

def get_snapshot_content(snapshot_id: str, project_path: str = "") -> dict:
    """获取快照内容"""
    pp = os.path.abspath(project_path) if project_path else _project_root
    sd = os.path.join(pp, ".tcide", "snapshots")
    snap_file = os.path.join(sd, f"{snapshot_id}.json")
    if not os.path.exists(snap_file):
        return {"error": f"Snapshot not found: {snapshot_id}"}
    try:
        with open(snap_file, "r", encoding="utf-8") as f:
            snap = json.load(f)
        return {"content": snap.get("content", ""), "file_path": snap.get("file_path", ""),
                "task_id": snap.get("task_id", ""), "created_at": snap.get("created_at", 0)}
    except Exception as e:
        return {"error": str(e)}
