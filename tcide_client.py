"""
TCIDE - pawui + rich 前端客户端

封装对 FastAPI 后端的 HTTP 调用，并用 rich 把：
  - 终端输出（rich Console）
  - AI 对话（rich Markdown / Panel）
  - Git 状态（rich Table）
  - 代码预览（rich Syntax）
渲染成 HTML，交回 pawui 的 Text(QLabel) 展示。
"""

import os

import httpx
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.syntax import Syntax
from rich.table import Table

_LEXERS = {
    ".py": "python", ".js": "javascript", ".ts": "typescript", ".jsx": "jsx",
    ".tsx": "tsx", ".json": "json", ".md": "markdown", ".html": "html",
    ".css": "css", ".go": "go", ".rs": "rust", ".java": "java", ".c": "c",
    ".cpp": "cpp", ".h": "c", ".hpp": "cpp", ".sh": "bash", ".ps1": "powershell",
    ".yml": "yaml", ".yaml": "yaml", ".toml": "toml", ".xml": "xml",
    ".sql": "sql", ".rb": "ruby", ".lua": "lua", ".kt": "kotlin",
}


def _lex(name: str) -> str:
    return _LEXERS.get(os.path.splitext(name)[1].lower(), "text")


class TCIDEClient:
    def __init__(self, base_url: str):
        self.base = base_url.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=60)

    # ── 项目 / 文件 ──
    def open_project(self, path: str) -> dict:
        return self.http.post("/api/project/open", json={"path": path}).json()

    def list_dir(self, path: str, depth: int = 1) -> list:
        return self.http.get("/api/files/list", params={"path": path, "depth": depth}).json().get("items", [])

    def read_file(self, path: str) -> dict:
        return self.http.get("/api/files/read", params={"path": path}).json()

    def write_file(self, path: str, content: str) -> dict:
        return self.http.post("/api/files/write", json={"path": path, "content": content}).json()

    # ── 终端 ──
    def exec(self, cmd: str, cwd: str = ".") -> dict:
        return self.http.post("/api/exec", json={"command": cmd, "cwd": cwd, "timeout": 30}).json()

    # ── Git ──
    def git_status(self) -> dict:
        return self.http.get("/api/git/status").json()

    def git_commit(self, msg: str) -> dict:
        self.http.post("/api/git/stage")
        return self.http.post("/api/git/commit", json={"message": msg}).json()

    def branch(self) -> str:
        try:
            return self.http.get("/api/git/branches").json().get("current", "")
        except Exception:
            return ""

    # ── AI ──
    def ai_chat(self, messages: list) -> str:
        try:
            return self.http.post("/api/ai/chat", json={"messages": messages}).json().get("content", "")
        except Exception as e:
            return f"[AI 调用失败: {e}]"

    # ── 设置 ──
    def get_settings(self) -> dict:
        try:
            return self.http.get("/api/settings").json()
        except Exception:
            return {}

    def save_settings(self, provider: str, base_url: str, api_key: str, model: str) -> None:
        try:
            self.http.post(
                "/api/settings/ai",
                json={"provider": provider, "baseUrl": base_url, "apiKey": api_key, "model": model},
            )
        except Exception:
            pass

    # ── rich 渲染 ──
    @staticmethod
    def _con() -> Console:
        return Console(record=True, width=110, markup=True)

    @staticmethod
    def render_terminal(cmd: str, res: dict) -> str:
        c = TCIDEClient._con()
        c.print(f"[bold cyan]$ {cmd}[/bold cyan]")
        out = (res.get("stdout") or "").rstrip("\n")
        err = (res.get("stderr") or "").rstrip("\n")
        if out:
            c.print(out)
        if err:
            c.print(f"[red]{err}[/red]")
        c.print(f"[dim]exit={res.get('exitCode')}[/dim]")
        return c.export_html()

    @staticmethod
    def render_ai(messages: list) -> str:
        c = TCIDEClient._con()
        for m in messages:
            if m.get("role") == "user":
                c.print(Panel(m.get("content", ""), title="You", border_style="cyan"))
            else:
                c.print(Markdown(m.get("content", "") or "_（空）_"))
        return c.export_html()

    @staticmethod
    def render_git(status: dict) -> str:
        c = TCIDEClient._con()
        files = (status or {}).get("files") if isinstance(status, dict) else None
        if not files:
            c.print("[dim]无可提交改动[/dim]")
            return c.export_html()
        t = Table(show_header=True, header_style="bold magenta")
        t.add_column("状态", style="bold")
        t.add_column("文件")
        for f in files:
            t.add_row(str(f.get("status", "")), f.get("path", ""))
        c.print(t)
        return c.export_html()

    @staticmethod
    def render_code(name: str, content: str) -> str:
        c = TCIDEClient._con()
        c.print(Syntax(content or "", _lex(name), theme="ansi_dark", line_numbers=True))
        return c.export_html()
