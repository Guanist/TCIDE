"""
TCIDE — pawui + FastAPI
Entry point: starts the API server, then launches pawui as the frontend.
"""
import sys
import os
import subprocess
import threading
import time
import shutil
import uvicorn

# Ensure project root is on the path
if getattr(sys, 'frozen', False):
    PROJECT_ROOT = os.path.dirname(sys.executable)
    _internal = os.path.join(PROJECT_ROOT, '_internal')
    if os.path.isdir(_internal):
        sys.path.insert(0, _internal)
    sys.path.insert(0, PROJECT_ROOT)
else:
    PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, PROJECT_ROOT)

# PyInstaller windowed mode fix: sys.stdout/sys.stderr = None
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')


def start_server():
    """Run the FastAPI server in a background thread."""
    import traceback
    log_file = os.path.join(PROJECT_ROOT, "tcide_server.log")
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


def wait_for_server(timeout=15):
    """Wait until the server is ready."""
    import urllib.request
    start = time.time()
    while time.time() - start < timeout:
        try:
            urllib.request.urlopen("http://127.0.0.1:18420/api/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.3)
    return False


def find_paw():
    """Find the pawui executable."""
    # Try PATH first
    paw_path = shutil.which("pawui")
    if paw_path:
        return paw_path
    # Try as Python module
    try:
        import pawui
        return sys.executable + " -m pawui"
    except ImportError:
        pass
    # Try common install locations
    for py in [sys.executable, shutil.which("python3") or "", shutil.which("python") or ""]:
        if not py:
            continue
        try:
            result = subprocess.run(
                [py, "-m", "pawui", "--version"],
                capture_output=True, text=True, timeout=5
            )
            if result.returncode == 0:
                return py + " -m pawui"
        except Exception:
            pass
    return None


def main():
    # 1. Start the API server in a daemon thread
    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # 2. Wait for server to be ready
    print("[TCIDE] Waiting for server...")
    if not wait_for_server():
        print("[TCIDE] Server failed to start!")
        return
    print("[TCIDE] Server ready!")

    # 3. Set environment for tcide.paw
    os.environ["TCIDE_URL"] = "http://127.0.0.1:18420"
    os.environ["PYTHONPATH"] = PROJECT_ROOT + os.pathsep + os.environ.get("PYTHONPATH", "")
    os.environ["PYTHONIOENCODING"] = "utf-8"
    if len(sys.argv) > 1:
        os.environ["TCIDE_PROJECT"] = sys.argv[1]

    # 4. Find tcide.paw (check exe dir, _internal, then PROJECT_ROOT)
    candidates = [
        os.path.join(PROJECT_ROOT, "tcide.paw"),
        os.path.join(PROJECT_ROOT, "_internal", "tcide.paw"),
    ]
    paw_file = None
    for c in candidates:
        if os.path.exists(c):
            paw_file = c
            break
    if not paw_file:
        print("[TCIDE] ERROR: tcide.paw not found")
        return

    # Also ensure tcide_client.py is importable
    client_dir = os.path.dirname(paw_file)
    if client_dir not in sys.path:
        sys.path.insert(0, client_dir)
    os.environ["PYTHONPATH"] = client_dir + os.pathsep + os.environ.get("PYTHONPATH", "")

    # 5. Find and run pawui
    paw_cmd = find_paw()
    if not paw_cmd:
        print("[TCIDE] ERROR: pawui not found! Install with: pip install pawui")
        return

    print(f"[TCIDE] Launching pawui: {paw_cmd} {paw_file}")
    cmd_parts = paw_cmd.split() + [paw_file]
    subprocess.run(cmd_parts, cwd=client_dir)

    # 6. Exit
    print("[TCIDE] Window closed, exiting.")
    os._exit(0)


if __name__ == "__main__":
    main()
