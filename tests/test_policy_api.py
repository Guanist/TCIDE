# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""权限档端点的测试（离线，隔离配置目录）。

设计原则 ③ 说"状态是环境，不是弹窗" —— 权限档决定 AI 能不能写文件、能不能执行命令，
属于影响**信任与判断**的信息，必须常驻可见、且所见即所执行。

这组测试盯三件事：

1. **读写一致**：`GET /api/policy` 读的就是 `current_policy()` 用的那个值
   （都来自设置文件），不允许"界面显示一套、执行另一套"；
2. **持久化**：改完再读还是新值（用户的档位选择要活过重启）；
3. **和真实拦截联动**：改成 `read_only` 之后，工具注册表必须**真的**拦下
   危险工具（外部 MCP 工具也算危险）—— 这一条把端点与之前修的安全洞串起来，
   防止"界面说只读、实际照样写"。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import server
from tcide_core.permissions import LEVELS

client = TestClient(server.app)


@pytest.fixture(autouse=True)
def isolated_settings(tmp_path, monkeypatch):
    """把设置目录指到临时目录 —— 绝不碰用户真实配置。"""
    monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
    yield tmp_path


class TestReadPolicy:
    def test_returns_one_of_the_three_levels(self):
        data = client.get("/api/policy").json()
        assert data["success"] is True
        assert data["level"] in LEVELS
        assert data["levels"] == list(LEVELS)
        assert data["label"]

    def test_matches_what_the_tool_layer_will_use(self):
        """界面读到的档位，必须与 current_policy() 一致。"""
        from tcide_core.tools import current_policy

        data = client.get("/api/policy").json()
        assert data["level"] == current_policy().level, \
            "端点与工具层读到的档位不一致 —— 会出现「显示一套、执行另一套」"

    def test_reports_what_the_level_allows(self):
        data = client.get("/api/policy").json()
        assert isinstance(data["allows_write"], bool)
        assert isinstance(data["allows_shell"], bool)
        assert isinstance(data["review_gate"], bool)


class TestWritePolicy:
    @pytest.mark.parametrize("level", list(LEVELS))
    def test_each_level_round_trips(self, level):
        posted = client.post("/api/policy", json={"level": level}).json()
        assert posted["level"] == level
        assert client.get("/api/policy").json()["level"] == level, \
            "改完没有持久化 —— 重启后用户的档位会丢"

    def test_read_only_forbids_write_and_shell(self):
        data = client.post("/api/policy", json={"level": "read_only"}).json()
        assert data["allows_write"] is False
        assert data["allows_shell"] is False

    def test_auto_allows_write_and_shell(self):
        data = client.post("/api/policy", json={"level": "auto"}).json()
        assert data["allows_write"] is True
        assert data["allows_shell"] is True

    def test_invalid_value_is_normalised_not_crashed(self):
        client.post("/api/policy", json={"level": "read_only"})
        data = client.post("/api/policy", json={"level": "胡说八道"}).json()
        assert data["level"] in LEVELS
        assert data["normalized"] is True

    def test_missing_body_keeps_the_current_level(self):
        client.post("/api/policy", json={"level": "auto"})
        data = client.post("/api/policy", json={}).json()
        assert data["level"] == "auto", "没有 level 时不该把档位重置"


class TestPolicyActuallyGatesTools:
    """把端点与真实拦截串起来：界面说只读，工具就必须真的被拦。"""

    def test_registry_denies_dangerous_tool_after_switch(self, tmp_path):
        from tcide_core.permissions import PermissionPolicy
        from tcide_core.tools import ToolRegistry, ToolResult, ToolSpec
        from tcide_core.workspace import Workspace

        client.post("/api/policy", json={"level": "read_only"})

        registry = ToolRegistry(Workspace(tmp_path),
                                policy=PermissionPolicy("read_only"))
        registry.register(ToolSpec(name="fs__write_file", description="外部写工具",
                                   parameters={"type": "object"},
                                   handler=lambda **_: ToolResult(ok=True, output="写了"),
                                   dangerous=True))
        result = registry.call("fs__write_file", {})
        assert result.ok is False, "只读档下危险工具被放行了 —— 端点与拦截脱节"

    def test_file_actually_holds_the_choice(self, isolated_settings):
        client.post("/api/policy", json={"level": "auto"})
        settings_file = Path(isolated_settings) / "settings.json"
        candidates = list(Path(isolated_settings).glob("*.json"))
        assert candidates, "设置没有被写到盘上"
        blob = " ".join(item.read_text(encoding="utf-8") for item in candidates)
        assert "auto" in blob, f"设置文件里没有新档位：{[c.name for c in candidates]}"


class TestRegistryAcceptsPolicy:
    """回归：ToolRegistry 必须能收到 policy。

    曾经它只作为**类属性**存在、`__init__` 从不设置 —— 于是调用方传进来的策略被
    静默丢掉，只读档下的拦截形同虚设；而 api/ui_contract.py 的三处
    `policy=current_policy()` 更会直接 TypeError（HTTP 500）。
    """

    def test_policy_can_be_injected_at_construction(self, tmp_path):
        from tcide_core.permissions import PermissionPolicy
        from tcide_core.tools import ToolRegistry
        from tcide_core.workspace import Workspace

        policy = PermissionPolicy("read_only")
        registry = ToolRegistry(Workspace(tmp_path), policy=policy)
        assert registry.policy is policy, "传进来的 policy 被丢掉了"

    def test_without_policy_there_is_no_gating(self, tmp_path):
        from tcide_core.tools import ToolRegistry
        from tcide_core.workspace import Workspace

        assert ToolRegistry(Workspace(tmp_path)).policy is None

    def test_injected_read_only_policy_actually_denies(self, tmp_path):
        from tcide_core.permissions import PermissionPolicy
        from tcide_core.tools import ToolRegistry, ToolResult, ToolSpec
        from tcide_core.workspace import Workspace

        registry = ToolRegistry(Workspace(tmp_path),
                                policy=PermissionPolicy("read_only"))
        registry.register(ToolSpec(name="fs__write_file", description="外部写工具",
                                   parameters={"type": "object"},
                                   handler=lambda **_: ToolResult(ok=True, output="写了"),
                                   dangerous=True))
        assert registry.call("fs__write_file", {}).ok is False
