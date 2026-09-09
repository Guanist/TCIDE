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
        self.project_dir = ""

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

    # ── AI Agents: Builder / Coder / Reviewer 自动编程循环 ──
    def ai_configure(self, provider: str, base_url: str, api_key: str, model: str) -> None:
        try:
            self.http.post(
                "/api/ai/configure",
                json={"provider": provider, "base_url": base_url,
                      "api_key": api_key, "model": model},
            )
        except Exception:
            pass

    def ai_build(self, requirement: str, project_context: str = "") -> dict:
        try:
            return self.http.post(
                "/api/ai/build",
                json={"requirement": requirement, "project_context": project_context},
            ).json()
        except Exception as e:
            return {"success": False, "error": str(e)}

    def ai_code(self, task: str, project_context: str = "", file_contents: dict | None = None) -> dict:
        try:
            return self.http.post(
                "/api/ai/code",
                json={"task": task, "project_context": project_context,
                      "file_contents": file_contents or {}},
            ).json()
        except Exception as e:
            return {"success": False, "error": str(e)}

    def ai_review(self, requirement: str, file_changes: dict) -> dict:
        try:
            return self.http.post(
                "/api/ai/review",
                json={"code": requirement, "context": file_changes},
            ).json()
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _project_context(self) -> str:
        return "项目根目录: " + (self.project_dir or ".")

    def _detect_test_command(self) -> str:
        d = self.project_dir or "."
        checks = [
            ("package.json", "npm test"),
            ("pytest.ini", "pytest"),
            ("setup.py", "pytest"),
            ("pyproject.toml", "pytest"),
            ("go.mod", "go test ./..."),
            ("Cargo.toml", "cargo test"),
            ("Makefile", "make test"),
        ]
        for fname, cmd in checks:
            if os.path.exists(os.path.join(d, fname)):
                return cmd
        return ""

    def run_auto_task(self, requirement: str, progress=None) -> dict:
        """双 Agent 自动编程循环：Builder -> Coder(落盘+执行) -> 验证 -> 审查 -> 提交。

        progress(phase, msg) 回调用于实时驱动像素宠物与日志。
        phase: building | coding | verifying | reviewing | committing | done | error
        """
        def report(phase: str, msg: str):
            if progress:
                try:
                    progress(phase, msg)
                except Exception:
                    pass

        report("building", "🐱 虎猫开始分析需求并拆解任务…")
        ctx = self._project_context()
        b = self.ai_build(requirement, ctx)
        if not b.get("success"):
            report("error", "❌ Builder 失败: " + str(b.get("error", "")))
            return {"success": False, "phase": "build", "error": b.get("error")}
        tasks = b.get("tasks", []) or []
        report("building", f"📋 已规划 {len(tasks)} 个任务")
        for t in tasks:
            report("building", f"  · [{t.get('id', '?')}] {t.get('description', '')}")

        changed: dict = {}
        for t in tasks:
            tid = t.get("id", "?")
            report("coding", f"⌨️ 编码任务 {tid}: {t.get('description', '')}")
            files_ctx = {}
            for fp in (t.get("files", []) or []):
                try:
                    files_ctx[fp] = self.read_file(fp).get("content", "")
                except Exception:
                    pass
            c = self.ai_code(t.get("description", ""), ctx, files_ctx)
            if not c.get("success"):
                report("error", f"❌ Coder 任务 {tid} 失败: {c.get('error', '')}")
                return {"success": False, "phase": "code", "error": c.get("error"), "changed": changed}
            for a in (c.get("actions", []) or []):
                act = a.get("action", "")
                if act == "write_file":
                    p = a.get("path", "")
                    w = self.write_file(p, a.get("content", ""))
                    if w.get("success"):
                        changed[p] = a.get("content", "")
                        report("coding", f"  ✏️ 写入 {p}")
                    else:
                        report("coding", f"  ⚠️ 写入失败 {p}: {w.get('error', '')}")
                elif act == "run_command":
                    r = self.exec(a.get("command", ""), cwd=self.project_dir or ".")
                    report("coding", f"  🔧 `{a.get('command', '')}` → exit {r.get('exitCode')}")
                elif act == "read_file":
                    report("coding", f"  👀 读取 {a.get('path', '')}")
            report("coding", f"  ✓ {c.get('summary', '')}")

        # 验证
        report("verifying", "🔍 运行构建/测试验证…")
        test_cmd = self._detect_test_command()
        if test_cmd:
            r = self.exec(test_cmd, cwd=self.project_dir or ".")
            ok = r.get("exitCode") == 0
            report("verifying", f"  {'✅' if ok else '⚠️'} {test_cmd} → exit {r.get('exitCode')}")
            if r.get("stderr"):
                report("verifying", "  " + r.get("stderr", "")[:300])
        else:
            report("verifying", "  （未发现测试/构建命令，跳过验证）")

        # 审查
        report("reviewing", "📝 审查改动…")
        try:
            rv = self.ai_review(requirement, changed)
            approved = rv.get("approved", True)
            report("reviewing", f"  {'✅' if approved else '⚠️'} {rv.get('summary', '')}")
        except Exception as e:
            report("reviewing", f"  ⚠️ 审查出错: {e}")

        # 提交
        report("committing", "💾 提交改动到 Git…")
        try:
            self.git_commit(f"虎猫自动编程: {requirement[:60]}")
            report("committing", "  ✓ 已提交")
        except Exception as e:
            report("committing", f"  ⚠️ 提交失败(可能无改动): {e}")

        report("done", "🎉 自动编程结束。")
        return {"success": True, "changed": changed, "tasks": len(tasks)}
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
