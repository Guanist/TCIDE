# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""前端无障碍的离线回归测试（不需要构建、不需要浏览器）。

背景（实测）：改造前整个前端 `aria-*` 命中 **0**、`role` **0**、`tabindex` 仅 2 处 ——
纯键盘与辅助工具基本"看不见"这个界面。这一组测试把改造结果钉住，用的是标准库
`html.parser` 真解析，而不是正则猜（正则会漏掉嵌套标签里的文字）。

判定规则取"是否有可访问名称"这一条最要紧的：

  **每个 `<button>` 必须有 `aria-label`，或者有非空的可见文字。**

有可见文字的按钮（如"打开项目""终端"）本来就是合格的 —— 不需要也不该硬塞
`aria-label`（硬塞反而可能与可见文字不一致，那比没有更糟）。
"""

from __future__ import annotations

import re
from html.parser import HTMLParser
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "src" / "renderer" / "index.html"
MAIN_CSS = ROOT / "src" / "renderer" / "styles" / "main.css"

pytestmark = pytest.mark.skipif(
    not HTML.is_file(),
    reason="前端源码未恢复（src/renderer 不存在）—— 这项测试只针对源码")

#: 图标字体/装饰性元素，其文本不算"可见文字"
IGNORED_TEXT_TAGS = {"svg", "path", "script", "style"}


class ButtonCollector(HTMLParser):
    """收集每个 <button> 的属性与其中的可见文字（忽略 svg 等）。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.buttons: list[dict] = []
        self._stack: list[dict] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag in IGNORED_TEXT_TAGS:
            self._ignored_depth += 1
        if tag == "button":
            record = {"attrs": dict(attrs), "text": []}
            self.buttons.append(record)
            self._stack.append(record)

    def handle_endtag(self, tag: str) -> None:
        if tag in IGNORED_TEXT_TAGS and self._ignored_depth > 0:
            self._ignored_depth -= 1
        if tag == "button" and self._stack:
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        if self._stack and not self._ignored_depth:
            self._stack[-1]["text"].append(data)


def collect() -> list[dict]:
    parser = ButtonCollector()
    parser.feed(HTML.read_text(encoding="utf-8"))
    for record in parser.buttons:
        record["visible"] = re.sub(r"\s+", " ", "".join(record["text"])).strip()
    return parser.buttons


class TestEveryButtonHasAnAccessibleName:
    def test_buttons_have_label_or_visible_text(self):
        unnamed = [record for record in collect()
                   if not record["attrs"].get("aria-label") and not record["visible"]]
        assert not unnamed, (
            "以下按钮既没有 aria-label 也没有可见文字，辅助工具读不出它是什么："
            + "; ".join(record["attrs"].get("id", "?") for record in unnamed))

    def test_no_empty_labels(self):
        """空的 aria-label 比没有更糟：它会把可见文字也屏蔽掉。"""
        empty = [record["attrs"].get("id", "?") for record in collect()
                 if record["attrs"].get("aria-label", None) == ""]
        assert not empty, f"存在空的 aria-label：{empty}"

    def test_labels_strip_shortcut_hints(self):
        """名称里不该念出快捷键 —— 那是 title 的活，不是可访问名称的活。"""
        noisy = [record["attrs"]["aria-label"] for record in collect()
                 if re.search(r"Ctrl\+|Shift\+|Alt\+", record["attrs"].get("aria-label", ""))]
        assert not noisy, f"这些可访问名称里还带着快捷键提示：{noisy}"

    def test_icon_only_buttons_are_labelled(self):
        """纯图标按钮（无可见文字）必须显式给名称 —— 抽查那几个。"""
        by_id = {record["attrs"].get("id"): record for record in collect()}
        for ident, expected in (("btn-clear-search", "清除搜索"),):
            record = by_id.get(ident)
            if record is None:
                continue
            assert record["attrs"].get("aria-label") == expected, \
                f"{ident} 缺少 aria-label={expected!r}"


class TestActivityBar:
    def test_every_activity_button_is_labelled(self):
        records = [record for record in collect()
                   if "activity-btn" in record["attrs"].get("class", "")]
        assert records, "找不到活动栏按钮（选择器可能变了）"
        missing = [record["attrs"].get("id") or record["attrs"].get("data-view")
                   for record in records if not record["attrs"].get("aria-label")]
        assert not missing, f"活动栏按钮缺可访问名称：{missing}"

    def test_current_view_is_marked(self):
        records = [record for record in collect()
                   if "activity-btn" in record["attrs"].get("class", "")]
        assert any(record["attrs"].get("aria-current") == "true" for record in records), \
            "没有任何活动栏按钮标记 aria-current —— 屏幕阅读器不知道当前在哪一栏"


class TestTabs:
    def _tabs(self, kind: str) -> list[dict]:
        return [record for record in collect()
                if kind in record["attrs"].get("class", "")]

    @pytest.mark.parametrize("kind", ["panel-tab", "ai-tab"])
    def test_tabs_have_role_and_selected_state(self, kind):
        records = self._tabs(kind)
        assert records, f"找不到 {kind} 页签"
        for record in records:
            assert record["attrs"].get("role") == "tab", \
                f"{kind} 缺少 role=tab：{record['visible']}"
            assert record["attrs"].get("aria-selected") in {"true", "false"}, \
                f"{kind} 缺少 aria-selected：{record['visible']}"

    def test_exactly_one_tab_is_selected_per_group(self):
        for kind in ("panel-tab", "ai-tab"):
            selected = [record for record in self._tabs(kind)
                        if record["attrs"].get("aria-selected") == "true"]
            assert len(selected) == 1, \
                f"{kind} 里 aria-selected=true 的有 {len(selected)} 个（应当恰好 1 个）"

    def test_a_tablist_container_exists(self):
        text = HTML.read_text(encoding="utf-8")
        assert 'role="tablist"' in text, "页签容器缺少 role=tablist"


class TestKeyboardFocusIsVisible:
    def test_focus_visible_rule_exists(self):
        css = MAIN_CSS.read_text(encoding="utf-8")
        assert ":focus-visible" in css, \
            "源码 CSS 里没有 :focus-visible —— 键盘用户看不出焦点在哪"

    def test_focus_rule_draws_an_outline(self):
        css = MAIN_CSS.read_text(encoding="utf-8")
        # 取第一条 :focus-visible 规则体
        match = re.search(r":focus-visible[^{]*\{([^}]*)\}", css)
        assert match, ":focus-visible 规则体解析失败"
        body = match.group(1)
        assert "outline" in body, ":focus-visible 没有画 outline，焦点仍然看不见"
        assert re.search(r"outline:\s*\d+px", body), "outline 没有明确宽度"

    def test_focus_ring_uses_a_theme_variable(self):
        """焦点环应当跟主题走，而不是写死颜色（否则浅色主题下会看不清）。"""
        css = MAIN_CSS.read_text(encoding="utf-8")
        match = re.search(r":focus-visible[^{]*\{([^}]*)\}", css)
        assert "var(--" in match.group(1), "焦点环颜色没有用主题变量"
