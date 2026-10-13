# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""Web 端皮肤层的接线测试。

**能力边界要说清**：本仓库没有前端源码（`web/` 是 Vite 构建产物，没有
`package.json` / `vite.config.ts` / `node_modules`），所以**重建不了前端**，
也**跑不了浏览器**。因此这里断言的是"可验证的事实"：

1. 皮肤与主题脚本**真的被服务**（HTTP 200）；
2. 首页**真的引用**了它们；
3. 皮肤在 bundle CSS **之后** —— 这是它能生效的功能性前提（同等特异性下后者胜）；
4. 皮肤里两套主题的令牌都在（深色黑橙 / 浅色白橙）。

至于"看起来怎么样" ✗ —— 那需要真浏览器，本机做不到，不写成"已验证"。
"""

from __future__ import annotations

import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

import server  # noqa: E402


@pytest.fixture(scope="module")
def client():
    return TestClient(server.app)


class TestSkinIsServed:
    def test_stylesheet_is_served(self, client):
        response = client.get("/static/tcide-theme.css")
        assert response.status_code == 200
        assert "--tc-accent" in response.text

    def test_script_is_served(self, client):
        response = client.get("/static/tcide-theme.js")
        assert response.status_code == 200
        assert "tcideTheme" in response.text

    def test_homepage_references_both(self, client):
        body = client.get("/").text
        assert "/static/tcide-theme.css" in body, "皮肤没被挂进首页，等于没做"
        assert "/static/tcide-theme.js" in body


class TestCascadeOrder:
    def test_skin_comes_after_the_built_bundle_css(self, client):
        """功能性前提：皮肤必须在 bundle CSS 之后，否则压不过压缩产物里的样式。"""
        body = client.get("/").text
        bundle = body.find("index-")
        skin = body.find("/static/tcide-theme.css")
        assert bundle != -1 and skin != -1
        assert bundle < skin, "皮肤排在了 bundle 前面 —— 样式会被压缩产物盖掉"

    def test_skin_is_linked_not_inlined(self, client):
        """外链而不是内联：前端是构建产物，内联进 HTML 会在下次构建时被冲掉。"""
        body = client.get("/").text
        assert '<link rel="stylesheet" href="/static/tcide-theme.css" />' in body


class TestThemeTokens:
    def test_dark_and_light_palettes_both_present(self, client):
        css = client.get("/static/tcide-theme.css").text
        assert 'html[data-tcide-theme="dark"]' in css
        assert 'html[data-tcide-theme="light"]' in css

    def test_tiger_accent_is_shared_by_both_themes(self, client):
        """同一支橙是这只虎猫的标识色 —— 两套主题都不该换掉它。"""
        css = client.get("/static/tcide-theme.css").text
        assert css.count("--tc-accent: #e8802a") >= 2

    def test_focus_ring_and_selected_bar_exist(self, client):
        """两个"最能去旧感"的细节：聚焦环、选中项左侧橙条。"""
        css = client.get("/static/tcide-theme.css").text
        assert "box-shadow: 0 0 0 3px var(--tc-accent-soft)" in css
        assert "border-left: 3px solid var(--tc-accent)" in css

    def test_respects_reduced_motion(self, client):
        css = client.get("/static/tcide-theme.css").text
        assert "prefers-reduced-motion" in css, "别为了好看让人晕"


class TestThemeScriptBehaviour:
    def test_script_reads_system_preference_and_persists(self, client):
        js = client.get("/static/tcide-theme.js").text
        assert "prefers-color-scheme" in js, "没跟随系统偏好"
        assert "localStorage" in js, "选择没被记住，每次刷新都要重选"
        assert "data-tcide-theme" in js, "没有把主题写到 <html> 上，CSS 变量不会切"

    def test_script_mounts_a_toggle_button(self, client):
        js = client.get("/static/tcide-theme.js").text
        assert "tcide-theme-toggle" in js, "用户没有手动切换入口，只能被系统偏好锁死"

    def test_localstorage_failure_is_tolerated(self, client):
        """隐私模式下 localStorage 会抛异常 —— 不能让主题功能把整个页面带崩。"""
        js = client.get("/static/tcide-theme.js").text
        assert "catch" in js
