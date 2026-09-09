"""
TCIDE Frontend — Pawui-based IDE with Monaco, xterm, pet, and AI agents.
This replaces Electron with PySide6/pawui while keeping all features.
"""
import sys
import os
import json
import httpx
import subprocess
from pathlib import Path
from PySide6.QtWidgets import (
    QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
    QSplitter, QTabWidget, QTreeWidget, QTreeWidgetItem, QTextEdit,
    QLineEdit, QPushButton, QLabel, QScrollArea, QFrame, QMenu,
    QFileDialog, QMessageBox, QStatusBar, QToolBar, QHeaderView
)
from PySide6.QtCore import Qt, QTimer, Signal, QThread, QSize
from PySide6.QtGui import QFont, QColor, QIcon, QAction, QPalette
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebEngineCore import QWebEngineSettings

# Try importing pawui for the window shell
try:
    import pawui
    HAS_PAWUI = True
except ImportError:
    HAS_PAWUI = False

from tcide_pet import TCIDEPet

# ── Constants ──
API_BASE = "http://127.0.0.1:18420"
APP_TITLE = "虎猫 TCIDE"
DARK_THEME = """
QMainWindow { background: #1e1e1e; }
QWidget { background: #1e1e1e; color: #d4d4d4; }
QTreeWidget { background: #252526; color: #d4d4d4; border: none; }
QTreeWidget::item { padding: 2px 4px; }
QTreeWidget::item:selected { background: #094771; }
QTreeWidget::item:hover { background: #2a2d2e; }
QTabWidget::pane { border: 1px solid #3c3c3c; }
QTabBar::tab { background: #2d2d2d; color: #858585; padding: 8px 16px; border: 1px solid #3c3c3c; }
QTabBar::tab:selected { background: #1e1e1e; color: #ffffff; }
QTabBar::tab:hover { background: #383838; }
QTextEdit, QPlainTextEdit { background: #1e1e1e; color: #d4d4d4; border: 1px solid #3c3c3c; font-family: 'Consolas', monospace; }
QLineEdit { background: #3c3c3c; color: #d4d4d4; border: 1px solid #555; padding: 4px 8px; }
QPushButton { background: #0e639c; color: white; border: none; padding: 6px 12px; border-radius: 2px; }
QPushButton:hover { background: #1177bb; }
QPushButton:pressed { background: #094771; }
QStatusBar { background: #007acc; color: white; }
QSplitter::handle { background: #3c3c3c; }
QLabel { color: #d4d4d4; }
QMenu { background: #2d2d2d; color: #d4d4d4; border: 1px solid #3c3c3c; }
QMenu::item:selected { background: #094771; }
"""


class APIClient:
    """HTTP client for TCIDE backend API."""
    
    def __init__(self, base_url=API_BASE):
        self.base_url = base_url
        self.client = httpx.Client(timeout=30)
        
    def _get(self, endpoint):
        try:
            r = self.client.get(f"{self.base_url}{endpoint}")
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"API error: {e}")
        return None
        
    def _post(self, endpoint, data=None):
        try:
            r = self.client.post(f"{self.base_url}{endpoint}", json=data)
            if r.status_code == 200:
                return r.json()
        except Exception as e:
            print(f"API error: {e}")
        return None
        
    def health(self):
        return self._get("/api/health")
        
    def open_project(self, path):
        return self._post("/api/project/open", {"path": path})
        
    def list_files(self, path="."):
        return self._get(f"/api/files/list?path={path}")
        
    def read_file(self, path):
        return self._get(f"/api/files/read?path={path}")
        
    def write_file(self, path, content):
        return self._post("/api/files/write", {"path": path, "content": content})
        
    def exec_command(self, command, cwd=None):
        data = {"command": command}
        if cwd:
            data["cwd"] = cwd
        return self._post("/api/exec", data)
        
    def git_status(self):
        return self._get("/api/git/status")
        
    def git_diff(self):
        return self._get("/api/git/diff")
        
    def git_commit(self, message):
        return self._post("/api/git/commit", {"message": message})
        
    def get_settings(self):
        return self._get("/api/settings")
        
    def save_settings(self, settings):
        return self._post("/api/settings", settings)
        
    def ai_chat(self, messages, model=None):
        data = {"messages": messages}
        if model:
            data["model"] = model
        return self._post("/api/ai/chat", data)
        
    def ai_build(self, requirement):
        return self._post("/api/ai/build", {"requirement": requirement})
        
    def ai_code(self, task, file_contents=None):
        data = {"task": task}
        if file_contents:
            data["file_contents"] = file_contents
        return self._post("/api/ai/code", data)
        
    def ai_review(self, files):
        return self._post("/api/ai/review", {"files": files})


