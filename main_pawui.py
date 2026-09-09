"""
TCIDE — pawui + PySide6 + FastAPI
Entry point: starts the API server, then launches the Qt UI.
"""
import sys
import os
import threading
import time
import uvicorn

# Ensure project root is on the path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)


def start_server():
    """Run the FastAPI server in a background thread."""
    import traceback
    try:
        import server
        print(f"[TCIDE] Server module loaded OK")
        uvicorn.run(server.app, host="127.0.0.1", port=18420, log_level="warning")
    except Exception as e:
        print(f"[TCIDE] Server FAILED: {e}")
        traceback.print_exc()


def main():
    # 1. Start the API server in a daemon thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Wait for server to be ready
    time.sleep(1.5)

    # 2. Launch the Qt frontend (Electron UI in QWebEngineView)
    from tcide_pawui_v2 import main as qt_main
    qt_main()


if __name__ == "__main__":
    main()
