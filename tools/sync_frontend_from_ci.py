# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""从 CI 取渲染层产物并同步进 `web/` —— 一条命令，且**强制校验提交号**。

## 为什么需要它

本机构建不了前端（仓库外有个损坏的 package.json 挡住 esbuild），所以流程是
"改源码 → CI 构建 → 下载产物 → 同步"。我手工做过几次，并且**犯过一次真实的错**：

    用 `gh run list --status=success --limit 1` 取"最近成功的构建"，
    结果那个构建属于**更早的提交** → 把旧代码（已经撤掉的界面内宠物）同步回了 web/。

所以这个工具把三件事钉在一起：

1. 只接受**当前 HEAD** 的构建（用 `git rev-parse HEAD` 比对）；
2. 优先选**成功**的那一次；分支也优先与当前分支一致；
3. 产物里若有 `COMMIT` 文件（CI 现在会写），再做一次内容级比对 —— 双保险。

用法：``python tools/sync_frontend_from_ci.py [--branch main] [--force]``
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(line_buffering=True)
ROOT = pathlib.Path(__file__).resolve().parent.parent
WORKFLOW = "frontend.yml"


def git(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=str(ROOT), capture_output=True,
                            text=True, encoding="utf-8", errors="replace")
    return (result.stdout or "").strip()


def gh(*args: str) -> str:
    result = subprocess.run(["gh", *args], capture_output=True, text=True,
                            encoding="utf-8", errors="replace")
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout)[:400])
    return result.stdout


def find_run(branch: str) -> tuple[dict, list[dict]]:
    """找当前 HEAD 的 frontend 运行；返回（选中的运行, 该提交上的全部运行）。"""
    head = git("rev-parse", "HEAD")
    runs = json.loads(gh("run", "list", "--workflow", WORKFLOW, "--limit", "30",
                         "--json", "databaseId,headSha,headBranch,status,conclusion"))
    mine = [run for run in runs if run["headSha"] == head]
    if not mine:
        raise RuntimeError(f"HEAD {head[:7]} 上还没有 {WORKFLOW} 的运行 —— 等 CI 跑完再来")

    def rank(run: dict) -> tuple:
        return (run["conclusion"] == "success",
                run["headBranch"] == branch,
                run["status"] == "completed")

    return sorted(mine, key=rank, reverse=True)[0], mine


def main() -> int:
    parser = argparse.ArgumentParser(description="从 CI 取前端产物并同步到 web/")
    parser.add_argument("--branch", default="", help="优先选该分支的构建")
    parser.add_argument("--force", action="store_true", help="跳过提交号比对")
    args = parser.parse_args()

    branch = args.branch or git("rev-parse", "--abbrev-ref", "HEAD")
    head = git("rev-parse", "HEAD")
    print(f"  本地 HEAD: {head[:7]}（分支 {branch}）")

    chosen, mine = find_run(branch)
    print(f"  该提交上的 {WORKFLOW} 运行 {len(mine)} 个：")
    for run in mine:
        mark = "✓" if run["conclusion"] == "success" else "·"
        print(f"    {mark} {run['headBranch']:<10} {run['status']}/{run['conclusion']}"
              f"  id={run['databaseId']}")
    if chosen["conclusion"] != "success":
        print("  ★ 该提交上没有成功的构建 —— 不能同步（先看 CI 为什么失败）")
        return 1
    print(f"  选定 id={chosen['databaseId']}（{chosen['headBranch']}）")

    sandbox = pathlib.Path(tempfile.mkdtemp(prefix="tcide-artifact-", dir=str(ROOT / ".tcide-build")))
    try:
        gh("run", "download", str(chosen["databaseId"]), "--name", "renderer-dist",
           "--dir", str(sandbox))
        files = sum(1 for _ in sandbox.rglob("*") if _.is_file())
        print(f"  下载了 {files} 个文件")

        stamp = sandbox / "COMMIT"
        if stamp.is_file() and not args.force:
            built = stamp.read_text(encoding="utf-8").strip()
            if built and built != head:
                print(f"  ★ 拒绝同步：产物提交 {built[:7]} ≠ HEAD {head[:7]}")
                return 1
            print(f"  ✓ 产物提交与 HEAD 一致（{built[:7]}）")

        sync = subprocess.run(
            [sys.executable, str(ROOT / "tools" / "sync_frontend.py"),
             "--from", str(sandbox)] + (["--force"] if args.force else []),
            cwd=str(ROOT), capture_output=True, text=True, encoding="utf-8",
            errors="replace")
        print(sync.stdout.rstrip() or sync.stderr.rstrip())
        return sync.returncode
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
