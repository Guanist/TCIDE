# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""前端**源码**层面的主题测试（本机可跑，不需要构建、不需要浏览器）。

为什么测源码而不是产物：本机构建不了（仓库外两层有个损坏的 package.json，esbuild
解析模块类型时会读到它），所以"产物里有没有主题"交给 CI 的干净 runner 去验
（见 .github/workflows/frontend.yml 的「校验主题真的进了产物」）。

这里离线钉住的是**源码该有的样子**：
- `:root` 调色板完好（虎猫橙 + 背景/文字/边框三系）；
- 浅色主题块存在，且**同时响应两种触发**（data 属性 + 应用自带的 `.theme-light` 类）；
- 那批"绕过变量"的写法被收敛（抽查关键值不再裸写）；
- 源码 index.html 挂上了主题切换脚本（构建后自带，不靠构建后注入）。

历史遗留说明：`main.css` 里原本就有一个 900 字符的 `.theme-light` 块（硬编码色值，
应用自带按钮在切它）。它现在被本项目在文件末尾的变量版覆盖（同特异性下后者胜，
且 `html.theme-light` 特异性更高）。测试里显式把它排除在"裸色值"检查之外，
是因为**它是被替代的历史实现**，而不是新引入的问题 —— 这一点写清楚，避免以后
有人以为测试在放水。
"""

from __future__ import annotations

import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN_CSS = ROOT / "src" / "renderer" / "styles" / "main.css"
INDEX_HTML = ROOT / "src" / "renderer" / "index.html"

pytestmark = pytest.mark.skipif(
    not MAIN_CSS.is_file(),
    reason="前端源码未恢复（src/renderer 不存在）—— 这项测试只针对源码")

#: 浅色主题块的两种触发（双触发是刻意的，见 unify_light_theme 的说明）
LIGHT_SELECTOR = re.compile(
    r'html\[data-tcide-theme="light"\]\s*,\s*\n?\s*html\.theme-light\s*\{', re.S)

#: 历史遗留的类名块（硬编码色值）—— 被上面的变量版替代
LEGACY_SELECTOR = re.compile(r"(?<!\nhtml)\.theme-light\s*\{.*?\n\}", re.S)


def css_text() -> str:
    return MAIN_CSS.read_text(encoding="utf-8")


def root_block() -> str:
    match = re.search(r":root\s*\{(.*?)\n\}", css_text(), re.S)
    assert match, ":root 定义块不见了 —— 整份调色板都没了"
    return match.group(1)


def light_block() -> str:
    text = css_text()
    start = LIGHT_SELECTOR.search(text)
    assert start, "找不到浅色主题块（应当同时响应 data 属性与 .theme-light 类）"
    body = text[start.end():]
    return body.split("\n}")[0]


class TestPalette:
    def test_tiger_orange_exists(self):
        assert "--tc-orange:" in root_block()

    def test_background_text_border_families_exist(self):
        block = root_block()
        for name in ("--bg-primary", "--bg-secondary", "--text-primary",
                     "--text-secondary", "--border-subtle"):
            assert f"{name}:" in block, f"{name} 丢了"

    def test_palette_is_actually_used(self):
        """变量光定义不用是没意义的 —— 抽查使用次数。"""
        assert css_text().count("var(--") > 200


class TestLightTheme:
    def test_light_block_responds_to_both_triggers(self):
        """应用自带按钮切的是 .theme-light 类；本项目切的是 data 属性。两者都要管。"""
        assert LIGHT_SELECTOR.search(css_text())

    def test_light_block_overrides_the_same_variables(self):
        """关键设计：变量已存在，浅色主题只换值，不重构选择器。"""
        overrides = set(re.findall(r"(--[a-z0-9-]+)\s*:", light_block()))
        defined = set(re.findall(r"(--[a-z0-9-]+)\s*:", root_block()))
        assert overrides, "浅色主题块里一个变量都没覆盖"
        assert not (overrides - defined), \
            f"覆盖了未定义的变量：{sorted(overrides - defined)}"

    def test_there_is_only_one_light_theme_definition(self):
        """只允许一份亮色主题定义。

        原先 main.css 里还有一个独立的 `.theme-light` **变量块**（另一套白灰配色）
        与本项目这套（白橙，与桌面端一致）并存 —— 两份都定义 `--bg-primary`，于是
        "亮色长什么样"取决于文件顺序与特异性。那份重复实现已删除；这条测试防止它
        被重新引入。

        断言写成**精确计数**而不是块正则：正则太容易被 `var(--bg-primary)` 之类的
        片段干扰（第一版就误判了），而"这个选择器出现几次"没有歧义。
        """
        text = css_text()
        # 按**行**精确判断：`html.theme-light {` 里含有子串 `.theme-light {`，
        # 直接 count 子串会误判（第一版就这么错的）。
        bare_lines = [line.strip() for line in text.splitlines()]
        assert ".theme-light {" not in bare_lines, \
            "又出现了独立的 .theme-light 变量块 —— 那是被删掉的重复定义"
        assert text.count("html.theme-light") == 1, \
            "双触发选择器应当恰好出现一次"

    def test_light_and_dark_differ_on_the_surfaces(self):
        """浅色就该是浅的 —— 别把同一个值既当深色又当浅色。"""
        dark_primary = re.search(r"--bg-primary:\s*(#[0-9a-fA-F]{6})",
                                 root_block()).group(1)
        light_primary = re.search(r"--bg-primary:\s*(#[0-9a-fA-F]{6})",
                                  light_block()).group(1)
        assert dark_primary.lower() != light_primary.lower()


class TestBypassConvergence:
    def test_key_literals_are_not_written_raw_outside_definitions(self):
        """抽查：`#1e1e1e` 与 `--bg-primary` 同值，不该在规则体里裸写。

        排除三个块：`:root`（定义）、我的浅色块（定义）、以及历史遗留的
        `.theme-light`（已被替代的旧实现，见模块文档）。
        """
        stripped = re.sub(r":root\s*\{.*?\n\}", "", css_text(), flags=re.S)
        stripped = LIGHT_SELECTOR.sub("", stripped)
        stripped = re.sub(r"(?<!\nhtml)\.theme-light\s*\{.*?\n\}", "", stripped,
                          flags=re.S)
        assert not re.search(r"#1e1e1e\b", stripped, re.I), \
            "规则体里又出现了裸写的 #1e1e1e —— 换肤会漏掉它"

    def test_definitions_survived_the_rewrite(self):
        """防自我循环：定义块本身不能被替换成 var()。"""
        assert re.search(r"--bg-primary:\s*#[0-9a-fA-F]{6}", root_block())


class TestSourceIndexHooksTheme:
    def test_source_html_links_the_toggle_script(self):
        html = INDEX_HTML.read_text(encoding="utf-8")
        assert "/static/tcide-theme.js" in html, \
            "源码首页没挂切换脚本 —— 构建出来的页面就没有切换入口"

    def test_source_html_does_not_link_the_overlay_skin(self):
        """覆盖层 CSS **不该**写在源码里 —— 这是刻意的，有具体原因。

        源码里的 `<link>` 位于 vite 追加的 bundle 标签**之前**，同特异性下会被压过
        （实测：构建后皮肤排在 bundle 前面，于是失效）。第 6 轮之所以有效，是因为
        它注入的是**产物**。所以分工是：

        - 颜色/主题 → 源码 main.css 的变量（随构建进产物）；
        - JS 切换器 → 源码（无级联问题）；
        - CSS 覆盖层 → 构建后注入产物，落在 bundle 之后。

        "覆盖层确实排在 bundle 之后"由 tests/test_web_theme.py 在**服务端**验证。
        """
        html = INDEX_HTML.read_text(encoding="utf-8")
        assert "/static/tcide-theme.css" not in html, \
            "覆盖层被写回源码了 —— 它会排在 bundle 前面而被覆盖"

    def test_only_one_head_close_tag(self):
        """注入靠这个假设 —— 多了就说明源码被改坏了。"""
        assert INDEX_HTML.read_text(encoding="utf-8").count("</head>") == 1


class TestToggleScriptKeepsBothMechanismsInSync:
    def test_script_toggles_the_legacy_class_too(self):
        """两套触发必须由同一个开关驱动，否则按钮之间会互相打架。"""
        js = (ROOT / "static" / "tcide-theme.js").read_text(encoding="utf-8")
        assert "classList" in js and "theme-light" in js

    def test_script_respects_an_already_set_class_on_boot(self):
        js = (ROOT / "static" / "tcide-theme.js").read_text(encoding="utf-8")
        assert "contains(\"theme-light\")" in js
