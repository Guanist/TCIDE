"""
TCIDE Entry Point — Launches FastAPI backend + pawui frontend.
"""
import sys
import os
import threading
import time
import httpx

# Add project root to path
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, PROJECT_ROOT)

def start_backend(port=18420):
    """Start FastAPI backend in background thread."""
    try:
        import uvicorn
        from server import app
        
        config = uvicorn.Config(
            app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False
        )
        server = uvicorn.Server(config)
        server.run()
    except Exception as e:
        print(f"Backend error: {e}")


def wait_for_backend(port=18420, timeout=30):
    """Wait for backend to be ready."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = httpx.get(f"http://127.0.0.1:{port}/api/health", timeout=2)
            if r.status_code == 200:
                return True
        except:
            pass
        time.sleep(0.5)
    return False


def main():
    """Main entry point."""
    # Determine project path
    project_path = None
    if len(sys.argv) > 1:
        project_path = sys.argv[1]
    else:
        project_path = PROJECT_ROOT
    
    print(f"[TCIDE] Starting with project: {project_path}")
    print(f"[TCIDE] Backend will run on port 18420")
    
    # Start backend in background thread
    backend_thread = threading.Thread(
        target=start_backend,
        args=(18420,),
        daemon=True
    )
    backend_thread.start()
    
    # Wait for backend to be ready
    print("[TCIDE] Waiting for backend...")
    if wait_for_backend(18420):
        print("[TCIDE] Backend ready!")
    else:
        print("[TCIDE] Backend timeout, continuing anyway...")
    
    # Launch pawui frontend
    try:
        from tcide_pawui import TCIDEWindow
        from PySide6.QtWidgets import QApplication
        
        app = QApplication(sys.argv)
        app.setApplicationName("虎猫 TCIDE")
        app.setOrganizationName("Guanist")
        
        window = TCIDEWindow(project_path)
        window.show()
        
        sys.exit(app.exec())
    except ImportError as e:
        print(f"[TCIDE] Import error: {e}")
        print("[TCIDE] Falling back to web browser...")
        
        # Fallback: open in browser
        import webbrowser
        webbrowser.open(f"http://127.0.0.1:18420")
        
        # Keep main thread alive
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("[TCIDE] Shutting down...")


if __name__ == "__main__":
    main()
