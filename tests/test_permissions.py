# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""权限三档在**本仓库**的接线验证（从 tcide-pawui 移植并适配）。

上一轮我把 ``permissions.py`` 移植了过来，但本仓库的 ``tools.py`` 还没有钩子，
所以那份测试在这是红的（已移除）。**这一轮把钩子接上了**，测试因此回来 ——
而且它验证的是同一件要紧事：**只读档下写文件必须真的没写出来**（不是文案）。
"""

from __future__ import annotations

import pytest

from tcide_core.permissions import (GATED_TOOLS, LABELS, LEVELS, PermissionPolicy,
                                    normalize_level)
from tcide_core.settings import Settings, load, normalize, save
from tcide_core.tools import ToolRegistry, current_policy
from tcide_core.workspace import Workspace


class TestPolicyBasics:
    def test_three_levels_rising_autonomy(self):
        assert LEVELS == ("read_only", "ask", "auto")

    def test_labels_exist(self):
        for level in LEVELS:
            assert LABELS[level]

    def test_unknown_level_falls_back_to_ask(self):
        """保守方向：认不出就"多问一次"，不是"直接放行"。"""
        assert normalize_level("乱写") == "ask"

    def test_denial_reason_is_actionable(self):
        reason = PermissionPolicy("read_only").decide("write_file").reason
        assert LABELS["ask"] in reason and LABELS["auto"] in reason


class TestRegistryEnforcement:
    """决定性验证：拦截必须是真的。"""

    def test_read_only_write_is_blocked_and_file_absent(self, tmp_path):
        workspace = Workspace(tmp_path)
        registry = ToolRegistry(workspace)
        registry.policy = PermissionPolicy("read_only")

        result = registry.call("write_file", {"path": "a.txt", "content": "x"})

        assert result.ok is False, "只读档下写文件竟然成功了"
        assert not (tmp_path / "a.txt").exists(), "文件被写出来了 —— 拦截是假的"
        assert registry.calls[-1].get("denied") is True, "调用记录里应标记为被拒"

    def test_read_only_blocks_shell_too(self, tmp_path):
        registry = ToolRegistry(Workspace(tmp_path))
        registry.policy = PermissionPolicy("read_only")
        assert registry.call("run_command", {"command": "echo hi"}).ok is False

    def test_read_only_still_allows_reading(self, tmp_path):
        workspace = Workspace(tmp_path)
        (tmp_path / "r.txt").write_text("hello", encoding="utf-8")
        registry = ToolRegistry(workspace)
        registry.policy = PermissionPolicy("read_only")
        assert registry.call("read_file", {"path": "r.txt"}).ok is True

    def test_ask_level_does_not_block_the_registry(self, tmp_path):
        """逐次确认档：注册表**不**拦（由审核队列负责），文件确实会写。"""
        workspace = Workspace(tmp_path)
        registry = ToolRegistry(workspace)
        registry.policy = PermissionPolicy("ask")
        assert registry.call("write_file", {"path": "b.txt", "content": "y"}).ok
        assert (tmp_path / "b.txt").read_text(encoding="utf-8") == "y"

    def test_no_policy_means_no_enforcement(self, tmp_path):
        registry = ToolRegistry(Workspace(tmp_path))
        registry.policy = None
        assert registry.call("write_file", {"path": "c.txt", "content": "z"}).ok


class TestCurrentPolicy:
    """``current_policy()`` 读设置 —— 这是"档位一改，下次请求就生效"的关键。"""

    def test_defaults_to_ask_when_unset(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        assert current_policy().level == "ask"

    def test_follows_the_settings_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        save(Settings(permission="read_only"))
        assert current_policy().level == "read_only"

    def test_broken_settings_falls_back_to_ask_not_auto(self, tmp_path, monkeypatch):
        """设置文件坏掉时必须退回 ask（保守），绝不能默默变成 auto（放行）。"""
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        (tmp_path / "settings.json").write_text("{ 坏掉的 json", encoding="utf-8")
        assert current_policy().level == "ask"


class TestSettingsIntegration:
    def test_permission_round_trips(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))
        save(Settings(permission="auto"))
        assert load().permission == "auto"

    def test_old_review_gate_false_migrates_to_auto(self):
        assert normalize(Settings(permission="", review_gate=False)).permission == "auto"
