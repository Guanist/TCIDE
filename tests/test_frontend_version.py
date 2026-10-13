# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""前端版本串一致性 + 编辑器主题跟随的回归测试（离线，不需要构建、不需要浏览器）。

两件事各有一组：

1. **版本串**：发布版本写在三个地方（`pyproject.toml` 的包版本、`package.json` 的
   `versionName`、`main.ts` 里两处对外显示）。以前它们不一致：界面显示 `v0.0.1`、
   发布包却是 `0.0.1.2`。`package.json.version` 必须是**合法 semver**（`0.0.1.2` 不合法），
   所以那一项保持 `0.0.1`，真正统一的是 `versionName` 与界面显示 —— 这条测试就是钉这个。

   注意：只检查带 `v` 前缀的串，这样不会误伤 `philosophy` 里那句"从 0.0.1 开始"
   （那是缘起叙述，不是版本显示）。

2. **编辑器主题跟随**：`trae-light` 这套 Monaco 浅色主题本来就有，但皮肤层脚本改
   `<html>` 属性/类时不会经过按钮的 click 处理，于是外壳变白、编辑器留在深色。
   现在靠 MutationObserver 跟随主题状态。这条测试钉住那几个关键结构。
"""

from __future__ import annotations

import json
import pathlib
import re

import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
MAIN_TS = ROOT / "src" / "renderer" / "main.ts"
PKG = ROOT / "package.json"
PYPROJECT = ROOT / "pyproject.toml"

RELEASED = "0.0.1.2"

pytestmark = pytest.mark.skipif(
    not MAIN_TS.is_file(),
    reason="前端源码未恢复（src/renderer 不存在）—— 这项测试只针对源码")


def pyproject_version() -> str:
    text = PYPROJECT.read_text(encoding="utf-8")
    match = re.search(r'^version\s*=\s*"([^"]+)"', text, re.M)
    assert match, "pyproject.toml 里找不到 version"
    return match.group(1)


class TestVersionConsistency:
    def test_pyproject_matches_the_release(self):
        assert pyproject_version() == RELEASED

    def test_package_json_version_name_matches(self):
        data = json.loads(PKG.read_text(encoding="utf-8"))
        assert data.get("versionName") == f"v{RELEASED}", \
            "package.json 的 versionName 与发布版本不一致"

    def test_package_json_version_is_valid_semver(self):
        """npm 的 version 必须是三段 semver —— 四段的 0.0.1.2 会直接被拒。"""
        data = json.loads(PKG.read_text(encoding="utf-8"))
        assert re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?", data["version"]), \
            f"package.json version 不是合法 semver：{data['version']!r}"

    def test_main_ts_displayed_version_matches(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        assert f"version: 'v{RELEASED}'" in text, "info 对象里的版本没统一"
        assert f"欢迎使用虎猫 TCIDE v{RELEASED}" in text, "首启欢迎页里的版本没统一"

    def test_no_stale_v_prefixed_version_anywhere_in_frontend(self):
        """带 v 前缀的旧版本串不该再有残留（裸 0.0.1 的叙述不算）。"""
        text = MAIN_TS.read_text(encoding="utf-8")
        stale = [match.group(0) for match in re.finditer(r"v0\.0\.1(?!\.)", text)]
        assert not stale, f"还有旧版本串：{stale}"

    def test_prose_about_the_origin_is_left_alone(self):
        """别把"从 0.0.1 开始"这种叙述也当成版本号去改。"""
        assert "从 0.0.1 开始" in MAIN_TS.read_text(encoding="utf-8")


class TestEditorFollowsTheme:
    def test_apply_editor_theme_does_not_gate_on_the_editor_instance(self):
        """Monaco 的 setTheme 是**全局**的：编辑器创建前调用同样有效。

        原实现有 `if (editor)` 守卫，导致"启动时先定主题"这条路被堵死 ——
        编辑器创建后仍用默认深色。
        """
        text = MAIN_TS.read_text(encoding="utf-8")
        assert "if (editor) {\n      monaco.editor.setTheme" not in text, \
            "setTheme 又被 editor 实例守卫挡住了"

    def test_both_monaco_themes_are_defined(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        assert "defineTheme('trae-dark'" in text
        assert "defineTheme('trae-light'" in text, "Monaco 浅色主题不见了"

    def test_theme_state_is_watched_not_just_the_button(self):
        """必须跟随 <html> 上的主题状态，而不是只在按钮点击时切换。"""
        text = MAIN_TS.read_text(encoding="utf-8")
        assert "MutationObserver" in text, "没有观察主题状态变化"
        assert "attributeFilter: ['class', 'data-tcide-theme']" in text, \
            "观察的属性不对（皮肤脚本改的是 class 与 data-tcide-theme）"
        assert "themeStateIsLight" in text, "没有统一的「当前是否浅色」判断"

    def test_theme_is_applied_once_at_startup_outside_the_button_guard(self):
        """启动时必须应用一次，且不受"按钮是否存在"影响。"""
        text = MAIN_TS.read_text(encoding="utf-8")
        # 观察者与启动应用都应出现在 themeBtn 那段之后
        button_at = text.find("if (themeBtn) {")
        apply_at = text.find("applyEditorTheme(themeStateIsLight());")
        assert button_at != -1 and apply_at != -1
        assert apply_at > button_at, "启动应用被放在了按钮守卫里面"

    def test_light_theme_uses_the_app_palette(self):
        """浅色编辑器底色应与应用浅色主题一致（暖白），而不是纯白。"""
        text = MAIN_TS.read_text(encoding="utf-8")
        light_start = text.find("defineTheme('trae-light'")
        assert light_start != -1
        block = text[light_start:light_start + 1200]
        assert "'editor.background': '#FDFAF5'" in block, \
            "浅色编辑器底色没有跟随应用调色板（应为 #FDFAF5 暖白）"


class TestCreateTimeThemeUsesTheSameJudge:
    """回归：创建编辑器时的主题判断必须与观察者**共用同一个实现**。

    曾经的 bug：`monaco.editor.create({ theme: localStorage... === 'light' ? ... })`
    只看 localStorage，而皮肤层脚本用 `?theme=light` 时**刻意不写** localStorage。
    结果是编辑器以深色创建 —— 更糟的是，这个显式选项会**覆盖**全局 `setTheme`，
    所以"提前设全局主题"也救不回来（我上一轮就是这么白改的）。
    """

    def test_there_is_a_single_judge_function(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        assert "function isLightThemeActive(): boolean" in text, \
            "缺少统一的「当前是否浅色」判断函数"

    def test_judge_considers_all_three_sources(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        start = text.find("function isLightThemeActive")
        block = text[start:start + 700]
        assert "localStorage" in block, "没考虑 localStorage（应用按钮会写它）"
        assert "classList.contains('theme-light')" in block, "没考虑 .theme-light 类"
        assert "data-tcide-theme" in block, \
            "没考虑 data-tcide-theme 属性 —— 皮肤层脚本用的就是它"

    def test_editor_creation_uses_the_shared_judge(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        create_at = text.find("monaco.editor.create(container")
        assert create_at != -1, "找不到编辑器创建处"
        nearby = text[create_at:create_at + 900]
        assert "isLightThemeActive()" in nearby, \
            "创建编辑器时没有用统一判断 —— ?theme=light 下编辑器会是深色"
        assert "localStorage.getItem('tcide-theme') === 'light' ? 'trae-light'" \
            not in nearby, "创建时又只看 localStorage 了（这是原 bug 的写法）"

    def test_observer_reuses_the_shared_judge(self):
        text = MAIN_TS.read_text(encoding="utf-8")
        start = text.find("function themeStateIsLight")
        block = text[start:start + 400]
        assert "isLightThemeActive()" in block, \
            "观察者没有复用统一判断 —— 两处逻辑又会漂移"
