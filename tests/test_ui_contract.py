"""前端契约路由的回归测试（本仓库的第一批测试）。

为什么先测这些：``web/`` 前端调用了一批接口，其中有些**后端根本没有**、有些
**URL 或参数名对不上**（例如前端 ``GET /api/entropy/evaluate?path=…`` 而后端只收
``file_path`` → FastAPI 返回 422）。这些缺陷不会让服务崩，只会让界面上的功能
静默失效 —— 所以必须用测试钉住"前端怎么调，后端就得怎么答"。

跑法::

    python -m pytest tests/ -q
"""

from __future__ import annotations

import pathlib
import sys

import pytest
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="module")
def client():
    """带上 lifespan 的测试客户端（lifespan 里会设置默认项目根）。"""
    import server

    with TestClient(server.app) as instance:
        instance.post("/api/project/open", params={"path": str(ROOT)})
        yield instance


# ── 代码熵：前端用 project / path 两种写法 ────────────────────────────────

class TestEntropyContract:
    def test_init_accepts_project_param(self, client):
        response = client.post("/api/entropy/init", params={"project": str(ROOT)})
        assert response.status_code == 200
        body = response.json()
        assert body["success"] is True
        assert body["project"]

    def test_evaluate_accepts_the_frontends_param_spelling(self, client):
        """回归：前端发 ``?path=…``，后端以前只声明 ``file_path`` → **422**。

        这类"参数名对不上"是最隐蔽的一类缺陷：HTTP 状态码不是 500，
        界面只是拿到一个错误对象、功能静默失效。
        """
        target = ROOT / "server.py"
        response = client.get("/api/entropy/evaluate", params={"path": str(target)})
        assert response.status_code == 200, response.text
        assert "error" not in response.json() or response.json()["error"] == ""

    def test_evaluate_still_accepts_file_path(self, client):
        """老写法（file_path）不能因为兼容新写法而失效。"""
        response = client.get("/api/entropy/evaluate",
                              params={"file_path": str(ROOT / "server.py")})
        assert response.status_code == 200

    def test_ctrl_tick_then_recommendation(self, client):
        client.post("/api/entropy/ctrl/init")
        tick = client.post("/api/entropy/ctrl/tick")
        assert tick.status_code == 200
        body = tick.json()
        # 引擎不可用时也要给出**原因**，而不是假装成功
        if body.get("success"):
            assert body["ticks"] >= 1
            assert body["recommendation"]["actions"]
        else:
            assert "error" in body
        recommendation = client.get("/api/entropy/ctrl/recommendation")
        assert recommendation.status_code == 200
        assert "recommendation" in recommendation.json()


# ── 仓库分析：前端用 analyze-all（POST 与 GET 都在用）────────────────────

class TestWarehouseContract:
    def test_init_and_analyze_all_via_post(self, client):
        assert client.post("/api/warehouse/init",
                           params={"project": str(ROOT)}).status_code == 200
        response = client.post("/api/warehouse/analyze-all")
        assert response.status_code == 200
        body = response.json()
        # 架构报告来自 tcide_core.arch（纯标准库）；至少要能产出依赖图
        assert "architecture" in body or "architecture_error" in body
        if "architecture" in body:
            assert isinstance(body["architecture"], dict)

    def test_analyze_all_via_get(self, client):
        """前端 ``analyzeArchitecture`` 用的就是 GET。"""
        response = client.get("/api/warehouse/analyze-all")
        assert response.status_code == 200

    def test_call_chain_and_impact_answer_for_a_real_file(self, client):
        relative = "server.py"
        chain = client.get("/api/warehouse/call-chain", params={"file": relative})
        assert chain.status_code == 200
        body = chain.json()
        assert body["file"] == relative
        assert body["direction"] == "out"
        assert isinstance(body["depends_on"], list)

        impact = client.get("/api/warehouse/impact", params={"file": relative})
        assert impact.status_code == 200
        assert impact.json()["direction"] == "in"

    def test_missing_param_is_reported_not_crashed(self, client):
        response = client.get("/api/warehouse/call-chain")
        assert response.status_code == 200
        assert "error" in response.json()


# ── 静态检查与分块：这两个接口此前**完全没有** ───────────────────────────

