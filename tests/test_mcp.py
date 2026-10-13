# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""MCP 客户端的离线测试。

要点：这里**不依赖任何 npm 包**。测试自己写一个说 stdio JSON-RPC 的假服务器
（**一行一个 JSON**，与 MCP 约定一致），因此可以在任何机器/CI 上离线跑。

最要紧的回归是**帧协议**：原实现按 LSP 的 ``Content-Length`` 收发，而 MCP stdio 是
按行分隔 —— 那个错误让客户端"看起来写好了、实际一次也用不了"。下面
``test_newline_framing_...`` 就是钉住这一条的。
"""

from __future__ import annotations

import json
import pathlib
import sys
import textwrap

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from api import mcp  # noqa: E402

#: 一个最小但**合规**的 MCP 服务器：按行读 JSON-RPC，按行回 JSON。
FAKE_SERVER = textwrap.dedent('''
    import json, sys

    TOOLS = [
        {"name": "echo", "description": "回显给定文本",
         "inputSchema": {"type": "object",
                         "properties": {"text": {"type": "string"}},
                         "required": ["text"]}},
        {"name": "boom", "description": "总是报错",
         "inputSchema": {"type": "object", "properties": {}}},
    ]

    def reply(message_id, result):
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message_id,
                                     "result": result}, ensure_ascii=False) + "\\n")
        sys.stdout.flush()

    def main():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                message = json.loads(line)
            except json.JSONDecodeError:
                continue
            method = message.get("method")
            message_id = message.get("id")
            if method == "initialize":
                reply(message_id, {"protocolVersion": "2024-11-05",
                                   "capabilities": {"tools": {}},
                                   "serverInfo": {"name": "fake", "version": "1"}})
            elif method == "tools/list":
                reply(message_id, {"tools": TOOLS})
            elif method == "tools/call":
                params = message.get("params") or {}
                if params.get("name") == "boom":
                    reply(message_id, {"content": [{"type": "text", "text": "炸了"}],
                                       "isError": True})
                else:
                    text = (params.get("arguments") or {}).get("text", "")
                    reply(message_id, {"content": [{"type": "text",
                                                    "text": f"echo:{text}"}]})
            elif message_id is not None:
                reply(message_id, {})
        # 另外故意往 stdout 打一行非 JSON，验证客户端不会被它带崩
    main()
''')


@pytest.fixture
def fake_server(tmp_path):
    """把假服务器写成文件，返回 (命令, 目录)。"""
    script = tmp_path / "fake_mcp_server.py"
    script.write_text(FAKE_SERVER, encoding="utf-8")
    mcp.set_project_root(str(tmp_path))
    yield sys.executable, str(script), tmp_path
    mcp.disconnect_all()


class TestFraming:
    def test_newline_framing_connects_and_lists_tools(self, fake_server):
        """回归：MCP stdio 是**按行**分隔的 JSON，不是 Content-Length 帧。"""
        python, script, _ = fake_server
        result = mcp.connect_server("fake", python, [script])
        assert result.get("success") is True, result
        assert result["tools"] == 2

    def test_tools_are_prefixed_and_marked(self, fake_server):
        python, script, _ = fake_server
        mcp.connect_server("fake", python, [script])
        listing = mcp.list_tools()
        external = [t for t in listing["tools"] if t.get("_source") == "mcp"]
        assert {t["name"] for t in external} == {"fake__echo", "fake__boom"}
        # inputSchema 要映射成 parameters，否则没法注册进工具表给模型用
        assert external[0]["parameters"]["type"] == "object"
        assert listing["builtin"] == len(mcp.BUILTIN_TOOLS)


class TestCallTool:
    def test_calls_the_remote_tool_and_returns_text(self, fake_server):
        python, script, _ = fake_server
        mcp.connect_server("fake", python, [script])
        called = mcp.call_tool("fake__echo", {"text": "你好"})
        assert called.get("result") == "echo:你好"

    def test_is_error_is_surfaced_not_swallowed(self, fake_server):
        python, script, _ = fake_server
        mcp.connect_server("fake", python, [script])
        called = mcp.call_tool("fake__boom", {})
        assert called.get("error"), "服务器报 isError 时必须体现在返回值里"

    def test_unknown_server_is_reported(self):
        assert "not connected" in mcp.call_tool("nope__echo", {}).get("error", "")

    def test_unknown_tool_is_reported(self):
        assert "Unknown tool" in mcp.call_tool("not_a_tool").get("error", "")

    def test_builtin_tools_still_work(self, tmp_path):
        mcp.set_project_root(str(tmp_path))
        (tmp_path / "a.txt").write_text("内容", encoding="utf-8")
        assert mcp.call_tool("read_file", {"path": "a.txt"})["result"] == "内容"
        listed = mcp.call_tool("list_files", {"path": "."})["result"]
        assert "a.txt" in listed


class TestErrors:
    def test_missing_command_gives_actionable_error(self):
        result = mcp.connect_server("ghost", "definitely-not-a-real-command-xyz")
        assert "error" in result
        assert "definitely-not-a-real-command-xyz" in result["error"]

    def test_disconnect_unknown_server(self):
        assert "not found" in mcp.disconnect_server("no-such").get("error", "")

    def test_servers_report_running_state(self, fake_server):
        python, script, _ = fake_server
        mcp.connect_server("fake", python, [script])
        servers = mcp.get_servers()["servers"]
        assert servers[0]["running"] is True and servers[0]["ready"] is True


class TestResolveCommand:
    def test_bare_name_is_resolved_to_an_absolute_path(self):
        """回归：Windows 上 npm 装的是 .CMD shim，传裸名字 Popen 会 WinError 2。"""
        resolved = mcp.resolve_command("python")
        assert resolved and (pathlib.Path(resolved).is_absolute() or
                             pathlib.Path(resolved).exists())

    def test_absolute_path_is_kept(self):
        given = str(pathlib.Path(sys.executable))
        assert mcp.resolve_command(given) == given

    def test_unknown_name_is_returned_as_is(self):
        assert mcp.resolve_command("no-such-thing-xyz") == "no-such-thing-xyz"


class TestSearchCode:
    def test_search_is_pure_python_and_cross_platform(self, tmp_path):
        """回归：原实现调 Windows 专有的 findstr，在 Linux/macOS 与 CI 上必坏。"""
        (tmp_path / "a.py").write_text("def target():\n    pass\n", encoding="utf-8")
        (tmp_path / "sub").mkdir()
        (tmp_path / "sub" / "b.py").write_text("# target 也在这\n", encoding="utf-8")
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "c.py").write_text("target\n", encoding="utf-8")

        mcp.set_project_root(str(tmp_path))
        found = mcp.call_tool("search_code", {"query": "target"})["result"]
        assert "a.py" in found and "b.py" in found
        assert "node_modules" not in found, "噪音目录要被跳过"
        assert ":" in found, "输出要带行号，便于跳转"