class FileTreeWidget(QTreeWidget):
    """File tree panel with context menu."""
    
    file_selected = Signal(str)
    file_changed = Signal(str)  # path of changed file
    
    def __init__(self, api_client, parent=None):
        super().__init__(parent)
        self.api = api_client
        self.project_root = None
        self.setHeaderLabel("Files")
        self.setContextMenuPolicy(Qt.CustomContextMenu)
        self.customContextMenuRequested.connect(self._show_context_menu)
        self.itemDoubleClicked.connect(self._on_double_click)
        self.setAnimated(True)
        self.setIndentation(12)
        
    def set_project(self, path):
        self.project_root = path
        self._refresh()
        
    def _refresh(self):
        self.clear()
        if not self.project_root:
            return
        self._load_directory(self.project_root, self.invisibleRootItem())
        
    def _load_directory(self, path, parent_item):
        try:
            items = sorted(os.listdir(path), key=lambda x: (not os.path.isdir(os.path.join(path, x)), x.lower()))
            for item_name in items:
                if item_name.startswith('.') or item_name in ('node_modules', '__pycache__', '.git', 'dist', 'build'):
                    continue
                item_path = os.path.join(path, item_name)
                item = QTreeWidgetItem(parent_item)
                item.setText(0, item_name)
                item.setData(0, Qt.UserRole, item_path)
                if os.path.isdir(item_path):
                    item.setIcon(0, self.style().standardIcon(self.style().SP_DirIcon))
                    self._load_directory(item_path, item)
                else:
                    item.setIcon(0, self.style().standardIcon(self.style().SP_FileIcon))
        except Exception as e:
            print(f"Error listing {path}: {e}")
            
    def _on_double_click(self, item, column):
        path = item.data(0, Qt.UserRole)
        if path and os.path.isfile(path):
            self.file_selected.emit(path)
            
    def _show_context_menu(self, pos):
        item = self.itemAt(pos)
        if not item:
            return
        path = item.data(0, Qt.UserRole)
        menu = QMenu(self)
        
        if os.path.isfile(path):
            open_action = menu.addAction("Open")
            open_action.triggered.connect(lambda: self.file_selected.emit(path))
            
            delete_action = menu.addAction("Delete")
            delete_action.triggered.connect(lambda: self._delete_file(path))
            
            rename_action = menu.addAction("Rename")
            rename_action.triggered.connect(lambda: self._rename_file(path))
        else:
            new_file_action = menu.addAction("New File")
            new_file_action.triggered.connect(lambda: self._new_file(path))
            
            refresh_action = menu.addAction("Refresh")
            refresh_action.triggered.connect(self._refresh)
            
            delete_action = menu.addAction("Delete Folder")
            delete_action.triggered.connect(lambda: self._delete_folder(path))
            
        menu.exec(self.mapToGlobal(pos))
        
    def _new_file(self, dir_path):
        name, ok = QFileDialog.getSaveFileName(self, "New File", dir_path)
        if ok and name:
            try:
                with open(name, 'w') as f:
                    f.write('')
                self._refresh()
                self.file_changed.emit(name)
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))
                
    def _delete_file(self, path):
        reply = QMessageBox.question(self, "Delete", f"Delete {os.path.basename(path)}?",
                                     QMessageBox.Yes | QMessageBox.No)
        if reply == QMessageBox.Yes:
            try:
                os.remove(path)
                self._refresh()
                self.file_changed.emit(path)
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))
                
    def _delete_folder(self, path):
        reply = QMessageBox.question(self, "Delete", f"Delete {os.path.basename(path)} and all contents?",
                                     QMessageBox.Yes | QMessageBox.No)
        if reply == QMessageBox.Yes:
            try:
                import shutil
                shutil.rmtree(path)
                self._refresh()
                self.file_changed.emit(path)
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))
                
    def _rename_file(self, old_path):
        name, ok = QFileDialog.getSaveFileName(self, "Rename", os.path.dirname(old_path))
        if ok and name:
            try:
                os.rename(old_path, name)
                self._refresh()
                self.file_changed.emit(old_path)
            except Exception as e:
                QMessageBox.warning(self, "Error", str(e))


