# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""桌面宠物（独立悬浮窗口）的离线测试。

为什么是"独立悬浮窗口"而不是界面内的装饰：用户要的是像 MollyPaw 那样——
宠物自己浮在桌面上、可以拖着走。MollyPaw 为此专门用了独立进程；本项目用
PyWebView 的第二个窗口（透明 / 无边框 / 置顶 / easy_drag 拖动）。

本机**无法**自动验证"置顶、拖动的手感"（那需要真实桌面交互），所以这组测试覆盖的是
可离线验证的部分：

1. **宠物页面**存在、能内联 SVG、带四状态类、有状态轮询、背景透明；
2. **状态链路**：`GET/POST /api/pet/state` 真的通，`/pet` 真的返回那个页面；
3. **窗口参数**：用假 `webview` 拦住 `create_window`，断言开的确实是
   无边框 / 透明 / 置顶 / 可拖动的小窗 —— 这是"悬浮宠物"最核心的一处，
   不能只靠肉眼；
4. **拖动交给宿主**：确认 `easy_drag=True`，且页面里没有自己实现鼠标拖拽
   （那是重复劳动且容易和宿主冲突）。
"""

from __future__ import annotations

import re
from pathlib import Path

import sys

import pytest
from fastapi.testclient import TestClient

import main as main_module
import server

ROOT = Path(__file__).resolve().parent.parent
PET_HTML = ROOT / "web" / "pet.html"
SHIM = ROOT / "web" / "electron-shim.js"
ASSETS = ROOT / "web" / "icons" / "pet"
SVG = ASSETS / "tcide-pet.svg"

client = TestClient(server.app)

APP_STATES = ("idle", "thinking", "tool", "run", "review",
              "success", "jump", "wave", "error", "failed")


class TestPetPage:
    def test_page_exists(self):
        assert PET_HTML.is_file(), "宠物页面不存在"


    def test_page_is_served(self):
        response = client.get("/pet")
        assert response.status_code == 200
        assert "pet-idle" in response.text, "页面里没有宠物位图引用"

    def test_background_is_transparent(self):
        """悬浮宠物窗口是透明的，页面铺底色就会看到一块方板。"""
        text = PET_HTML.read_text(encoding="utf-8")
        assert re.search(r"background:\s*transparent", text), "页面没有透明背景"

    def test_uses_bitmaps_not_svg(self):
        """宠物图与动画用 PNG/GIF，不用 SVG（用户明确要求，也更稳）。

        位图没有"内联 SVG + CSS 层叠 + 容器尺寸"那套互相牵扯的渲染问题 ——
        我为此在无头验证里反复被绊住（服务端 HTML 完全正确，页面却整页纯白）。
        """
        text = PET_HTML.read_text(encoding="utf-8")
        assert "pet-idle.gif" in text, "页面没有用 GIF 动画"
        assert "pet-idle.png" in text, "没有 PNG 兜底"
        assert "<svg" not in text, "页面里不该再有内联 SVG"
        assert "fetch('/icons/pet/tcide-pet.svg')" not in text

    def test_bitmap_assets_exist_for_every_state(self):
        for state in ("idle", "work", "sleep", "error"):
            for suffix in (".gif", ".png"):
                asset = ASSETS / f"pet-{state}{suffix}"
                assert asset.is_file(), f"缺少 {asset.name}"
                assert asset.stat().st_size > 1000, f"{asset.name} 太小，可能是空图"

    def test_page_swaps_the_image_source_per_state(self):
        text = PET_HTML.read_text(encoding="utf-8")
        assert "'/icons/pet/pet-' + visual + '.gif'" in text, \
            "状态切换没有换图，宠物不会跟着变"

    def test_maps_every_app_state(self):
        text = PET_HTML.read_text(encoding="utf-8")
        missing = [state for state in APP_STATES if f"{state}:" not in text]
        assert not missing, f"这些状态没有映射：{missing}"

    def test_uses_the_four_visual_states(self):
        text = PET_HTML.read_text(encoding="utf-8")
        for state in ("state-idle", "state-work", "state-sleep", "state-error"):
            assert state in text, f"页面里没有 {state}"

    def test_does_not_implement_its_own_dragging(self):
        """拖动交给宿主的 easy_drag —— 自己实现会与宿主抢鼠标事件。"""
        text = PET_HTML.read_text(encoding="utf-8")
        assert "mousedown" not in text and "pointerdown" not in text, \
            "页面自己实现了拖拽，应该交给 easy_drag"


class TestStatePipeline:
    def test_state_round_trips(self):
        assert client.get("/api/pet/state").json()["state"] in APP_STATES
        assert client.post("/api/pet/state",
                           json={"state": "thinking", "label": "分析中…"}).json()["state"] \
            == "thinking"
        got = client.get("/api/pet/state").json()
        assert got["state"] == "thinking" and got["label"] == "分析中…"

    def test_empty_body_is_tolerated(self):
        """空 body 不该 500 —— 宠物状态是尽力而为的信息。"""
        assert client.post("/api/pet/state").status_code == 200

    def test_shim_forwards_pet_state(self):
        """实测原来 shim **没有**实现 petSetState，所以 Web 版里十处调用全落空。"""
        text = SHIM.read_text(encoding="utf-8")
        assert "petSetState" in text, "shim 没有转发宠物状态"
        assert "/api/pet/state" in text


class TestWindowParameters:
    """用假 webview 拦住 create_window，断言开的确实是"悬浮宠物"窗口。"""

    def _capture(self, monkeypatch) -> list[dict]:
        captured: list[dict] = []

        class FakeWindow:
            pass

        def fake_create_window(*args, **kwargs):
            captured.append({"args": args, "kwargs": kwargs})
            return FakeWindow()

        class FakeWebview:
            @staticmethod
            def create_window(*args, **kwargs):
                return fake_create_window(*args, **kwargs)

            @staticmethod
            def start(*args, **kwargs):
                captured.append({"started": True})

        monkeypatch.setitem(__import__("sys").modules, "webview", FakeWebview)
        return captured

    def test_opens_a_floating_pet_window(self, monkeypatch):
        captured = self._capture(monkeypatch)
        main_module.open_pet_window("http://127.0.0.1:18420", x=100, y=100)
        assert captured, "没有创建窗口"
        kwargs = captured[0]["kwargs"]
        assert kwargs.get("frameless") is True, "不是无边框，桌面上会出现标题栏"
        assert kwargs.get("transparent") is True, "不是透明，会出现一块方形底色"
        assert kwargs.get("on_top") is True, "没有置顶，会被编辑器盖住"
        assert kwargs.get("easy_drag") is True, "没开启拖动，用户拖不动宠物"

    def test_pet_opens_a_small_window(self, monkeypatch):
        captured = self._capture(monkeypatch)
        main_module.open_pet_window("http://127.0.0.1:18420")
        kwargs = captured[0]["kwargs"]
        assert kwargs["width"] <= 220 and kwargs["height"] <= 260, \
            "宠物窗口太大，就不像「浮在桌面上」了"

    def test_loads_the_pet_page(self, monkeypatch):
        captured = self._capture(monkeypatch)
        main_module.open_pet_window("http://127.0.0.1:18420")
        url = captured[0]["args"][1] if len(captured[0]["args"]) > 1 \
            else captured[0]["kwargs"].get("url", "")
        assert url.endswith("/pet"), f"宠物窗口加载的不是宠物页面：{url}"

    def test_can_be_disabled_from_the_command_line(self):
        import inspect

        signature = inspect.signature(main_module.open_window)
        assert "no_pet" in signature.parameters, "没有 --no-pet 的对应形参"


class TestSvgArtwork:
    """矢量宠物文件本身的断言（从旧的 test_frontend_pet.py 接过来）。

    界面内的接法已经撤掉（改为独立悬浮窗口），但**美术本身**的约束依然成立，
    而且每一条都对应过一次真实的返工。
    """

    def test_svg_exists(self):
        assert SVG.is_file(), "矢量原稿不见了（位图由它渲染而来）"

    def test_defines_all_four_state_classes(self):
        text = SVG.read_text(encoding="utf-8")
        for state in ("state-idle", "state-work", "state-sleep", "state-error"):
            assert f".{state}" in text, f"SVG 缺少 {state} 的样式"

    def test_work_state_is_visually_distinct_not_just_animated(self):
        """第二轮的教训：只靠动画快慢，静图里看不出区别。"""
        assert "laptop" in SVG.read_text(encoding="utf-8"), \
            "工作状态缺少可见的差异元素（小笔电）"

    def test_respects_reduced_motion(self):
        assert "prefers-reduced-motion" in SVG.read_text(encoding="utf-8")

    def test_uses_the_brand_palette(self):
        text = SVG.read_text(encoding="utf-8")
        for color in ("#F2A03D", "#FDF3E3", "#F7A8B8", "#3B2B20"):
            assert color in text, f"缺少品牌配色 {color}"

    def test_body_shares_the_page_background_nothing(self):
        """SVG 自己不该铺背景色 —— 它是贴在透明窗口上的。"""
        text = SVG.read_text(encoding="utf-8")
        assert "background" not in text.split("<style>")[1].split("</style>")[0], \
            "SVG 里画了背景，会挡住透明窗口"


class TestPetPositionIsRemembered:
    """用户把宠物拖到哪儿，下次打开就该在哪儿。

    PyWebView 没有 moved 事件（实测 Window.events 不存在），所以实现是：
    `webview.start(func, args)` 的后台槽位里轮询 Window.x/y，变化就写进
    settings.extra。这一组把"存 → 读 → 恢复 → 越界保护"整条链路钉住。
    """

    @pytest.fixture(autouse=True)
    def isolated(self, tmp_path, monkeypatch):
        monkeypatch.setenv("TCIDE_CONFIG_DIR", str(tmp_path))

    def test_unset_returns_none(self):
        assert main_module.read_pet_position() == (None, None)

    def test_round_trips(self):
        main_module.save_pet_position(320, 240)
        assert main_module.read_pet_position() == (320, 240)

    def test_out_of_range_is_rejected(self):
        """换显示器/改分辨率后，旧坐标可能落在屏幕外 —— 那会变成"看不见的宠物"。"""
        main_module.save_pet_position(0, 0)
        main_module._forced_out_of_range = True  # 说明用：下面直接写非法值
        from tcide_core.settings import load, save

        settings = load()
        extra = dict(settings.extra or {})
        extra[main_module.PET_POSITION_KEY] = [-99999, 5]
        settings.extra = extra
        save(settings)
        assert main_module.read_pet_position() == (None, None)

    def test_watcher_saves_where_the_window_actually_is(self):
        """盯守循环必须真的把窗口当前位置存下来。"""
        calls = {"n": 0}

        class FakeWindow:
            @property
            def x(self):
                calls["n"] += 1
                if calls["n"] > 2:
                    raise RuntimeError("窗口已关闭")   # 让循环自己退出
                return 111

            @property
            def y(self):
                return 222

        main_module.watch_pet_position(FakeWindow(), interval=0.01)
        assert main_module.read_pet_position() == (111, 222)

    def test_window_opens_at_the_saved_position(self, monkeypatch):
        captured = self._capture(monkeypatch)
        main_module.save_pet_position(410, 260)
        x, y = main_module.read_pet_position()
        main_module.open_pet_window("http://127.0.0.1:18420", x=x, y=y)
        assert captured[0]["kwargs"]["x"] == 410
        assert captured[0]["kwargs"]["y"] == 260

    def test_open_window_wires_the_watcher_only_when_pet_exists(self, monkeypatch):
        """没有宠物窗口时不能传一个空对象给 start()。"""
        started: list = []

        class FakeWindow:
            pass

        class FakeWebview:
            @staticmethod
            def create_window(*args, **kwargs):
                return FakeWindow()

            @staticmethod
            def start(func=None, args=None, **kwargs):
                started.append((func, args))

        monkeypatch.setitem(sys.modules, "webview", FakeWebview)
        main_module.open_window("http://127.0.0.1:18420", no_pet=True)
        assert started and started[0][0] is None, \
            "没开宠物窗口时不该传盯守函数"

    def _capture(self, monkeypatch) -> list:
        captured: list = []

        class FakeWebview:
            @staticmethod
            def create_window(*args, **kwargs):
                captured.append({"args": args, "kwargs": kwargs})
                return object()

            @staticmethod
            def start(*args, **kwargs):
                return None

        monkeypatch.setitem(sys.modules, "webview", FakeWebview)
        return captured


class TestPetFallsAsleep:
    """`sleep` 这个状态此前**永远触发不到** —— 图画好了却没有代码会切过去。"""

    def test_page_sleeps_after_a_long_idle(self):
        text = PET_HTML.read_text(encoding="utf-8")
        assert "SLEEP_AFTER_MS" in text, "页面没有空闲入睡的逻辑"
        assert "pet-sleep.gif" in text, "入睡后没有切换到睡觉的图"

    def test_any_state_change_wakes_it_up(self):
        text = PET_HTML.read_text(encoding="utf-8")
        assert "idleSince = Date.now()" in text, \
            "收到非待机状态时没有重置空闲计时（醒来逻辑）"
