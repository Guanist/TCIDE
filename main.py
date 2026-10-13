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


def open_window(url: str, title: str = "虎猫 TCIDE") -> bool:
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
    if not args.browser and open_window(url):
        print("[TCIDE] Window closed")
        return
    print(f"[TCIDE] 在浏览器中打开: {url}")
    import webbrowser

    webbrowser.open(url)
    keep_alive()


if __name__ == "__main__":
    main()