class TestLintAndChunker:
    def test_lint_returns_issues_and_summary(self, client):
        response = client.get("/api/lint", params={"path": str(ROOT / "main.py")})
        assert response.status_code == 200
        body = response.json()
        assert body["file"] == "main.py"
        assert body.get("success") is True, body
        assert isinstance(body["issues"], list)
        assert "summary" in body

    def test_lint_reports_a_planted_problem(self, client, tmp_path):
        """种一个已知问题，确认规则**真的在跑**（不是永远返回空列表）。"""
        target = ROOT / "tests" / "_lint_probe.py"
        target.write_text("import os\nimport sys\n\n\ndef f():\n"
                          "    x = 1\n    return x\n", encoding="utf-8")
        try:
            response = client.get("/api/lint", params={"path": str(target)})
            body = response.json()
            assert body["success"] is True
            kinds = {item.get("kind") or item.get("rule") for item in body["issues"]}
            assert kinds, f"未检出任何问题：{body}"
        finally:
            target.unlink(missing_ok=True)

    def test_needs_chunking_for_a_large_file(self, client):
        response = client.get("/api/chunker/needs-chunking",
                              params={"file_path": str(ROOT / "server.py")})
        assert response.status_code == 200
        body = response.json()
        assert body["file"] == "server.py"
        assert "needs_chunking" in body

    def test_needs_chunking_without_param_is_reported(self, client):
        response = client.get("/api/chunker/needs-chunking")
        assert response.status_code == 200
        assert "error" in response.json()


# ── LSP 透传 ─────────────────────────────────────────────────────────────

class TestLspContract:
    def test_install_guide_lists_servers_and_hint(self, client):
        body = client.get("/api/lsp/install-guide",
                          params={"language": "python"}).json()
        assert body["language"] == "python"
        assert isinstance(body["servers"], list)
        assert body["hint"]

    def test_start_accepts_query_params(self, client):
        """回归：前端 ``POST /api/lsp/start?language=…`` **不带 body**。

        原来那个处理函数直接 ``await request.json()`` → 空 body 抛
        ``JSONDecodeError`` → 界面上 LSP 永远起不来。
        """
        response = client.post("/api/lsp/start", params={"language": "python"})
        assert response.status_code == 200, response.text
        assert isinstance(response.json(), dict)

    def test_request_without_language_is_reported(self, client):
        body = client.post("/api/lsp/request", json={}).json()
        assert "error" in body

    def test_notify_without_language_is_reported(self, client):
        body = client.post("/api/lsp/notify", json={}).json()
        assert "error" in body


# ── 文件：十六进制与系统打开 ─────────────────────────────────────────────

class TestFilesContract:
    def test_hex_view_returns_lines_and_info(self, client):
        body = client.get("/api/files/hex",
                          params={"path": "server.py", "rows": 4}).json()
        assert body["file"] == "server.py"
        assert 0 < len(body["lines"]) <= 4
        assert "info" in body

    def test_hex_view_without_param_is_reported(self, client):
        assert "error" in client.get("/api/files/hex").json()

    def test_open_url_refuses_non_http(self, client):
        """安全边界：只允许 http/https，别让一个网页请求拉起任意协议。"""
        body = client.post("/api/files/open-url",
                           params={"url": "file:///C:/Windows/System32/calc.exe"}).json()
        assert body["success"] is False
        assert "http" in body["error"]

    def test_open_refuses_paths_outside_the_project(self, client):
        body = client.post("/api/files/open",
                           params={"path": "../../Windows/System32/calc.exe"}).json()
        assert body["success"] is False

    def test_show_refuses_missing_file(self, client):
        body = client.post("/api/files/show",
                           params={"path": "no-such-file-xyz.txt"}).json()
        assert body["success"] is False


# ── Git：暂存全部（**不碰真实仓库**）─────────────────────────────────────

class TestGitContract:
    def test_stage_all_reports_a_readable_reason_outside_a_repo(self, client):
        """在**非 git 仓库**的临时目录里调用，应当如实报错而不是抛异常。

        刻意不在这里提交/暂存真实项目：测试改动真实仓库是绝对要避免的事
        （tcide-pawui 那边就因为测试夹具提交进过真实仓库）。
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            client.post("/api/project/open", params={"path": tmp})
            body = client.post("/api/git/stage-all").json()
            assert body["success"] is False, body
            assert "error" in body
        # 还原项目根，别影响别的用例
        client.post("/api/project/open", params={"path": str(ROOT)})