class EditorWidget(QWidget):
    """Monaco editor embedded via QWebEngineView."""
    
    content_changed = Signal(str)  # file path
    
    def __init__(self, parent=None):
        super().__init__(parent)
        self.current_file = None
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        # Tab bar for open files
        self.tabs = QTabWidget()
        self.tabs.setTabsClosable(True)
        self.tabs.tabCloseRequested.connect(self._close_tab)
        layout.addWidget(self.tabs)
        
        # Monaco editor web view
        self.editor_view = QWebEngineView()
        self.editor_view.settings().setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        self.editor_view.settings().setAttribute(QWebEngineSettings.LocalContentCanAccessFileUrls, True)
        
        # Load Monaco editor HTML
        self.editor_view.setHtml(self._get_monaco_html())
        layout.addWidget(self.editor_view)
        
    def _get_monaco_html(self):
        return """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #1e1e1e; overflow: hidden; }
#editor { width: 100%; height: 100vh; }
</style>
</head>
<body>
<div id="editor"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js"></script>
<script>
require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' }});
require(['vs/editor/editor.main'], function() {
    window.editor = monaco.editor.create(document.getElementById('editor'), {
        value: '',
        language: 'python',
        theme: 'vs-dark',
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        fontFamily: "'Consolas', 'Courier New', monospace",
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 4,
        insertSpaces: true,
        wordWrap: 'off',
        lineNumbers: 'on',
        roundedSelection: true,
        readOnly: false,
        cursorStyle: 'line',
        cursorBlinking: 'animation',
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        contextmenu: true,
        mouseWheelZoom: true
    });
    
    // Listen for content changes
    window.editor.onDidChangeModelContent(function() {
        window._tcide_content_changed = true;
    });
    
    // Language detection
    window._setLanguage = function(lang) {
        var model = window.editor.getModel();
        if (model) {
            monaco.editor.setModelLanguage(model, lang);
        }
    };
    
    // Set content from Python
    window._setContent = function(content, lang) {
        if (window.editor) {
            window.editor.setValue(content);
            if (lang) window._setLanguage(lang);
            window._tcide_content_changed = false;
        }
    };
    
    // Get content
    window._getContent = function() {
        return window.editor ? window.editor.getValue() : '';
    };
    
    // Save shortcut
    window.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, function() {
        window._tcide_save_requested = true;
    });
    
    console.log('Monaco editor initialized');
});
</script>
</body>
</html>"""
        
    def open_file(self, path):
        """Open a file in the editor."""
        try:
            with open(path, 'r', encoding='utf-8', errors='replace') as f:
                content = f.read()
            
            self.current_file = path
            
            # Detect language from extension
            ext = os.path.splitext(path)[1].lower()
            lang_map = {
                '.py': 'python', '.js': 'javascript', '.ts': 'typescript',
                '.html': 'html', '.css': 'css', '.json': 'json',
                '.md': 'markdown', '.yml': 'yaml', '.yaml': 'yaml',
                '.rs': 'rust', '.go': 'go', '.java': 'java',
                '.c': 'c', '.cpp': 'cpp', '.h': 'c', '.hpp': 'cpp',
                '.xml': 'xml', '.sql': 'sql', '.sh': 'shell',
                '.bat': 'batch', '.ps1': 'powershell', '.txt': 'plaintext'
            }
            lang = lang_map.get(ext, 'plaintext')
            
            # Set content in Monaco
            escaped = content.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
            self.editor_view.page().runJavaScript(f"window._setContent(`{escaped}`, '{lang}')")
            
            # Add tab
            tab_name = os.path.basename(path)
            idx = self.tabs.addTab(QWidget(), tab_name)
            self.tabs.setTabToolTip(idx, path)
            self.tabs.setCurrentIndex(idx)
            
        except Exception as e:
            print(f"Error opening file: {e}")
            
    def save_current(self):
        """Save the current file."""
        if self.current_file and self.editor_view:
            try:
                self.editor_view.page().runJavaScript(
                    "window._getContent()",
                    lambda content: self._do_save(content)
                )
            except Exception as e:
                print(f"Error saving: {e}")
                
    def _do_save(self, content):
        if self.current_file and content is not None:
            try:
                with open(self.current_file, 'w', encoding='utf-8') as f:
                    f.write(content)
                print(f"Saved: {self.current_file}")
            except Exception as e:
                print(f"Error writing file: {e}")
                
    def _close_tab(self, index):
        self.tabs.removeTab(index)


