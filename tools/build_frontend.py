# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""重新构建 Web 前端，并把产物同步到 `web/`。

## 为什么需要"在临时目录里构建"

本机在**仓库外两层**存在一个**损坏的** `package.json`
（`Desktop/Vincent/package.json`，内容是截断的 React Native 清单）。esbuild 在
向上查找最近的 package.json 时会撞上它，直接报
`Unterminated string literal` 并让 `vite build` 失败 —— 而错误信息里显示的路径是
相对的（`../../package.json`），极容易被误判成"仓库里的 package.json 坏了"。

我不去改仓库外那个文件（不属于本项目，动它就是越界）。正确做法是**换个干净的
祖先链**构建：把前端工程复制到临时目录，再用目录联接（junction）挂上 `node_modules`，
于是向上查找不会再遇到那个坏文件。

## 为什么构建后要"重新注入"皮肤

`vite build` 会按 `emptyOutDir` 重建产物目录，`index.html` 也是新生成的 —— 上一轮
挂在里面的皮肤层（`/static/tcide-theme.css` / `.js`）会被冲掉。所以同步时必须
**重新注入**，否则"皮肤"会在某次构建后悄悄消失。

用法：``python tools/build_frontend.py``（可选 ``--keep-web`` 先不覆盖 `web/`）
"""

from __future__ import annotations

import argparse
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

sys.stdout.reconfigure(line_buffering=True)
ROOT = pathlib.Path(__file__).resolve().parent.parent

#: 参与构建的输入（相对仓库根）
INPUTS = ("src", "recovered-modules", "package.json", "vite.config.ts",
          "tsconfig.json", "tsconfig.main.json")

#: 构建后需要重新注入的皮肤引用（顺序很重要：必须在 bundle CSS 之后）
SKIN = ('<link rel="stylesheet" href="/static/tcide-theme.css" />'
        '<script src="/static/tcide-theme.js"></script>')


def run(argv: list[str], cwd: pathlib.Path,
        env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                          encoding="utf-8", errors="replace", shell=os.name == "nt",
                          env=env)


def build_env(sandbox: pathlib.Path) -> dict:
    """给构建子进程一个**干净且可写**的临时目录。

    实测：不这么做时，esbuild 会在最后清理自己的临时文件时报
    ``[vite:esbuild-transpile] remove C:\\...\\Temp\\esbuild-<hash>: Access is denied``
    —— 1064 个模块都已经转译成功了，却卡在收尾。把 TEMP/TMP 指进沙箱即可绕开
    系统临时目录的限制（这也是 esbuild 在 Windows 上的标准解法）。
    """
    temporary = sandbox / "tmp"
    temporary.mkdir(parents=True, exist_ok=True)
    environment = dict(os.environ)
    environment["TEMP"] = str(temporary)
    environment["TMP"] = str(temporary)
    environment["TMPDIR"] = str(temporary)
    return environment


def find_trouble() -> list[pathlib.Path]:
    """向上查找祖先链里损坏的 package.json（只报告，不修改）。"""
    broken: list[pathlib.Path] = []
    for parent in list(ROOT.parents)[:4]:
        candidate = parent / "package.json"
        if not candidate.is_file():
            continue
        import json

        try:
            json.loads(candidate.read_text(encoding="utf-8"))
        except Exception as exc:      # noqa: BLE001
            broken.append(candidate)
            print(f"  ★ 祖先链上有损坏的 package.json（会让构建失败）：{candidate}")
            print(f"    原因：{exc}")
    return broken


def link_node_modules(sandbox: pathlib.Path) -> bool:
    """用目录联接把 node_modules 挂进沙箱（Windows 下不需要管理员）。"""
    target = sandbox / "node_modules"
    source = ROOT / "node_modules"
    if not source.is_dir():
        print("  ★ 仓库里没有 node_modules —— 先跑 npm install --omit=dev && npm i -D vite@5")
        return False
    if os.name == "nt":
        made = run(["cmd", "/c", "mklink", "/J", str(target), str(source)], sandbox)
        if made.returncode != 0:
            print("  ★ 创建目录联接失败：" + (made.stderr or made.stdout)[:200])
            return False
    else:
        try:
            os.symlink(source, target, target_is_directory=True)
        except OSError as exc:
            print(f"  ★ 创建符号链接失败：{exc}")
            return False
    return True


def inject_skin(index_html: pathlib.Path) -> bool:
    text = index_html.read_text(encoding="utf-8")
    if "/static/tcide-theme.css" in text:
        return True
    if text.count("</head>") != 1:
        print("  ★ 新产物里 </head> 不唯一，无法可靠注入皮肤")
        return False
    index_html.write_text(text.replace("</head>", SKIN + "</head>", 1),
                          encoding="utf-8", newline="")
    return True


def sync_to_web(dist: pathlib.Path) -> int:
    """把 dist/renderer 的产物同步到 web/（保留 web/ 里非产物文件的原样）。"""
    web = ROOT / "web"
    copied = 0
    for item in dist.rglob("*"):
        if not item.is_file():
            continue
        relative = item.relative_to(dist)
        target = web / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied += 1
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="重新构建 Web 前端")
    parser.add_argument("--keep-web", action="store_true",
                        help="只构建，不覆盖 web/（用于先看看产物）")
    args = parser.parse_args()

    print("=== 0) 先看祖先链上有没有会拖垮构建的文件 ===")
    find_trouble()

    # 沙箱必须放在**工作区内**：DSH 的沙箱只允许写工作区，放到系统临时目录会在
    # esbuild 收尾删临时文件时报 "Access is denied"（1064 个模块都已转译成功，
    # 却卡在最后一步）。工作区外的失败属于**预期行为**，不该去改文件权限。
    sandbox = ROOT / ".tcide-build" / "frontend"
    if sandbox.exists():
        shutil.rmtree(sandbox, ignore_errors=True)
    sandbox.mkdir(parents=True)
    try:
        print(f"\n=== 1) 复制前端工程到干净沙箱：{sandbox} ===")
        for name in INPUTS:
            source = ROOT / name
            if not source.exists():
                print(f"  · 缺少 {name}（跳过）")
                continue
            target = sandbox / name
            if source.is_dir():
                shutil.copytree(source, target)
            else:
                shutil.copy2(source, target)
        print("  ✓ 已复制：" + ", ".join(n for n in INPUTS if (sandbox / n).exists()))

        print("\n=== 2) 挂上 node_modules（目录联接，不复制）===")
        if not link_node_modules(sandbox):
            return 1
        print("  ✓ node_modules 已挂上")

        print("\n=== 3) vite build ===")
        built = run(["npx", "vite", "build"], sandbox, env=build_env(sandbox))
        dist = sandbox / "dist" / "renderer"
        if built.returncode != 0 or not dist.is_dir():
            print("  ★ 构建失败：")
            for line in (built.stdout + built.stderr).splitlines()[-14:]:
                print("    " + line[:150])
            return 1
        index_html = dist / "index.html"
        print(f"  ✓ 构建成功：{sum(1 for p in dist.rglob('*') if p.is_file())} 个产物文件")

        print("\n=== 4) 重新注入皮肤（构建会冲掉上一轮的注入）===")
        if not inject_skin(index_html):
            return 1
        print("  ✓ 皮肤引用已在 bundle CSS 之后")

        if args.keep_web:
            print(f"\n（--keep-web）产物留在：{dist}")
            return 0

        print("\n=== 5) 同步到 web/ ===")
        copied = sync_to_web(dist)
        print(f"  ✓ 同步 {copied} 个文件到 web/")
        print("\n完成。请跑一次 python tools/api_audit.py 与 pytest 确认没退化。")
        return 0
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
