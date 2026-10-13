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


class TestLspMerge:
    """合并后 ``api/lsp.py`` 必须提供 ``server.py`` 调用的**全部**函数。

    合并前它只有 9 个函数，而路由在调 ``did_open`` / ``get_diagnostics`` /
    ``goto_definition`` 等 —— 那些**根本不存在**，一调就是 ``AttributeError``。
    """

    REQUIRED = ("start_server", "stop_server", "get_status", "did_open", "did_change",
                "get_diagnostics", "format_document", "goto_definition",
                "find_references", "send_request", "send_notify", "completion",
                "shutdown_all", "LSP_CONFIGS")

    def test_module_exposes_every_name_the_routes_call(self):
        from api import lsp

        missing = [name for name in self.REQUIRED if not hasattr(lsp, name)]
        assert not missing, f"api/lsp.py 缺少路由要用的名字：{missing}"

    def test_status_overview_shape(self):
        from api import lsp

        status = lsp.get_status("")
        assert "servers" in status and "available" in status and "configs" in status
        for item in status["servers"]:
            if not item["available"]:
                assert item["hint"], f"{item['language']} 不可用时必须给出安装提示"

    def test_start_reports_install_hint_instead_of_crashing(self):
        """没装 pyright 时要**如实说明**，不能像原来那样让 subprocess 抛异常。"""
        from api import lsp

        result = lsp.start_server("python", str(ROOT))
        if "error" in result:
            assert result.get("hint"), result
        else:
            lsp.stop_server("python", str(ROOT))

    def test_previously_broken_routes_answer(self, client):
        """这几条路由以前会因为函数不存在而 500；现在必须给出可读回应。"""
        payload = {"language": "python", "uri": (ROOT / "server.py").as_uri(),
                   "text": "x = 1\n", "line": 0, "character": 0}
        for path in ("/api/lsp/didOpen", "/api/lsp/didChange", "/api/lsp/format",
                     "/api/lsp/definition", "/api/lsp/references", "/api/lsp/completion"):
            response = client.post(path, json=payload)
            assert response.status_code == 200, f"{path} → {response.status_code}"
            assert isinstance(response.json(), dict), path

    def test_diagnostics_route_answers(self, client):
        response = client.get("/api/lsp/diagnostics",
                              params={"uri": (ROOT / "server.py").as_uri()})
        assert response.status_code == 200
        assert isinstance(response.json().get("diagnostics"), list)


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


# ── 无人值守执行：必须**真的**执行（原实现是"演戏"）─────────────────────

@pytest.fixture
def temp_project(client):
    """把项目根临时切到一个空目录，用完还原（避免测试往真实仓库里写文件）。"""
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        client.post("/api/project/open", params={"path": tmp})
        client.post("/api/runner/init", params={"project": tmp})
        yield tmp
    client.post("/api/project/open", params={"path": str(ROOT)})
    client.post("/api/runner/init", params={"project": str(ROOT)})


class TestRunnerContract:
    def test_execute_really_runs_the_command(self, client, temp_project):
        """关键回归：``advanced.UnattendedRunner.run_task`` 只是塞几条 "running"
        然后返回 "completed"，**什么都没执行**。这里必须看到命令的真实输出。
        """
        response = client.post("/api/runner/execute", json={
            "steps": [{"name": "probe", "command": "echo batch-runner-marker-42"}]})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body.get("success") is True, body
        blob = str(body.get("report")) + str(body.get("summary"))
        assert "batch-runner-marker-42" in blob, f"没有真实输出：{body}"

    def test_execute_reports_a_failing_command(self, client, temp_project):
        """失败的命令必须让整体为失败，而不是无条件 completed。"""
        response = client.post("/api/runner/execute", json={
            "steps": [{"name": "bad", "command": "exit 3"}]})
        body = response.json()
        assert body.get("success") is False, body

    def test_execute_without_task_or_steps_is_reported(self, client, temp_project):
        assert "error" in client.post("/api/runner/execute", json={}).json()

    def test_legacy_run_route_now_really_executes(self, client, temp_project):
        """老接口 ``/api/runner/run`` 也接上了真实执行器。

        原来它走 ``advanced.UnattendedRunner.run_task``：只塞几条 ``"running"``
        就返回 ``"completed"``，**什么都没跑**。现在必须能看到命令的真实输出。
        """
        body = client.post("/api/runner/run",
                           params={"task": "echo legacy-run-marker"}).json()
        assert body.get("success") is True, body
        assert "legacy-run-marker" in str(body), body

    def test_legacy_status_and_abort_are_wired(self, client, temp_project):
        body = client.post("/api/runner/run",
                           params={"task": "echo status-probe"}).json()
        assert body.get("success") is True
        status = client.get("/api/runner/status").json()
        assert "report" in status and status["report"] is not None
        assert client.post("/api/runner/abort").json()["aborted"] in (True, False)