class TerminalWidget(QWidget):
    """xterm.js terminal embedded via QWebEngineView."""
    
    def __init__(self, api_client, parent=None):
        super().__init__(parent)
        self.api = api_client
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(0, 0, 0, 0)
        
        self.terminal_view = QWebEngineView()
        self.terminal_view.settings().setAttribute(QWebEngineSettings.JavascriptEnabled, True)
        self.terminal_view.setHtml(self._get_xterm_html())
        layout.addWidget(self.terminal_view)
        
    def _get_xterm_html(self):
        return """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css">
<style>
* { margin: 0; padding: 0; }
body { background: #1e1e1e; overflow: hidden; }
#terminal { padding: 4px; }
</style>
</head>
<body>
<div id="terminal"></div>
<script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
<script>
var term = new Terminal({
    theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#6a9955',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#6a9955',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff'
    },
    fontFamily: "'Consolas', 'Courier New', monospace",
    fontSize: 14,
    cursorBlink: true,
    scrollback: 5000
});

var fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();

// Send commands to Python backend
term.onData(function(data) {
    window._tcide_terminal_input = data;
});

// Write output from Python
window._terminalWrite = function(text) {
    term.write(text);
};

// Clear terminal
window._terminalClear = function() {
    term.clear();
};

console.log('xterm.js initialized');
</script>
</body>
</html>"""
        
    def write(self, text):
        """Write text to terminal."""
        escaped = text.replace('\\', '\\\\').replace('`', '\\`').replace('${', '\\${')
        self.terminal_view.page().runJavaScript(f"window._terminalWrite(`{escaped}`)")
        
    def clear(self):
        """Clear terminal."""
        self.terminal_view.page().runJavaScript("window._terminalClear()")


