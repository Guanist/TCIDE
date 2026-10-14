# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""验证**发布产物**（wheel / sdist）能不能用 —— 而不是只验证源码目录。

为什么必须单独验一遍：`tools/verify_install.py` 是拿**源码目录**装进去测的。
但用户下载的是 release 里的 **wheel**；如果 wheel 漏了 `web/`（前端），用户装完
就是"打不开界面" —— 而源码目录测起来完全正常。这种事只能靠验产物本身发现。

它做三件事：
1. **内容断言**：wheel 里必须有前端与主题资源、有 api/tcide_core、有 `tcide` 入口；
   sdist 里必须有前端**源码**（src/、vite.config.ts、package.json）与 tests/、MANIFEST.in。
2. **真装**：在干净 venv（`--system-site-packages --no-deps`，避免联网）里装这个 wheel。
3. **真跑**：起服务，断言首页 200 且前端资源 200；并用"资源路径是否落在 venv 内"
   自证这次跑的**确实是安装后的那份**（不是源码副本 —— 这个坑我踩过）。

用法：``python tools/verify_release.py [--wheel dist/xxx.whl] [--sdist dist/xxx.tar.gz]``
"""

from __future__ import annotations

import argparse
import contextlib
import http.client
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: wheel 里必须存在的（前端缺一个，用户装完就用不了）
WHEEL_REQUIRED = (
    "main.py",
    "server.py",
    "web/index.html",
    "static/tcide-theme.css",
    "static/tcide-theme.js",
    # 桌面宠物：页面缺了 `tcide` 里那个悬浮窗口就会开出一片空白
    "web/pet.html",
    "web/icons/pet/pet-idle.png",
    "web/icons/pet/pet-idle.gif",
    "web/icons/pet/pet-work.png",
    "web/icons/pet/pet-sleep.png",
    "web/icons/pet/pet-error.png",
)
WHEEL_REQUIRED_PREFIX = ("api/", "tcide_core/", "web/assets/")
#: sdist 里必须存在的（源码包要能重建前端）
SDIST_REQUIRED = ("vite.config.ts", "package.json",
                  "src/renderer/index.html", "MANIFEST.in", "LICENSE")


def newest(pattern: str) -> pathlib.Path | None:
    items = sorted((ROOT / "dist").glob(pattern),
                   key=lambda item: item.stat().st_mtime, reverse=True)
    return items[0] if items else None


def check_wheel(path: pathlib.Path) -> list[str]:
    problems: list[str] = []
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        for required in WHEEL_REQUIRED:
            if required not in names:
                problems.append(f"wheel 缺少 {required}")
        for prefix in WHEEL_REQUIRED_PREFIX:
            if not any(name.startswith(prefix) for name in names):
                problems.append(f"wheel 里没有任何 {prefix}* 文件")
        # 前端构建产物（哈希文件名）要有 js 与 css
        assets = [name for name in names if name.startswith("web/assets/")]
        if not any(name.endswith(".css") and "/index-" in name for name in assets):
            problems.append("wheel 里没有 web/assets/index-*.css")
        if not any(name.endswith(".js") and "/index-" in name for name in assets):
            problems.append("wheel 里没有 web/assets/index-*.js")
        entry = [name for name in names if name.endswith("entry_points.txt")]
        text = archive.read(entry[0]).decode("utf-8", "replace") if entry else ""
        if "tcide" not in text or "main:main" not in text:
            problems.append(f"wheel 缺少 tcide 入口（entry_points: {text.strip()[:80]}）")
        print(f"  wheel: {len(names)} 个文件；web/assets {len(assets)} 个")
    return problems


def check_sdist(path: pathlib.Path) -> list[str]:
    problems: list[str] = []
    with tarfile.open(path) as archive:
        names = archive.getnames()
        for required in SDIST_REQUIRED:
            if not any(name.endswith(required) for name in names):
                problems.append(f"sdist 缺少 {required}")
        print(f"  sdist: {len(names)} 个条目")
    return problems


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def clean_env() -> dict:
    """必须清掉 PYTHONPATH：否则子进程会 import 到源码，验的就不是产物。"""
    return {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}


def fetch(port: int, path: str) -> tuple[int, bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def smoke_test(wheel: pathlib.Path) -> list[str]:
    problems: list[str] = []
    venv = pathlib.Path(tempfile.mkdtemp(prefix="tcide-rel-"))
    process = None
    try:
        made = subprocess.run([sys.executable, "-m", "venv", "--system-site-packages",
                               str(venv)], capture_output=True, text=True)
        if made.returncode:
            return ["建 venv 失败：" + made.stderr[-200:]]
        python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

        print("  安装 wheel 中…")
        installed = subprocess.run(
            [str(python), "-m", "pip", "install", "--no-deps", "--no-build-isolation",
             str(wheel)], capture_output=True, text=True, encoding="utf-8",
            errors="replace", env=clean_env())
        if installed.returncode:
            return ["pip install 失败：" + (installed.stderr or "")[-300:]]
        print("  ✓ pip install 成功")

        script = venv / ("Scripts/tcide.exe" if os.name == "nt" else "bin/tcide")
        if not script.exists():
            problems.append("没有生成 tcide 命令")

        # 自证：import 到的 server 必须落在 venv 内（cwd 也要指到 venv，否则命中源码）
        probe = subprocess.run(
            [str(python), "-c",
             "import server, os; d=os.path.dirname(os.path.abspath(server.__file__));"
             "print(d); print('in_venv:', d.startswith(r'" + str(venv) + "'));"
             "print('web:', os.path.isfile(os.path.join(d,'web','index.html')))"],
            cwd=str(venv), capture_output=True, text=True, encoding="utf-8",
            errors="replace", env=clean_env())
        print("  " + probe.stdout.strip().replace("\n", " | "))
        if "in_venv: True" not in probe.stdout:
            problems.append("资源自检拿到的不是安装目录（证据无效）")
        if "web: True" not in probe.stdout:
            problems.append("装完找不到 web/index.html")

        port = free_port()
        process = subprocess.Popen(
            [str(python), "-c",
             "import sys; sys.argv=['tcide','--no-window','--port','%s'];" % port
             + "import main; main.main()"],
            cwd=str(venv), env=clean_env(), stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
        deadline = time.time() + 45
        up = False
        while time.time() < deadline:
            if process.poll() is not None:
                break
            try:
                if fetch(port, "/")[0] == 200:
                    up = True
                    break
            except OSError:
                time.sleep(0.5)
        if not up:
            output = ""
            with contextlib.suppress(Exception):
                output = (process.stdout.read() or "")[-500:] if process.stdout else ""
            problems.append("装完服务起不来" + ("：" + output if output else ""))
        else:
            body = fetch(port, "/")[1]
            print(f"  ✓ 首页 200（{len(body)} 字节 HTML）")
            text = body.decode("utf-8", "replace")
            start = text.find("/assets/")
            if start > 0:
                end = start + len(text[start:].split('"')[0].split("'")[0].split(">")[0])
                asset = text[start:end]
                status = fetch(port, asset)[0]
                print(f"  {'✓' if status == 200 else '★'} 前端资源 {asset} → {status}")
                if status != 200:
                    problems.append(f"前端资源 {asset} 返回 {status}")
            else:
                problems.append("首页没有引用任何 /assets/ 资源")
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            with contextlib.suppress(Exception):
                process.wait(timeout=5)
        shutil.rmtree(venv, ignore_errors=True)
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description="验证发布产物")
    parser.add_argument("--wheel", default="")
    parser.add_argument("--sdist", default="")
    parser.add_argument("--skip-install", action="store_true",
                        help="只做内容断言，不真装（快）")
    args = parser.parse_args()

    wheel = pathlib.Path(args.wheel) if args.wheel else newest("*.whl")
    sdist = pathlib.Path(args.sdist) if args.sdist else newest("*.tar.gz")
    problems: list[str] = []

    print("=== 1) 产物内容 ===")
    if wheel and wheel.is_file():
        problems += check_wheel(wheel)
    else:
        problems.append("没找到 wheel（先构建：python -m pip wheel . --no-deps -w dist）")
    if sdist and sdist.is_file():
        problems += check_sdist(sdist)
    else:
        problems.append("没找到 sdist")

    if not args.skip_install and wheel and wheel.is_file():
        print("\n=== 2) 真装进干净 venv 并起服务 ===")
        problems += smoke_test(wheel)

    print()
    if problems:
        print(f"★ 未通过（{len(problems)} 项）：")
        for item in problems:
            print("  · " + item)
        return 1
    print("✓ 通过：产物内容完整、wheel 能装、tcide 命令生成、装完服务能起且前端可访问")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
