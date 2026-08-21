"""
Git 操作 API
增强: git_smart_commit / git_list_branches / git_get_user / git_diff_detailed
"""
import subprocess
import os
import re

_project_root: str = ""

def set_project_root(root: str):
    global _project_root
    _project_root = os.path.abspath(root)

def _run_git(args: list, timeout: int = 30) -> dict:
    try:
        result = subprocess.run(
            ["git"] + args, cwd=_project_root, capture_output=True, text=True,
            timeout=timeout, encoding="utf-8", errors="replace",
        )
        return {"success": result.returncode == 0, "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except FileNotFoundError:
        return {"success": False, "error": "Git not installed"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Git command timed out"}

def git_status() -> dict:
    """获取工作区状态"""
    r = _run_git(["status", "--porcelain"])
    if not r["success"]:
        return r
    files = []
    for line in r["stdout"].split("\n"):
        if len(line) >= 3:
            files.append({"status": line[:2].strip(), "path": line[3:].strip()})
    return {"success": True, "files": files}

def git_diff(path: str = None) -> dict:
    """查看 diff"""
    args = ["diff"]
    if path:
        args.append(path)
    return _run_git(args)

def git_stage_all() -> dict:
    """暂存所有文件"""
    return _run_git(["add", "-A"])

def git_commit(message: str) -> dict:
    """提交"""
    return _run_git(["commit", "-m", message])

def git_push(remote: str = "origin", branch: str = "") -> dict:
    """推送"""
    args = ["push", remote]
    if branch:
        args.append(branch)
    return _run_git(args, timeout=60)

def git_pull(remote: str = "origin") -> dict:
    """拉取"""
    return _run_git(["pull", remote], timeout=60)

def git_log(count: int = 20) -> dict:
    """提交历史"""
    r = _run_git(["log", "--oneline", f"-{count}"])
    if not r["success"]:
        return r
    commits = []
    for line in r["stdout"].split("\n"):
        if line:
            parts = line.split(" ", 1)
            commits.append({"hash": parts[0], "message": parts[1] if len(parts) > 1 else ""})
    return {"success": True, "commits": commits}

def git_branches() -> dict:
    """分支列表"""
    r = _run_git(["branch", "-a"])
    if not r["success"]:
        return r
    branches = []
    current = ""
    for line in r["stdout"].split("\n"):
        line = line.strip()
        if line.startswith("* "):
            current = line[2:]
            branches.append(current)
        elif line:
            branches.append(line)
    return {"success": True, "branches": branches, "current": current}

def git_checkout(branch: str) -> dict:
    """切换分支"""
    return _run_git(["checkout", branch])

def git_blame(filepath: str) -> dict:
    """git blame 每行作者+日期"""
    r = _run_git(["blame", "--line-porcelain", filepath])
    if not r["success"]:
        return r
    lines = []
    current = {}
    for line in r["stdout"].split("\n"):
        if line.startswith("author "):
            current["author"] = line[7:]
        elif line.startswith("author-time "):
            current["author_time"] = int(line[12:])
        elif line.startswith("author-mail "):
            current["author_mail"] = line[12:]
        elif not line.startswith(" ") and not line.startswith("\t") and line.strip():
            if not line.startswith(("previous", "filename", "boundary", "summary", "filename")):
                current["content"] = line
                lines.append(current)
                current = {}
    return {"success": True, "lines": lines}

def git_smart_commit(message: str = None) -> dict:
    """自动生成 conventional commit message"""
    status = _run_git(["status", "--porcelain"])
    if not status["success"]:
        return status
    if not status["stdout"].strip():
        return {"success": False, "error": "Nothing to commit"}
    added, modified, deleted = [], [], []
    for line in status["stdout"].split("\n"):
        if len(line) >= 3:
            s = line[:2].strip()
            f = line[3:].strip()
            if s in ("A", "??"):
                added.append(f)
            elif s == "D":
                deleted.append(f)
            else:
                modified.append(f)
    if not message:
        if added and not modified and not deleted:
            scope = _detect_scope(added)
            message = f"feat{scope}: add {', '.join(added[:3])}" + (f" +{len(added)-3} more" if len(added) > 3 else "")
        elif deleted and not added:
            scope = _detect_scope(deleted)
            message = f"feat{scope}: remove {', '.join(deleted[:3])}" + (f" +{len(deleted)-3} more" if len(deleted) > 3 else "")
        elif modified:
            scope = _detect_scope(modified)
            message = f"fix{scope}: update {', '.join(modified[:3])}" + (f" +{len(modified)-3} more" if len(modified) > 3 else "")
        else:
            message = f"chore: update {len(added)+len(modified)+len(deleted)} files"
    _run_git(["add", "-A"])
    return git_commit(message)

def _detect_scope(files: list) -> str:
    """从文件路径推断 scope"""
    if not files:
        return ""
    exts = set(os.path.splitext(f)[1] for f in files)
    if ".py" in exts:
        return "(api)" if any("api" in f for f in files) else "(python)"
    if exts & {".ts", ".tsx", ".js", ".jsx"}:
        return "(ui)" if any("renderer" in f for f in files) else "(core)"
    if ".md" in exts:
        return "(docs)"
    return ""

def git_list_branches() -> dict:
    """分支列表，按提交时间排序"""
    r = _run_git(["branch", "-v", "--sort=-committerdate",
                   "--format=%(refname:short)|%(committerdate:iso8601)|%(subject)"])
    if not r["success"]:
        return git_branches()
    branches = []
    cr = _run_git(["branch", "--show-current"])
    current = cr.get("stdout", "") if cr["success"] else ""
    for line in r["stdout"].split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|", 2)
        name = parts[0].strip()
        branch = {
            "name": name,
            "lastCommit": parts[1].strip() if len(parts) > 1 else "",
            "message": parts[2].strip() if len(parts) > 2 else "",
        }
        if name == current:
            branch["current"] = True
        branches.append(branch)
    return {"success": True, "branches": branches, "current": current}

def git_get_user() -> dict:
    """获取 git user.name 和 user.email"""
    name_r = _run_git(["config", "user.name"])
    email_r = _run_git(["config", "user.email"])
    return {"success": True, "name": name_r.get("stdout", ""), "email": email_r.get("stdout", "")}

def git_diff_detailed(filepath: str = None) -> dict:
    """详细 diff：added/removed/modified 行号"""
    args = ["diff", "--unified=3", "HEAD"]
    if filepath:
        args.extend(["--", filepath])
    r = _run_git(args, timeout=15)
    if not r["success"]:
        return r
    diff_text = r["stdout"]
    if not diff_text:
        return {"success": True, "diff": "", "added": [], "removed": [], "files": [], "stats": {"added": 0, "removed": 0}}
    added, removed = [], []
    files_changed = []
    current_file = ""
    line_old, line_new = 0, 0
    for line in diff_text.split("\n"):
        if line.startswith("diff --git"):
            m = re.search(r"b/(.+)$", line)
            if m:
                current_file = m.group(1)
                files_changed.append(current_file)
        elif line.startswith("@@"):
            m = re.search(r"@@ -(d+)(?:,d+)? +(d+)(?:,d+)? @@", line)
            if m:
                line_old = int(m.group(1))
                line_new = int(m.group(2))
        elif line.startswith("+") and not line.startswith("+++"):
            added.append({"file": current_file, "line": line_new, "content": line[1:]})
            line_new += 1
        elif line.startswith("-") and not line.startswith("---"):
            removed.append({"file": current_file, "line": line_old, "content": line[1:]})
            line_old += 1
        elif line.startswith(" ") or not line.startswith(("+++", "---")):
            line_old += 1
            line_new += 1
    return {
        "success": True, "diff": diff_text, "added": added, "removed": removed,
        "files": files_changed, "stats": {"added": len(added), "removed": len(removed)},
    }