class AIChatWidget(QWidget):
    """AI chat panel with message history."""
    
    def __init__(self, api_client, pet_widget=None, parent=None):
        super().__init__(parent)
        self.api = api_client
        self.pet = pet_widget
        self.messages = []
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        
        # Header
        header = QLabel("AI Assistant")
        header.setStyleSheet("font-weight: bold; font-size: 14px; color: #569cd6;")
        layout.addWidget(header)
        
        # Message display
        self.message_display = QTextEdit()
        self.message_display.setReadOnly(True)
        self.message_display.setStyleSheet("""
            QTextEdit {
                background: #1e1e1e;
                border: 1px solid #3c3c3c;
                padding: 8px;
                font-size: 13px;
            }
        """)
        layout.addWidget(self.message_display)
        
        # Input area
        input_layout = QHBoxLayout()
        
        self.input_field = QLineEdit()
        self.input_field.setPlaceholderText("Ask AI anything...")
        self.input_field.returnPressed.connect(self._send_message)
        input_layout.addWidget(self.input_field)
        
        send_btn = QPushButton("Send")
        send_btn.clicked.connect(self._send_message)
        input_layout.addWidget(send_btn)
        
        layout.addLayout(input_layout)
        
        # Action buttons
        action_layout = QHBoxLayout()
        
        build_btn = QPushButton("Build Plan")
        build_btn.clicked.connect(self._build_plan)
        action_layout.addWidget(build_btn)
        
        code_btn = QPushButton("Generate Code")
        code_btn.clicked.connect(self._generate_code)
        action_layout.addWidget(code_btn)
        
        review_btn = QPushButton("Review")
        review_btn.clicked.connect(self._review_code)
        action_layout.addWidget(review_btn)
        
        layout.addLayout(action_layout)
        
    def _send_message(self):
        text = self.input_field.text().strip()
        if not text:
            return
            
        self.input_field.clear()
        self._add_message("user", text)
        
        if self.pet:
            self.pet.set_state("thinking")
            
        # Add to history
        self.messages.append({"role": "user", "content": text})
        
        # Call API in background thread
        thread = APICallThread(self.api.ai_chat, self.messages)
        thread.result_ready.connect(self._on_response)
        thread.start()
        
    def _on_response(self, response):
        if response and "choices" in response:
            content = response["choices"][0]["message"]["content"]
            self._add_message("assistant", content)
            self.messages.append({"role": "assistant", "content": content})
        else:
            self._add_message("error", "Failed to get response")
            
        if self.pet:
            self.pet.set_state("idle")
            
    def _build_plan(self):
        text = self.input_field.text().strip()
        if not text:
            return
        if self.pet:
            self.pet.set_state("thinking")
        thread = APICallThread(self.api.ai_build, text)
        thread.result_ready.connect(self._on_plan_result)
        thread.start()
        
    def _on_plan_result(self, result):
        if result and "tasks" in result:
            tasks = result["tasks"]
            self._add_message("plan", f"Build plan: {len(tasks)} tasks")
            for i, task in enumerate(tasks, 1):
                self._add_message("task", f"{i}. {task.get('description', 'Unknown')}")
        else:
            self._add_message("error", "Failed to build plan")
        if self.pet:
            self.pet.set_state("idle")
            
    def _generate_code(self):
        text = self.input_field.text().strip()
        if not text:
            return
        if self.pet:
            self.pet.set_state("tool")
        thread = APICallThread(self.api.ai_code, {"task": text})
        thread.result_ready.connect(self._on_code_result)
        thread.start()
        
    def _on_code_result(self, result):
        if result and "actions" in result:
            actions = result["actions"]
            self._add_message("code", f"Generated {len(actions)} actions")
            for action in actions:
                if action.get("type") == "write_file":
                    self._add_message("file", f"Write: {action.get('path', 'Unknown')}")
        else:
            self._add_message("error", "Failed to generate code")
        if self.pet:
            self.pet.set_state("idle")
            
    def _review_code(self):
        if self.pet:
            self.pet.set_state("review")
        thread = APICallThread(self.api.ai_review, [])
        thread.result_ready.connect(self._on_review_result)
        thread.start()
        
    def _on_review_result(self, result):
        if result and "issues" in result:
            issues = result["issues"]
            self._add_message("review", f"Found {len(issues)} issues")
        else:
            self._add_message("info", "Review complete")
        if self.pet:
            self.pet.set_state("idle")
            
    def _add_message(self, role, content):
        color_map = {
            "user": "#569cd6",
            "assistant": "#6a9955",
            "error": "#f44747",
            "plan": "#dcdcaa",
            "task": "#c586c0",
            "code": "#4ec9b0",
            "file": "#ce9178",
            "review": "#d7ba7d",
            "info": "#808080"
        }
        color = color_map.get(role, "#d4d4d4")
        html = f'<p style="color: {color}; margin: 4px 0;"><b>{role.upper()}:</b> {content}</p>'
        self.message_display.append(html)


class GitWidget(QWidget):
    """Git status and operations panel."""
    
    def __init__(self, api_client, parent=None):
        super().__init__(parent)
        self.api = api_client
        self._setup_ui()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        
        header = QLabel("Git")
        header.setStyleSheet("font-weight: bold; font-size: 14px; color: #569cd6;")
        layout.addWidget(header)
        
        self.status_display = QTextEdit()
        self.status_display.setReadOnly(True)
        self.status_display.setMaximumHeight(200)
        layout.addWidget(self.status_display)
        
        btn_layout = QHBoxLayout()
        
        refresh_btn = QPushButton("Refresh")
        refresh_btn.clicked.connect(self.refresh_status)
        btn_layout.addWidget(refresh_btn)
        
        commit_btn = QPushButton("Commit")
        commit_btn.clicked.connect(self._commit)
        btn_layout.addWidget(commit_btn)
        
        layout.addLayout(btn_layout)
        
        self.commit_input = QLineEdit()
        self.commit_input.setPlaceholderText("Commit message...")
        layout.addWidget(self.commit_input)
        
    def refresh_status(self):
        status = self.api.git_status()
        if status:
            self.status_display.setText(json.dumps(status, indent=2))
            
    def _commit(self):
        msg = self.commit_input.text().strip()
        if not msg:
            return
        result = self.api.git_commit(msg)
        if result:
            self.status_display.setText("Committed!")
            self.commit_input.clear()
            self.refresh_status()


