# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""MCP 接线的测试：外部工具必须**进得了工具表**，也必须**拦得住**。

这一组盯的是"能力在、接线没接"这类问题：

1. 配好 mcp.json 之后，外部工具要真的出现在 ``ToolRegistry`` 里（模型才能看见）；
2. 调用要**走注册表**（于是权限策略、调用记录、错误包装都生效）；
3. **只读档必须拦住外部工具** —— 这是一个真实的安全洞：权限策略按工具名判断，
   而外部工具名是 ``server__tool``，原本会被当成"只读类工具"直接放行。
"""

from __future__ import annotations

import json
import pathlib
import sys
import textwrap

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from api import mcp  # noqa: E402
from tcide_core.permissions import PermissionPolicy  # noqa: E402
from tcide_core.tools import ToolRegistry  # noqa: E402
from tcide_core.workspace import Workspace  # noqa: E402

#: 极简 MCP 服务器（一行一个 JSON，与规范一致）
SERVER = textwrap.dedent('''
    import json, sys
    TOOLS = [{"name": "echo", "description": "回显",
              "inputSchema": {"type": "object",
                              "properties": {"text": {"type": "string"}}}}]
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        mid, method = msg.get("id"), msg.get("method")
        if method == "initialize":
            result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}},
                      "serverInfo": {"name": "fake", "version": "1"}}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            text = (msg.get("params", {}).get("arguments") or {}).get("text", "")
            result = {"content": [{"type": "text", "text": "echo:" + text}]}
        elif mid is not None:
            result = {}
        else:
            continue
        sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": mid,
                                     "result": result}, ensure_ascii=False) + "\\n")
        sys.stdout.flush()
''')


@pytest.fixture
def configured(tmp_path, monkeypatch):
    """写一份 mcp.json（指向上面的假服务器），并把配置目录指到 tmp。"""
    monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
    script = tmp_path / "srv.py"
    script.write_text(SERVER, encoding="utf-8")
    (tmp_path / "mcp.json").write_text(
        json.dumps({"servers": {"fake": {"command": sys.executable,
                                         "args": [str(script)]}}}),
        encoding="utf-8")
    mcp.disconnect_all()
    yield tmp_path
    mcp.disconnect_all()


class TestRegistration:
    def test_external_tools_reach_the_registry(self, configured):
        registry = ToolRegistry(Workspace(configured))
        count = mcp.register_into(registry, project_path=str(configured))
        assert count >= 1
        assert "fake__echo" in registry.names(), "外部工具没有进工具表，模型就看不到它"

    def test_spec_is_marked_dangerous_and_carries_schema(self, configured):
        registry = ToolRegistry(Workspace(configured))
        mcp.register_into(registry, project_path=str(configured))
        spec = registry.tools["fake__echo"]
        assert spec.dangerous is True, "外部工具必须标危险，否则只读档拦不住"
        assert spec.parameters.get("type") == "object"

    def test_call_through_the_registry_works(self, configured):
        registry = ToolRegistry(Workspace(configured))
        mcp.register_into(registry, project_path=str(configured))
        result = registry.call("fake__echo", {"text": "你好"})
        assert result.ok is True, result.error
        assert result.output == "echo:你好"


class TestPolicyGatesExternalTools:
    """真实的安全洞回归。"""

    def test_read_only_denies_external_tools(self, configured):
        registry = ToolRegistry(Workspace(configured))
        mcp.register_into(registry, project_path=str(configured))
        registry.policy = PermissionPolicy("read_only")

        result = registry.call("fake__echo", {"text": "hi"})

        assert result.ok is False, "只读档下外部工具竟然被执行了 —— 安全洞没堵住"
        assert registry.calls[-1].get("denied") is True

    def test_ask_level_marks_it_for_review(self):
        policy = PermissionPolicy("ask")
        assert policy.decide("fs__write_file", dangerous=True).needs_review

    def test_auto_level_allows_it(self):
        assert PermissionPolicy("auto").decide("fs__write_file",
                                               dangerous=True).allowed

    def test_builtin_read_tools_are_unaffected(self):
        """普通只读工具在任何档位都放行 —— 别把安全修复做成一刀切。"""
        policy = PermissionPolicy("read_only")
        for tool in ("read_file", "list_files", "search_code"):
            assert policy.decide(tool).allowed


class TestResilience:
    def test_broken_config_does_not_raise(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        (tmp_path / "mcp.json").write_text("{ 这不是 json", encoding="utf-8")
        registry = ToolRegistry(Workspace(tmp_path))
        assert mcp.register_into(registry, project_path=str(tmp_path)) == 0

    def test_missing_command_is_reported_not_raised(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        (tmp_path / "mcp.json").write_text(json.dumps(
            {"servers": {"ghost": {"command": "no-such-command-xyz"}}}),
            encoding="utf-8")
        registry = ToolRegistry(Workspace(tmp_path))
        assert mcp.register_into(registry, project_path=str(tmp_path)) == 0
        assert "ghost" in mcp.connect_configured()  # 失败信息留着，便于排查

    def test_empty_config_is_fine(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        assert mcp.load_config() == {"servers": {}}
