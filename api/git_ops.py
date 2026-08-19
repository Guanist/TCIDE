"""
Git 操作 API
"""
import subprocess
import os

_project_root: str = ""


def set_project_root(root: str):
    global _project_root
    _project_root = os.path.abspath(root)


def _run_git(args: list[str], timeout: int = 30) -> dict:
    try:
        result = subprocess.run(
            ["git"] + args,
            cwd=_project_root,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
        )
        return {
            "success": result.returncode == 0,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
        }
    except FileNotFoundError:
        return {"success": False, "error": "Git not installed"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Git command timed out"}


def git_status() -> dict:
    r = _run_git(["status", "--porcelain"])
    if not r["success"]:
        return r
    files = []
    for line in r["stdout"].split("\n"):
        if len(line) >= 3:
            status = line[:2].strip()
            path = line[3:].strip()
            files.append({"status": status, "path": path})
    return {"success": True, "files": files}


def git_diff(path: str = None) -> dict:
    args = ["diff"]
    if path:
        args.append(path)
    return _run_git(args)


def git_stage_all() -> dict:
    return _run_git(["add", "-A"])


def git_commit(message: str) -> dict:
    return _run_git(["commit", "-m", message])


def git_push(remote: str = "origin", branch: str = "") -> dict:
    args = ["push", remote]
    if branch:
        args.append(branch)
    return _run_git(args, timeout=60)


def git_pull(remote: str = "origin") -> dict:
    return _run_git(["pull", remote], timeout=60)


def git_log(count: int = 20) -> dict:
    r = _run_git(["log", f"--oneline", f"-{count}"])
    if not r["success"]:
        return r
    commits = []
    for line in r["stdout"].split("\n"):
        if line:
            parts = line.split(" ", 1)
            commits.append({"hash": parts[0], "message": parts[1] if len(parts) > 1 else ""})
    return {"success": True, "commits": commits}


def git_branches() -> dict:
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
    return _run_git(["checkout", branch])


def git_blame(path: str) -> dict:
    return _run_git(["blame", "--line-porcelain", path])