# ── 双 Agent 编排 ────────────────────────────────────────────────────────

class TestOrchestratorContract:
    def test_init_reports_whether_a_model_is_configured(self, client):
        body = client.post("/api/orchestrator/init",
                           params={"project": str(ROOT)}).json()
        assert body["success"] is True
        assert "model_ready" in body
        if not body["model_ready"]:
            assert body["hint"], "没配模型时必须给出可操作的提示"

    def test_run_without_model_is_honest(self, client):
        """没配模型时**不能**返回成功 —— 那等于假装跑过。"""
        body = client.post("/api/orchestrator/run",
                           json={"task": "加一个 hello 函数"}).json()
        if body.get("status") == "unconfigured":
            assert body["success"] is False
            assert body["hint"]
        else:                      # 配了模型（CI/本机有 key）时才可能真跑
            assert "report" in body or "error" in body

    def test_run_without_task_is_reported(self, client):
        assert "error" in client.post("/api/orchestrator/run", json={}).json()


# ── 任务会话与中止 ───────────────────────────────────────────────────────

class TestAiSessionContract:
    def test_task_session_has_the_expected_shape(self, client):
        body = client.get("/api/ai/task-session").json()
        for key in ("status", "task", "report", "events", "runner"):
            assert key in body, f"缺少字段 {key}"

    def test_abort_is_safe_when_nothing_is_running(self, client):
        body = client.post("/api/ai/abort").json()
        assert body["success"] is True
        assert isinstance(body["aborted"], list)


# ── 会话保存 / 恢复 ──────────────────────────────────────────────────────

class TestSessionContract:
    def test_save_then_restore_roundtrip(self, client, temp_project):
        saved = client.post("/api/session/save", json={
            "id": "unit-test", "active": "main.py",
            "files": ["main.py", "server.py"]}).json()
        assert saved["success"] is True, saved
        restored = client.post("/api/session/restore",
                               params={"id": "unit-test"}).json()
        assert restored["success"] is True
        assert restored["session"]["active"] == "main.py"
        assert restored["session"]["files"] == ["main.py", "server.py"]

    def test_restore_without_any_session_is_reported(self, client, temp_project):
        body = client.post("/api/session/restore").json()
        assert body["success"] is False and "error" in body

    def test_empty_session_is_rejected(self, client, temp_project):
        assert "error" in client.post("/api/session/save", json={}).json()


# ── 批量搜索 / 记忆 / 向量 / 格式化 ──────────────────────────────────────

class TestBatchSearch:
    def test_batch_search_finds_a_known_symbol(self, client):
        body = client.post("/api/search/batch",
                           json={"query": "read_json"}).json()
        if body.get("success"):
            assert body["count"] >= 1, body
        else:
            assert "error" in body

    def test_missing_query_is_reported(self, client):
        assert "error" in client.post("/api/search/batch", json={}).json()


class TestMemoryVectorAliases:
    def test_memory_init_succeeds(self, client):
        body = client.post("/api/memory/init", params={"project": str(ROOT)}).json()
        assert body["success"] is True, body

    def test_vector_init_succeeds(self, client):
        body = client.post("/api/vector/init", params={"project": str(ROOT)}).json()
        assert body["success"] is True, body


