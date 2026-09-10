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
if getattr(sys, 'frozen', False):
    # Running as PyInstaller exe
    PROJECT_ROOT = os.path.dirname(sys.executable)
    # Also add _internal for bundled modules
    internal_dir = os.path.join(os.path.dirname(sys.executable), '_internal')
    if os.path.isdir(internal_dir):
        sys.path.insert(0, internal_dir)
else:
    PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)


def start_server():
    """Run the FastAPI server in a background thread."""
    import traceback
    log_file = r"C:\Users\noirh\tcide_server.log"
    
    # Fix: PyInstaller windowed mode has sys.stdout = None
    if sys.stdout is None:
        sys.stdout = open(os.devnull, 'w')
    if sys.stderr is None:
        sys.stderr = open(os.devnull, 'w')
    
    try:
        with open(log_file, "w") as f:
            f.write("Server thread starting...\n")
            f.flush()
        import server
        with open(log_file, "a") as f:
            f.write(f"Server module loaded, app={type(server.app)}\n")
            f.flush()
        uvicorn.run(server.app, host="127.0.0.1", port=18420, log_level="warning")
    except Exception as e:
        with open(log_file, "a") as f:
            f.write(f"Server FAILED: {e}\n")
            traceback.print_exc(file=f)


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
