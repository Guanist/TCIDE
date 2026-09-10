"""
TCIDE pawui Frontend — Embeds Electron UI in QWebEngineView
with native pet widget and system tray.
"""
import sys
import os
import json
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QLabel, QSystemTrayIcon, QMenu, QMessageBox
)
from PySide6.QtCore import Qt, QUrl, QTimer, Signal, QObject
from PySide6.QtGui import QIcon, QPixmap, QAction
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile, QWebEngineSettings
from PySide6.QtCore import QBuffer, QIODevice

# ── Path setup ──
if getattr(sys, 'frozen', False):
    BASE_DIR = os.path.dirname(sys.executable)
    # In PyInstaller, bundled files are in _internal
    _internal = os.path.join(BASE_DIR, '_internal')
    if os.path.isdir(_internal):
        BASE_DIR = _internal
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")
PET_ASSETS_DIR = os.path.join(BASE_DIR, "pet_assets")
ICON_PATH = os.path.join(BASE_DIR, "cat_icon.ico")

# ── API server port ──
API_PORT = 18420
API_BASE = f"http://127.0.0.1:{API_PORT}"


class PetWidget(QWidget):
    """Floating pixel pet widget — native Qt, sits in the status bar area."""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setFixedSize(48, 48)
        self.state = "idle"
        self._frame = 0
        self._load_sprites()
        
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._animate)
        self._timer.start(500)
    
    def _load_sprites(self):
        self.sprites = {}
        manifest_path = os.path.join(PET_ASSETS_DIR, "pet_manifest.json")
        if os.path.exists(manifest_path):
            with open(manifest_path, 'r') as f:
                manifest = json.load(f)
            for state_name, info in manifest.get("states", {}).items():
                png_path = os.path.join(PET_ASSETS_DIR, info.get("preview", f"pet_preview_{state_name}.png"))
                if os.path.exists(png_path):
                    self.sprites[state_name] = QPixmap(png_path)
    
    def set_state(self, state):
        self.state = state
        self._frame = 0
        self.update()
    
    def _animate(self):
        self._frame = (self._frame + 1) % 4
        self.update()
    
    def paintEvent(self, event):
        from PySide6.QtGui import QPainter
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.SmoothPixmapTransform)
        
        sprite = self.sprites.get(self.state) or self.sprites.get("idle")
        if sprite and not sprite.isNull():
            # Pixel art scaling
            painter.drawPixmap(4, 4, 40, 40, sprite)
        else:
            # Fallback: draw a simple cat face
            painter.setBrush(Qt.GlobalColor.gray)
            painter.drawEllipse(8, 8, 32, 32)
            painter.setBrush(Qt.GlobalColor.green)
            painter.drawEllipse(14, 16, 8, 8)
            painter.drawEllipse(26, 16, 8, 8)
            painter.setBrush(Qt.GlobalColor.black)
            painter.drawEllipse(17, 18, 4, 4)
            painter.drawEllipse(29, 18, 4, 4)
        
        painter.end()


class TCIDEWebPage(QWebEnginePage):
    """Custom web page that handles console messages and JavaScript bridge."""
    def __init__(self, profile, parent=None):
        super().__init__(profile, parent)
    
    def javaScriptConsoleMessage(self, level, message, line, source):
        if '[TCIDE]' in message:
            print(f"[TCIDE-Web] {message}")
    
    def acceptNavigationRequest(self, url, nav_type, is_main_frame):
        # Allow all navigation within the web dir
        return True