class SettingsWidget(QWidget):
    """Settings panel for AI configuration."""
    
    settings_changed = Signal(dict)
    
    def __init__(self, api_client, parent=None):
        super().__init__(parent)
        self.api = api_client
        self._setup_ui()
        self._load_settings()
        
    def _setup_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 16, 16, 16)
        
        header = QLabel("Settings")
        header.setStyleSheet("font-weight: bold; font-size: 16px; color: #569cd6;")
        layout.addWidget(header)
        
        # Provider
        layout.addWidget(QLabel("AI Provider:"))
        self.provider_input = QLineEdit()
        self.provider_input.setPlaceholderText("e.g., deepseek, openai, anthropic")
        layout.addWidget(self.provider_input)
        
        # Model
        layout.addWidget(QLabel("Model:"))
        self.model_input = QLineEdit()
        self.model_input.setPlaceholderText("e.g., deepseek-v4-pro, gpt-4")
        layout.addWidget(self.model_input)
        
        # Base URL
        layout.addWidget(QLabel("Base URL:"))
        self.base_url_input = QLineEdit()
        self.base_url_input.setPlaceholderText("e.g., https://api.deepseek.com/v1")
        layout.addWidget(self.base_url_input)
        
        # API Key
        layout.addWidget(QLabel("API Key:"))
        self.api_key_input = QLineEdit()
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setPlaceholderText("Enter your API key")
        layout.addWidget(self.api_key_input)
        
        # Save button
        save_btn = QPushButton("Save Settings")
        save_btn.clicked.connect(self._save_settings)
        layout.addWidget(save_btn)
        
        layout.addStretch()
        
    def _load_settings(self):
        settings = self.api.get_settings()
        if settings:
            self.provider_input.setText(settings.get("provider", ""))
            self.model_input.setText(settings.get("model", ""))
            self.base_url_input.setText(settings.get("base_url", ""))
            self.api_key_input.setText(settings.get("api_key", ""))
            
    def _save_settings(self):
        settings = {
            "provider": self.provider_input.text(),
            "model": self.model_input.text(),
            "base_url": self.base_url_input.text(),
            "api_key": self.api_key_input.text()
        }
        result = self.api.save_settings(settings)
        if result:
            self.settings_changed.emit(settings)
            QMessageBox.information(self, "Settings", "Settings saved!")


class APICallThread(QThread):
    """Background thread for API calls."""
    
    result_ready = Signal(object)
    
    def __init__(self, func, *args, **kwargs):
        super().__init__()
        self.func = func
        self.args = args
        self.kwargs = kwargs
        
    def run(self):
        try:
            result = self.func(*self.args, **self.kwargs)
            self.result_ready.emit(result)
        except Exception as e:
            print(f"API call error: {e}")
            self.result_ready.emit(None)


