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


def main():
    import argparse
    parser = argparse.ArgumentParser(description="TCIDE - Python IDE")
    parser.add_argument("project", nargs="?", default="", help="Project directory to open")
    parser.add_argument("--port", type=int, default=18420, help="Server port")
    parser.add_argument("--host", default="127.0.0.1", help="Server host")
    parser.add_argument("--no-window", action="store_true", help="Run server only (no GUI)")
    args = parser.parse_args()

    # 双击（无参数）直接打开 TCIDE 自身项目进入 IDE；其它工程用 IDE 内「打开项目」按钮
    DEFAULT_PROJECT = r"C:\Users\noirh\.qclaw\workspace-ua58rsb93veqtxl7\personal-ide"
    project_root = os.path.abspath(args.project) if args.project else os.path.abspath(DEFAULT_PROJECT)
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
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[TCIDE] Stopped")
        return

    # 启动 pawui + rich 原生桌面窗口
    try:
        import pawui
    except ImportError:
        print("[TCIDE] pawui 未安装。运行: pip install pawui rich")
        print(f"[TCIDE] 回退到浏览器打开: {url}")
        import webbrowser
        webbrowser.open(url)
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[TCIDE] Stopped")
        return

    os.environ["TCIDE_URL"] = url
    if project_root:
        os.environ["TCIDE_PROJECT"] = project_root

    pawui_file = os.path.join(APP_DIR, "tcide.paw")
    print(f"[TCIDE] 启动 pawui UI: {pawui_file}")
    pawui.run(pawui_file)
    print("[TCIDE] Window closed")


if __name__ == "__main__":
    main()
