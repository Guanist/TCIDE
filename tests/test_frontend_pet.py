# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""矢量宠物的回归测试（离线，不需要构建 / 浏览器 / 网络）。

背景（实测发现的真问题）：原实现有两套宠物 —— Electron 的**独立透明窗口**
（`pet-window.html`，canvas 像素画）与一段注入首页的 `.tcide-pet` **样式**。
结果是 **Web / PyWebView 版里根本没有宠物**：样式在，没有任何代码创建那个元素。

所以这组测试盯的是"宠物确实接回来了、且状态能切"：
- `svg-pet.ts` 存在、会用 `/icons/pet/` 下的矢量图、并把它**内联**（外链 `<img>`
  里外部 CSS 影响不到内部元素，状态就切不了）；
- 应用现有的十个状态**全部**有映射；
- 状态变化**单点收口**（`pet.ts` 里不再有绕过出口的直接 IPC 调用）；
- `main.ts` 真的挂载了它；
- SVG 本身具备四个状态类与 `prefers-reduced-motion`。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "renderer"
PET_TS = SRC / "svg-pet.ts"
BRIDGE = SRC / "pet.ts"
MAIN_TS = SRC / "main.ts"
SVG = ROOT / "web" / "icons" / "pet" / "tcide-pet.svg"

APP_STATES = ("idle", "thinking", "tool", "run", "review",
              "success", "jump", "wave", "error", "failed")

pytestmark = pytest.mark.skipif(
    not PET_TS.is_file(),
    reason="前端源码未恢复（src/renderer 不存在）—— 这项测试只针对源码")


class TestPetIsWiredBackIn:
    def test_module_exists_and_is_inlined_not_linked(self):
        text = PET_TS.read_text(encoding="utf-8")
        assert "/icons/pet/tcide-pet.svg" in text, "没有用仓库里的矢量宠物"
        assert "innerHTML" in text, \
            "必须内联 SVG：外链 <img> 会让它成为独立文档，外部类名改不到内部元素"

    def test_mounted_from_main(self):
        assert "initSvgPet()" in MAIN_TS.read_text(encoding="utf-8"), \
            "main.ts 没有挂载矢量宠物 —— 又会变成「只有样式没有 DOM」"

    def test_creates_the_element_the_css_expects(self):
        """注入样式里的类名是既成事实，元素要跟它对齐，否则样式白搭。"""
        text = PET_TS.read_text(encoding="utf-8")
        for cls in ("tcide-pet", "pet-label", "pet-speech", "pet-canvas"):
            assert cls in text, f"没创建 .{cls} —— 注入的样式会失效"

    def test_goes_into_the_status_bar(self):
        assert "status-bar" in PET_TS.read_text(encoding="utf-8")

    def test_missing_svg_degrades_quietly(self):
        """取不到图就不显示宠物，但不能把状态栏或主流程弄坏。"""
        text = PET_TS.read_text(encoding="utf-8")
        assert "catch" in text and "remove()" in text

    def test_pixelated_rendering_is_not_used_for_the_vector_pet(self):
        """矢量图不该用像素化渲染（注入样式里带着 image-rendering:pixelated）。"""
        text = PET_TS.read_text(encoding="utf-8")
        assert "imageRendering" in text or "image-rendering" in text, \
            "没有覆盖注入样式里的 pixelated 渲染"


class TestStateMapping:
    def test_every_app_state_has_a_mapping(self):
        text = PET_TS.read_text(encoding="utf-8")
        missing = [state for state in APP_STATES if f"{state}:" not in text]
        assert not missing, f"这些状态没有映射，宠物会一直待机：{missing}"

    def test_unknown_state_falls_back_to_idle(self):
        text = PET_TS.read_text(encoding="utf-8")
        assert re.search(r"STATE_MAP\[state\]\s*\?\?\s*'idle'", text), \
            "未知状态应当安静退化为待机，而不是抛错或空白"

    def test_only_known_visual_states_are_produced(self):
        text = PET_TS.read_text(encoding="utf-8")
        visuals = set(re.findall(r":\s*'(idle|work|sleep|error)'", text))
        assert visuals <= {"idle", "work", "sleep", "error"}
        assert len(visuals) >= 3, "视觉状态太少，宠物看起来不会变化"

    def test_accessible_name_is_updated_with_state(self):
        text = PET_TS.read_text(encoding="utf-8")
        assert "aria-label" in text, "状态变化没有同步可访问名称"

    def test_state_change_is_single_sourced(self):
        """`pet.ts` 里所有状态变化都要走 emit()，不能有绕过出口的直接 IPC 调用。

        原先有 6 处直接调 `window.api.petSetState`，只给其中一个入口加钩子会漏状态。
        """
        text = BRIDGE.read_text(encoding="utf-8")
        direct = re.findall(r"window\.api\?\.petSetState\?\(", text)
        assert not direct, f"仍有 {len(direct)} 处绕过 emit() 的直接调用"

    def test_bridge_notifies_the_visual_pet(self):
        text = BRIDGE.read_text(encoding="utf-8")
        assert "setSvgPetState" in text, "状态变化没有通知矢量宠物"


class TestSvgArtwork:
    def test_svg_exists(self):
        assert SVG.is_file(), "矢量宠物文件不见了"

    def test_svg_defines_all_four_state_classes(self):
        text = SVG.read_text(encoding="utf-8")
        for state in ("state-idle", "state-work", "state-sleep", "state-error"):
            assert f".{state}" in text, f"SVG 缺少 {state} 的样式"

    def test_work_state_is_visually_distinct_not_just_animated(self):
        """第二轮的教训：只靠动画快慢，静图里看不出区别。"""
        text = SVG.read_text(encoding="utf-8")
        assert "laptop" in text, "工作状态缺少可见的差异元素（小笔电）"

    def test_respects_reduced_motion(self):
        assert "prefers-reduced-motion" in SVG.read_text(encoding="utf-8")

    def test_uses_the_brand_palette(self):
        text = SVG.read_text(encoding="utf-8")
        for color in ("#F2A03D", "#FDF3E3", "#F7A8B8", "#3B2B20"):
            assert color in text, f"缺少品牌配色 {color}"


class TestStatusBarLookup:
    """回归：状态栏要用 id **或** class 查找。

    实测：这份遗产代码里 #status-bar 与 .status-bar 两套命名并存，真实元素用的是
    类名 —— 只用 getElementById 会拿到 null，宠物在初始化第一行就悄悄返回，
    而且没有任何报错（我为此用 --dump-dom 才查出来）。
    """

    def test_accepts_both_id_and_class(self):
        text = PET_TS.read_text(encoding="utf-8")
        assert "getElementById('status-bar')" in text
        assert ".status-bar" in text, "只认 id —— 真实元素用类名时会静默失败"

    def test_quietly_gives_up_when_missing(self):
        text = PET_TS.read_text(encoding="utf-8")
        assert "if (container || !statusBar()) return;" in text, \
            "找不到状态栏时要安静退出，不能抛错"
