# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""
TCIDE - 纯 Python 版桌面 IDE
入口文件：启动 FastAPI 服务 + PyWebView 窗口
"""
import os
import sys
import threading
import time

# 确保模块路径
APP_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, APP_DIR)

import uvicorn


def start_server(host: str, port: int, project_root: str = ""):
    """在后台线程启动 FastAPI 服务"""
    from api import files, git_ops, settings
    settings.init_settings("tcide")
    if project_root:
        files.set_project_root(project_root)
        git_ops.set_project_root(project_root)

    from server import app
    config = uvicorn.Config(app, host=host, port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)
    server.run()


def wait_for_server(url: str, timeout: int = 10) -> bool:
    """等待服务就绪"""
    import httpx
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = httpx.get(f"{url}/api/health", timeout=1)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.3)
    return False



# ── 宠物窗口位置（记住用户拖到哪儿）─────────────────────────────────────────
# PyWebView 没有 moved 事件，但 Window.x / Window.y 可读；位置存 settings.extra。
PET_POSITION_KEY = "pet_position"


def read_pet_position() -> tuple[int | None, int | None]:
    """读上次的位置；没有或不可信就返回 (None, None)，交给系统决定。"""
    from tcide_core.settings import load

    value = (load().extra or {}).get(PET_POSITION_KEY)
    try:
        x, y = int(value[0]), int(value[1])
    except (TypeError, ValueError, IndexError):
        return None, None
    # 明显跑到屏幕外的坐标不要用（换显示器/分辨率变了会变成"看不见的宠物"）
    if x < -2000 or y < -2000 or x > 20000 or y > 20000:
        return None, None
    return x, y


def save_pet_position(x: int, y: int) -> None:
    from tcide_core.settings import load, save

    settings = load()
    extra = dict(settings.extra or {})
    if extra.get(PET_POSITION_KEY) == [int(x), int(y)]:
        return
    extra[PET_POSITION_KEY] = [int(x), int(y)]
    settings.extra = extra
    save(settings)


def watch_pet_position(window, interval: float = 2.0) -> None:
    """在 webview.start() 的后台线程里盯住窗口位置，变了就存。

    为什么轮询而不是事件：PyWebView 没有 moved 事件（实测 Window.events 不存在）。
    两秒一次足够 —— 拖动过程中不必每次都写盘。
    """
    import time

    last: tuple[int, int] | None = None
    while True:
        time.sleep(interval)
        try:
            x, y = int(window.x), int(window.y)
        except Exception:      # noqa: BLE001 - 窗口已关闭等情况
            return
        if last != (x, y):
            last = (x, y)
            try:
                save_pet_position(x, y)
            except Exception:      # noqa: BLE001 - 存不下不该影响宠物
                pass


def open_pet_window(url: str, *, x: int | None = None, y: int | None = None) -> None:
    """开一个独立悬浮的桌面宠物窗口。

    为什么这样开：
    - `frameless` + `transparent`：桌面上只看到那只猫，没有窗口边框与底色；
    - `on_top`：不被编辑器窗口盖住；
    - `easy_drag`：**无边框窗口的拖动交给 PyWebView** —— 不用自己写鼠标捕获，
      整个窗口区域都可以拖；
    - 尺寸 140x170：够放下 104px 的宠物与一行状态标签。

    必须与主窗口在**同一个** `webview.start()` 之前创建 —— PyWebView 是多窗口的，
    但事件循环只能起一次。
    """
    try:
        import webview
    except ImportError:
        # 和主窗口一致：没有 pywebview 就安静不开宠物窗口，不能影响主流程。
        print("[TCIDE] 未安装 pywebview，跳过桌面宠物窗口")
        return
    return webview.create_window(
        "虎猫", f"{url}/pet",
        width=140, height=170,
        x=x, y=y,
        frameless=True, transparent=True, on_top=True, easy_drag=True,
        resizable=False, min_size=(120, 140),
    )


def open_window(url: str, title: str = "虎猫 TCIDE", *, no_pet: bool = False) -> bool:
    """用 PyWebView 打开原生窗口（**不依赖 PawUI**）。

    为什么换掉 PawUI：本仓库的界面本来就是 ``web/`` —— 它是原 Electron 渲染层
    用 Vite 构建的产物，配 ``electron-shim.js`` 把 ``window.api`` 换成对后端的
    fetch 调用。PawUI 那条路（``tcide.paw`` + ``tcide_pawui.py``）是并行的**第二套
    UI**，等于同一份功能维护两遍、还多一个 GPL 依赖。
    """
    try:
        import webview
    except ImportError:
        print("[TCIDE] 未安装 pywebview，回退到浏览器。安装: pip install pywebview")
        return False
    webview.create_window(title, url, width=1440, height=900)
    # 桌面宠物：独立、透明、置顶、可拖动的小窗口（`--no-pet` 可关）
    pet = None
    if not no_pet:
        pet_x, pet_y = read_pet_position()
        pet = open_pet_window(url, x=pet_x, y=pet_y)
    # 把"盯住宠物位置"放到 start() 的后台槽位里（PyWebView 支持这样跑一个循环）。
    # 没有宠物窗口时就照常启动。
    if pet is not None:
        webview.start(watch_pet_position, [pet])
    else:
        webview.start()
    return True


def keep_alive() -> None:
    """没有原生窗口时保持后端存活（浏览器模式）。"""
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n[TCIDE] Stopped")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="TCIDE - Python IDE")
    parser.add_argument("project", nargs="?", default="", help="Project directory to open")
    parser.add_argument("--port", type=int, default=18420, help="Server port")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--no-window", action="store_true", help="Run server only (no GUI)")
    parser.add_argument("--no-pet", action="store_true",
                        help="Do not open the floating desktop pet window")
    parser.add_argument("--browser", action="store_true",
                        help="用系统浏览器而不是原生窗口")
    args = parser.parse_args()

    # 默认项目：**不硬编码路径**。原版写死了一台机器上的目录
    # （C:\Users\<某人>\.qclaw\workspace-...\personal-ide），换台机器就指向不存在的
    # 位置、界面里空空如也。顺序：命令行参数 → 环境变量 → 当前工作目录。
    project_root = os.path.abspath(
        args.project or os.environ.get("TCIDE_PROJECT") or os.getcwd())
    url = f"http://{args.host}:{args.port}"

    # 启动后端服务（后台线程）
    server_thread = threading.Thread(
        target=start_server,
        args=(args.host, args.port, project_root),
        daemon=True,
    )
    server_thread.start()
    print(f"[TCIDE] Starting server on {url}...")

    if not wait_for_server(url):
        print("[TCIDE] ERROR: Server failed to start")
        sys.exit(1)

    print(f"[TCIDE] Server ready at {url}")

    if args.no_window:
        print("[TCIDE] Running in headless mode (Ctrl+C to stop)")
        keep_alive()
        return

    # 原生窗口（PyWebView）；失败或显式 --browser 时用系统浏览器打开
    if not args.browser and open_window(url, no_pet=args.no_pet):
        print("[TCIDE] Window closed")
        return
    print(f"[TCIDE] 在浏览器中打开: {url}")
    import webbrowser

    webbrowser.open(url)
    keep_alive()


if __name__ == "__main__":
    main()
