# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""LSP 的回归测试：**探测必须存解析后的绝对路径**。

为什么这条最要紧：装真 pyright 之后，"可用 1/6" 显示正常，但客户端**永远起不来** ——
`FileNotFoundError: [WinError 2]`。根因是 `detect_servers` 用 `shutil.which()` 判断可用性，
却把**裸名字**（`pyright-langserver`）存进 `status.command`；而 Windows 的 CreateProcess
不会按 PATHEXT 解析 `.CMD`，npm 装出来的服务器恰好都是 `.CMD` shim。

这个 bug 只在**接了真服务器**时才暴露（假服务器是个 .py 脚本，裸名字能跑），所以那条
集成路径必须单独验证；而下面这条单元测试可以在**任何机器上离线跑**，只需要注入 which。
"""

from __future__ import annotations

import pytest

from tcide_core.lsp import LspClient, LspStatus, detect_servers


class TestDetectStoresResolvedPath:
    def test_stores_the_path_from_which_not_the_bare_name(self):
        """回归：存 which() 的返回值（绝对路径），不是配置里的裸名字。"""
        resolved = r"C:\Users\x\AppData\Roaming\npm\pyright-langserver.CMD"

        def fake_which(name: str):
            return resolved if name == "pyright-langserver" else None

        status = detect_servers(["python"], which=fake_which)[0]
        assert status.available is True
        assert status.command == resolved, (
            "必须存解析后的绝对路径 —— 存裸名字会让 Windows 上的 .CMD shim 无法启动"
        )

    def test_missing_server_keeps_the_hint(self):
        def nothing(name: str):
            return None

        status = detect_servers(["python"], which=nothing)[0]
        assert status.available is False
        assert status.hint, "没装服务器时要给出安装提示，而不是留空"
        assert status.command, "仍然要显示候选命令名，便于用户照着装"

    def test_language_without_any_known_server_is_reported(self):
        status = detect_servers(["paw"], which=lambda name: None)[0]
        assert status.available is False
        assert status.hint


class TestClientRefusesWithoutServer:
    def test_start_fails_fast_with_a_reason(self):
        """没有可用服务器时，start() 返回 False 并给出原因（不抛异常）。"""
        status = LspStatus(language="python", command="", available=False)
        client = LspClient(status, ".")
        assert client.start() is False
        assert client.error, "失败必须带原因，否则界面只能显示一句没用的'失败'"

    def test_error_mentions_the_language(self):
        status = LspStatus(language="go", command="", available=False)
        client = LspClient(status, ".")
        client.start()
        assert "go" in client.error


@pytest.mark.skipif(
    not __import__("os").environ.get("TCIDE_LSP_TESTS"),
    reason="真语言服务器集成测试：需要本机装了 pyright，设 TCIDE_LSP_TESTS=1 启用"
    "（与 DAP 集成测试同样处理：默认跳过，避免套件里出现依赖外部程序的偶发项）")
class TestRealServer:
    def test_real_server_reports_a_type_error(self, tmp_path):
        from tcide_core.lsp import available_servers

        servers = [s for s in available_servers() if s.language == "python"]
        if not servers:
            pytest.skip("本机没有 python 语言服务器（npm install -g pyright）")

        bad = tmp_path / "bad.py"
        bad.write_text('def greet(name: str) -> str:\n    return 42\n', encoding="utf-8")
        client = LspClient(servers[0], tmp_path)
        try:
            assert client.start() is True, client.error
            client.open_file(str(bad), bad.read_text(encoding="utf-8"), language="python")
            import time

            deadline = time.time() + 60
            issues = []
            while time.time() < deadline and not issues:
                issues = client.issues()
                time.sleep(1.0)
            assert issues, "接了真服务器却拿不到诊断"
            joined = " ".join(str(i.message) for i in issues).lower()
            assert "str" in joined or "assignable" in joined or "type" in joined, joined
        finally:
            client.stop()
