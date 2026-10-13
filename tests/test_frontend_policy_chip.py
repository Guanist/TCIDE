# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""权限档 chip 的前端回归测试（离线，不需要构建/浏览器）。

设计原则 ③：影响信任与判断的状态（这里就是"AI 有多大权限"）应当**常驻可见**，
而不是藏在设置弹窗里。这组测试钉住"它确实常驻、确实可读、确实与后端联动"。

为什么不在测试里跑浏览器：本机没有可自动化的浏览器环境（截图靠 Edge 无头，
但那要人工看图，不适合当断言）。所以这里断言的是**结构事实**：
chip 在页面上、有无障碍名称、JS 真的在调 `/api/policy`、三档的视觉层级存在。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "src" / "renderer" / "index.html"
MAIN_TS = ROOT / "src" / "renderer" / "main.ts"
MAIN_CSS = ROOT / "src" / "renderer" / "styles" / "main.css"

pytestmark = pytest.mark.skipif(
    not INDEX.is_file(),
    reason="前端源码未恢复（src/renderer 不存在）—— 这项测试只针对源码")


def html() -> str:
    return INDEX.read_text(encoding="utf-8")


def js() -> str:
    return MAIN_TS.read_text(encoding="utf-8")


def css() -> str:
    return MAIN_CSS.read_text(encoding="utf-8")


class TestChipIsPresentAndAccessible:
    def test_chip_exists_in_the_html(self):
        assert 'id="btn-permission"' in html(), "权限档 chip 不在页面上"

    def test_chip_is_in_the_ai_panel_header(self):
        """常驻位置：AI 面板头部 —— 与"谁在干活"的信息放在一起。"""
        text = html()
        header_at = text.find('class="ai-header-actions"')
        chip_at = text.find('id="btn-permission"')
        assert header_at != -1 and chip_at != -1
        assert 0 < chip_at - header_at < 400, "chip 没有放在 AI 面板头部"

    def test_chip_has_an_accessible_name(self):
        tag = re.search(r"<button[^>]*id=\"btn-permission\"[^>]*>", html())
        assert tag, "找不到 chip 的标签"
        assert "aria-label" in tag.group(0), "chip 没有可访问名称"

    def test_chip_announces_changes(self):
        """档位变化应当被读屏播报 —— 它影响 AI 能做什么。"""
        tag = re.search(r"<button[^>]*id=\"btn-permission\"[^>]*>", html())
        assert "aria-live" in tag.group(0), "档位变化没有播报给辅助工具"


class TestChipIsWiredToTheBackend:
    def test_reads_the_policy_from_the_api(self):
        assert "/api/policy" in js(), "chip 没有从后端读档位"

    def test_posts_the_change_back(self):
        text = js()
        assert re.search(r"method:\s*'POST'", text), "chip 只读不改"
        assert "level" in text

    def test_knows_all_three_levels(self):
        text = js()
        for level in ("read_only", "ask", "auto"):
            assert level in text, f"chip 不认识档位 {level}"

    def test_no_duplicated_state_in_the_frontend(self):
        """档位不在前端另存一份 —— 否则会出现"显示一套、执行另一套"。"""
        text = js()
        assert "localStorage.setItem('tcide-permission" not in text, \
            "前端把权限档另存了一份，容易与后端不一致"


class TestVisualHierarchyFollowsThePrinciple:
    def test_three_levels_are_visually_distinct(self):
        """原则 ⑤：强调色克制 —— 三档靠**层级**区分，不是靠三种装饰色。"""
        text = css()
        for level in ("read_only", "ask", "auto"):
            assert f'.ai-chip[data-level="{level}"]' in text, \
                f"档位 {level} 没有独立的视觉层级"

    def test_only_the_loosest_level_is_filled(self):
        """只有"自动"用实心 —— 实心=最松的权限，一眼能看出风险。"""
        text = css()
        block = re.search(r'\.ai-chip\[data-level="auto"\]\s*\{([^}]*)\}', text)
        assert block, "找不到 auto 档的样式"
        assert "background: var(--text-accent)" in block.group(1)

    def test_read_only_is_dashed_not_coloured(self):
        """最严的一档用虚线描边（克制），不用红色恐吓。"""
        text = css()
        block = re.search(r'\.ai-chip\[data-level="read_only"\]\s*\{([^}]*)\}', text)
        assert block and "dashed" in block.group(1)