class TCIDEWindow(QMainWindow):
    """Main window — Electron UI in QWebEngineView + native pet."""
    
    def __init__(self, project_path=None):
        super().__init__()
        self.setWindowTitle("虎猫 TCIDE")
        self.setMinimumSize(1200, 800)
        self.resize(1440, 900)
        
        # Set icon
        if os.path.exists(ICON_PATH):
            self.setWindowIcon(QIcon(ICON_PATH))
        
        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        
        # Web view — loads the Electron UI
        self.profile = QWebEngineProfile("tcide", self)
        self.profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.DiskHttpCache)
        self.profile.setPersistentCookiesPolicy(
            QWebEngineProfile.PersistentCookiesPolicy.ForcePersistentCookies
        )
        
        # Enable web settings
        settings = self.profile.settings()
        settings.setAttribute(QWebEngineSettings.WebAttribute.JavascriptEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessRemoteUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.LocalContentCanAccessFileUrls, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.PluginsEnabled, True)
        settings.setAttribute(QWebEngineSettings.WebAttribute.ScrollAnimatorEnabled, True)
        
        page = TCIDEWebPage(self.profile, self)
        self.web_view = QWebEngineView(self)
        self.web_view.setPage(page)
        
        # Load the Electron UI from FastAPI server (avoids file:// CORS issues)
        self.web_view.setUrl(QUrl(f"http://127.0.0.1:{API_PORT}/"))
        
        layout.addWidget(self.web_view)
        
        # Inject project path after page loads
        self.web_view.loadFinished.connect(self._on_load_finished)
        
        # Wait for server to be ready before loading page
        self._server_check_timer = QTimer(self)
        self._server_check_timer.timeout.connect(self._try_load_page)
        self._server_check_timer.start(200)
        self._load_attempted = False
        
        # System tray
        self._setup_tray()
        
        # Status bar pet
        self.pet = PetWidget(self)
        self.statusBar().addPermanentWidget(self.pet)
        self.statusBar().showMessage("虎猫 TCIDE — pawui + PySide6")
    
    def _on_load_finished(self, ok):
        if not ok:
            return
        # Inject project path into the web page
        project = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
        js = f"window.__tcide_projectRoot = {json.dumps(project)};"
        self.web_view.page().runJavaScript(js)
        print(f"[TCIDE] Page loaded, project: {project}")
    
    def _try_load_page(self):
        """Poll until server is ready, then load the page."""
        if self._load_attempted:
            return
        import urllib.request
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/api/health", timeout=1)
            # Server is ready
            self._server_check_timer.stop()
            self._load_attempted = True
            self.web_view.setUrl(QUrl(f"http://127.0.0.1:{API_PORT}/"))
            print(f"[TCIDE] Server ready, loading page")
        except Exception:
            # Server not ready yet, try again
            pass
    
    def _setup_tray(self):
        if not QSystemTrayIcon.isSystemTrayAvailable():
            return
        self.tray = QSystemTrayIcon(self)
        if os.path.exists(ICON_PATH):
            self.tray.setIcon(QIcon(ICON_PATH))
        else:
            self.tray.setIcon(self.windowIcon())
        
        tray_menu = QMenu()
        show_action = QAction("显示窗口", self)
        show_action.triggered.connect(self._show_window)
        tray_menu.addAction(show_action)
        
        quit_action = QAction("退出", self)
        quit_action.triggered.connect(QApplication.quit)
        tray_menu.addAction(quit_action)
        
        self.tray.setContextMenu(tray_menu)
        self.tray.activated.connect(self._tray_activated)
        self.tray.show()
    
    def _show_window(self):
        self.showNormal()
        self.activateWindow()
    
    def _tray_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self._show_window()
    
    def closeEvent(self, event):
        # Minimize to tray instead of closing
        event.ignore()
        self.hide()
        self.tray.showMessage("虎猫 TCIDE", "已最小化到系统托盘", QSystemTrayIcon.MessageIcon.Information, 2000)


def main():
    app = QApplication(sys.argv)
    app.setApplicationName("虎猫 TCIDE")
    app.setOrganizationName("Guanist")
    
    # Set dark theme
    app.setStyleSheet("""
        QMainWindow { background: #1e1e1e; }
        QStatusBar { background: #007acc; color: white; font-size: 12px; }
        QMenuBar { background: #2d2d2d; color: #cccccc; }
        QMenu { background: #2d2d2d; color: #cccccc; }
        QMenu::item:selected { background: #094771; }
    """)
    
    project_path = sys.argv[1] if len(sys.argv) > 1 else None
    
    window = TCIDEWindow(project_path)
    window.show()
    
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