class TestFormatContract:
    def test_non_python_is_refused_honestly(self, client):
        body = client.post("/api/files/format",
                           params={"path": "web/electron-shim.js"}).json()
        assert body["success"] is False
        assert "Python" in body["error"]

    def test_python_file_either_formats_or_explains_why_not(self, client, temp_project):
        """装了 black 就真格式化；没装就如实说明 —— 两种都不许假装成功。"""
        import pathlib

        target = pathlib.Path(temp_project) / "ugly.py"
        target.write_text("x=1\ndef  f( a ):\n    return  a\n", encoding="utf-8")
        body = client.post("/api/files/format",
                           params={"path": str(target)}).json()
        if body.get("success"):
            assert body["formatted"] is True
            assert "return a" in target.read_text(encoding="utf-8")
        else:
            assert "black" in body["error"], body

    def test_outside_project_is_refused(self, client):
        assert client.post("/api/files/format",
                           params={"path": "../../x.py"}).json()["success"] is False


# ── 调试：必须**真的**起一个可步进的进程 ────────────────────────────────

class TestDebugContract:
    def test_adapters_reports_real_availability(self, client):
        body = client.get("/api/debug/adapters").json()
        ids = {item["id"] for item in body["adapters"]}
        assert {"pdb", "debugpy", "node-inspect"} <= ids
        assert "pdb" in body["available"], "pdb 是标准库，必须可用"
        for item in body["adapters"]:
            if not item["available"]:
                assert item.get("install"), f"{item['id']} 不可用时必须给出安装方式"

    def test_start_then_step_then_stop(self, client, temp_project):
        """真起一个 pdb 进程，真的单步，然后停掉。"""
        import pathlib

        script = pathlib.Path(temp_project) / "debugme.py"
        script.write_text("def add(a, b):\n    return a + b\n\n\n"
                          "total = add(1, 2)\nprint(total)\n", encoding="utf-8")
        started = client.post("/api/debug/start",
                              json={"adapter": "pdb", "file": str(script)}).json()
        assert started.get("success") is True, started
        session = started["session"]
        assert started["adapter"] == "pdb"

        stepped = client.post("/api/debug/next", params={"session": session}).json()
        assert stepped["success"] is True, stepped
        assert "n" == stepped["command"]
        # pdb 停在断点/首行时会打印 "> /path(x)<module>()"
        assert stepped["output"] or stepped["location"], stepped

        stopped = client.post("/api/debug/stop", params={"session": session}).json()
        assert stopped["stopped"] is True

    def test_step_without_session_is_reported(self, client):
        body = client.post("/api/debug/next", params={"session": "nope"}).json()
        assert "error" in body

    def test_start_on_non_python_is_refused(self, client, temp_project):
        import pathlib

        target = pathlib.Path(temp_project) / "notes.txt"
        target.write_text("hi\n", encoding="utf-8")
        body = client.post("/api/debug/start",
                           json={"file": str(target)}).json()
        assert "error" in body and "Python" in body["error"]


# ── 项目：目录选择与文件监听 ─────────────────────────────────────────────

class TestProjectContract:
    def test_watch_detects_a_new_file(self, client, temp_project):
        import pathlib

        first = client.get("/api/project/watch").json()
        assert first["watching"] is True
        (pathlib.Path(temp_project) / "fresh.txt").write_text("x\n", encoding="utf-8")
        second = client.get("/api/project/watch").json()
        assert "fresh.txt" in second["added"], second
        assert second["changed"] >= 1

    def test_dialog_reports_when_there_is_no_display(self, client):
        """无图形环境下要**如实说明**，不能挂死（这里是离屏/无显示环境）。"""
        body = client.get("/api/project/dialog").json()
        assert "path" in body
        if not body["path"]:
            assert body.get("cancelled") or body.get("error")


# ── 带工具的对话 ─────────────────────────────────────────────────────────

class TestToolChatContract:
    def test_without_messages_is_reported(self, client):
        assert "error" in client.post("/api/ai/chat/tools", json={}).json()

    def test_without_model_is_honest(self, client):
        body = client.post("/api/ai/chat/tools",
                           json={"messages": [{"role": "user", "content": "hi"}]}).json()
        if body.get("status") == "unconfigured":
            assert body["success"] is False and body["hint"]
        else:
            assert "content" in body or "error" in body
