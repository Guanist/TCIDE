# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""验证"装得上、装完能用" —— 在一个干净 venv 里真装真跑。

为什么需要这个脚本：本项目此前**根本没有 pip 安装路径**（没有 pyproject.toml /
setup.py），唯一的用法是"克隆仓库 + 手动装依赖 + python main.py" —— 也就是用户
**没机会用**。加了打包配置之后，必须有一条**可重放的证据**证明它真的能装能用，
而不是"配置看起来对"。

设计取舍：
- 用 ``--no-deps --system-site-packages``：**避免联网**。本机已装好运行依赖，
  这里要验证的是"包本身能否安装、装上后资源能否找到、界面能否打开"，
  而不是再下一遍依赖。真实安装时 pip 会按 ``pyproject.toml`` 装依赖。
- 用 ``--no-window`` 起服务再做 HTTP 断言：GUI 需要显示环境，不适合自动化；
  而"装完界面能打开"的等价证据是**服务能起来 + 首页 HTML 与前端资源都在**。

用法：``python tools/verify_install.py``
退出码 0 = 通过；非 0 = 失败（并打印原因）。
"""

from __future__ import annotations

import contextlib
import http.client
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


def run(*args: str, cwd: pathlib.Path | None = None) -> subprocess.CompletedProcess:
    # **必须清掉 PYTHONPATH**：否则子进程会 import 到源码目录里的 server/api，
    # 于是"装完资源能不能找到"验证的其实是源码副本 —— 我第一版就踩了这个，
    # 资源自检打出的路径是源码目录而不是 site-packages。
    env = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


def fetch(port: int, path: str) -> tuple[int, bytes]:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request("GET", path)
        response = connection.getresponse()
        return response.status, response.read()
    finally:
        connection.close()


def main() -> int:
    venv = pathlib.Path(tempfile.mkdtemp(prefix="tcide-verify-"))
    print(f"临时 venv: {venv}")
    problems: list[str] = []
    process = None
    try:
        # 1) 建 venv（复用本机已装的依赖，避免联网）
        made = run(sys.executable, "-m", "venv", "--system-site-packages", str(venv))
        if made.returncode:
            print("★ 建 venv 失败：" + made.stderr[-400:])
            return 1

        python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        pip = [str(python), "-m", "pip", "install", "--no-deps", "--no-build-isolation",
               str(ROOT)]
        print("安装中（构建 wheel，资源较多，请稍候）…")
        installed = run(*pip)
        tail = (installed.stdout or "")[-600:] + (installed.stderr or "")[-600:]
        if installed.returncode:
            print("★ pip install 失败：\n" + tail)
            return 1
        print("  ✓ pip install 成功")

        # 2) 装完必须能拿到 `tcide` 命令
        script = venv / ("Scripts/tcide.exe" if os.name == "nt" else "bin/tcide")
        if not script.exists():
            problems.append(f"没有生成 {script.name} 命令（pyproject 的 [project.scripts] 未生效）")
        else:
            print(f"  ✓ 入口命令存在：{script.name}")

        # 3) 资源必须跟着装过去（server.py 按 __file__ 找 web/）
        # 注意：子进程的 **CWD 也会进 sys.path**，所以必须把 cwd 指到 venv，
        # 否则 `import server` 会拿到源码目录那份 —— 第一版就因此打印出了源码路径，
        # 让"安装后资源是否分发"这条证据变得没有意义。
        probe = run(str(python), "-c",
                    "import server, os;"
                    "d=os.path.dirname(os.path.abspath(server.__file__));"
                    "print('resolved:', d);"
                    "print('in_venv:', str(d).startswith(r'" + str(venv) + "'));"
                    "print('web:', os.path.isdir(os.path.join(d,'web')));"
                    "print('index:', os.path.isfile(os.path.join(d,'web','index.html')));"
                    "print('assets:', os.path.isdir(os.path.join(d,'web','assets')));",
                    cwd=venv)
        print("  资源自检：" + probe.stdout.strip().replace("\n", " | "))
        if "in_venv: True" not in probe.stdout:
            problems.append("资源自检拿到的不是安装目录（证据无效，说明它 import 到了源码）")
        if "web: True" not in probe.stdout:
            problems.append("安装后找不到 web/ 目录（前端不会被分发）")
        if "index: True" not in probe.stdout:
            problems.append("安装后找不到 web/index.html（界面打不开）")

        # 4) 真起一个服务，验证首页与前端资源可访问
        port = free_port()
        # 端口要作为**字符串**传进 argv：argparse 拿到 int 会在解析时炸
        # （`TypeError: 'int' object is not subscriptable`）—— 我第一版就这么写的。
        child_env = {key: value for key, value in os.environ.items()
                     if key != "PYTHONPATH"}
        process = subprocess.Popen(
            [str(python), "-c",
             "import sys; sys.argv=['tcide','--no-window','--port','%s'];" % port
             + "import main; main.main()"],
            cwd=str(venv), env=child_env, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8",
            errors="replace")
        deadline = time.time() + 40
        up = False
        while time.time() < deadline:
            if process.poll() is not None:
                break
            try:
                status, _ = fetch(port, "/")
                up = status == 200
                if up:
                    break
            except OSError:
                time.sleep(0.5)
        if not up:
            output = ""
            with contextlib.suppress(Exception):
                output = (process.stdout.read() or "")[-800:] if process.stdout else ""
            problems.append("安装后的服务没起来（或首页不是 200）" + ("：\n" + output if output else ""))
        else:
            print("  ✓ 首页返回 200")
            body = fetch(port, "/")[1]
            if b"<html" not in body.lower():
                problems.append("首页不是 HTML")
            asset = b"/assets/"
            if asset not in body:
                print("  · 首页里没引用 /assets/（可能前端结构不同，不判失败）")
            else:
                # 从 HTML 里挑第一个 /assets/xxx 资源实际取一次
                text = body.decode("utf-8", "replace")
                start = text.find("/assets/")
                end = min([i for i in (text.find('"', start), text.find("'", start),
                                       text.find(">", start)) if i > 0] or [start + 60])
                path = text[start:end]
                try:
                    status, _ = fetch(port, path)
                    print(f"  {'✓' if status == 200 else '★'} 前端资源 {path} → {status}")
                    if status != 200:
                        problems.append(f"前端资源 {path} 返回 {status}")
                except OSError as exc:
                    problems.append(f"取前端资源 {path} 失败：{exc}")
    finally:
        if process is not None and process.poll() is None:
            process.kill()
            with contextlib.suppress(Exception):
                process.wait(timeout=5)
        shutil.rmtree(venv, ignore_errors=True)

    print()
    if problems:
        print(f"★ 未通过（{len(problems)} 项）：")
        for item in problems:
            print("  · " + item)
        return 1
    print("✓ 通过：pip 安装成功、tcide 命令生成、web/ 资源随包分发、服务能起且首页与前端资源可访问")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