class TCIDEWindow(QMainWindow):
    """Main TCIDE window with full IDE functionality."""
    
    def __init__(self, project_path=None):
        super().__init__()
        self.setWindowTitle(APP_TITLE)
        self.setMinimumSize(1200, 800)
        
        # Apply dark theme
        self.setStyleSheet(DARK_THEME)
        
        # API client
        self.api = APIClient()
        
        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QHBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)
        
        # Main splitter (horizontal)
        main_splitter = QSplitter(Qt.Horizontal)
        
        # Left panel (file tree + pet)
        left_panel = QWidget()
        left_layout = QVBoxLayout(left_panel)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(0)
        
        # Pet widget
        pet_assets = os.path.join(os.path.dirname(__file__), 'pet_assets')
        self.pet_widget = TCIDEPet(pet_assets)
        self.pet_widget.setFixedHeight(100)
        left_layout.addWidget(self.pet_widget)
        
        # File tree
        self.file_tree = FileTreeWidget(self.api)
        self.file_tree.file_selected.connect(self._on_file_selected)
        left_layout.addWidget(self.file_tree)
        
        left_panel.setFixedWidth(250)
        main_splitter.addWidget(left_panel)
        
        # Center panel (editor + terminal)
        center_panel = QSplitter(Qt.Vertical)
        
        # Editor
        self.editor = EditorWidget()
        center_panel.addWidget(self.editor)
        
        # Terminal
        self.terminal = TerminalWidget(self.api)
        self.terminal.setMaximumHeight(250)
        center_panel.addWidget(self.terminal)
        
        center_panel.setStretchFactor(0, 3)
        center_panel.setStretchFactor(1, 1)
        main_splitter.addWidget(center_panel)
        
        # Right panel (tabs: AI, Git, Settings)
        right_panel = QTabWidget()
        right_panel.setFixedWidth(320)
        
        self.ai_chat = AIChatWidget(self.api, self.pet_widget)
        right_panel.addTab(self.ai_chat, "AI")
        
        self.git_widget = GitWidget(self.api)
        right_panel.addTab(self.git_widget, "Git")
        
        self.settings_widget = SettingsWidget(self.api)
        right_panel.addTab(self.settings_widget, "Settings")
        
        main_splitter.addWidget(right_panel)
        
        main_splitter.setStretchFactor(0, 0)
        main_splitter.setStretchFactor(1, 3)
        main_splitter.setStretchFactor(2, 0)
        
        main_layout.addWidget(main_splitter)
        
        # Status bar
        self.statusBar().showMessage("Ready")
        
        # Menu bar
        self._create_menu()
        
        # Open project if provided
        if project_path:
            self._open_project(project_path)
            
    def _create_menu(self):
        menubar = self.menuBar()
        
        # File menu
        file_menu = menubar.addMenu("File")
        
        open_action = QAction("Open Project", self)
        open_action.setShortcut("Ctrl+O")
        open_action.triggered.connect(self._open_project_dialog)
        file_menu.addAction(open_action)
        
        save_action = QAction("Save", self)
        save_action.setShortcut("Ctrl+S")
        save_action.triggered.connect(self.editor.save_current)
        file_menu.addAction(save_action)
        
        file_menu.addSeparator()
        
        exit_action = QAction("Exit", self)
        exit_action.setShortcut("Ctrl+Q")
        exit_action.triggered.connect(self.close)
        file_menu.addAction(exit_action)
        
        # Edit menu
        edit_menu = menubar.addMenu("Edit")
        
        undo_action = QAction("Undo", self)
        undo_action.setShortcut("Ctrl+Z")
        edit_menu.addAction(undo_action)
        
        redo_action = QAction("Redo", self)
        redo_action.setShortcut("Ctrl+Y")
        edit_menu.addAction(redo_action)
        
        # View menu
        view_menu = menubar.addMenu("View")
        
        terminal_action = QAction("Toggle Terminal", self)
        terminal_action.setShortcut("Ctrl+`")
        view_menu.addAction(terminal_action)
        
        # Help menu
        help_menu = menubar.addMenu("Help")
        
        about_action = QAction("About", self)
        about_action.triggered.connect(self._show_about)
        help_menu.addAction(about_action)
        
    def _open_project_dialog(self):
        path = QFileDialog.getExistingDirectory(self, "Open Project")
        if path:
            self._open_project(path)
            
    def _open_project(self, path):
        result = self.api.open_project(path)
        if result:
            self.file_tree.set_project(path)
            self.statusBar().showMessage(f"Opened: {path}")
            self.pet_widget.set_state("idle")
        else:
            QMessageBox.warning(self, "Error", "Failed to open project")
            
    def _on_file_selected(self, path):
        self.editor.open_file(path)
        self.statusBar().showMessage(f"Editing: {path}")
        
    def _show_about(self):
        QMessageBox.about(self, "About TCIDE",
                         "虎猫 TCIDE v0.0.1\n\n"
                         "Personal AI-powered IDE\n"
                         "Builder → Coder → Compile → Deploy\n\n"
                         "Built with pawui + PySide6")


def main():
    """Main entry point."""
    app = QApplication(sys.argv)
    app.setApplicationName("虎猫 TCIDE")
    app.setOrganizationName("Guanist")
    
    # Determine project path
    project_path = None
    if len(sys.argv) > 1:
        project_path = sys.argv[1]
    else:
        # Default to TCIDE's own directory
        project_path = os.path.dirname(os.path.abspath(__file__))
        
    window = TCIDEWindow(project_path)
    window.show()
    
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
