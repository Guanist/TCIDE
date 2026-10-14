"""把矢量虎猫渲染成 PNG / GIF（用户要求：宠物图与动画用位图，不用 SVG）。

为什么这条路更稳：SVG 内联进页面后要跟 CSS、层叠、容器尺寸、透明背景一起工作，
我在真机无头验证里反复被它绊住（服务端吐出的 HTML 完全正确，却整页纯白）。
位图没有这些问题：`<img src="...png">` 该显示就显示。这也正是 MollyPaw 的做法
（`pet_idle.png` / `pet_work.png` / `pet_sleep.png` / `pet_cry.png`）。

步骤：
1. 对四个状态各写一个临时 HTML（透明背景 + 对应的状态类），用 Edge 无头渲染成
   **带透明通道**的 PNG（`--default-background-color=00000000`）；
2. 用 Pillow 裁掉透明边距、等比缩放到 104px，存成 web/icons/pet/pet-{state}.png；
3. 再用这些 PNG 合成"会呼吸"的 GIF：把同一张图按不同 y 偏移画到画布上，
   做出上下起伏；GIF 用索引 255 作为透明色（Pillow 的常规做法）。
"""

from __future__ import annotations

import pathlib
import subprocess
import sys

sys.stdout.reconfigure(line_buffering=True)
ROOT = pathlib.Path(r"C:\Users\noirh\Desktop\Vincent\campus\tcide-work")
SVG = ROOT / "web" / "icons" / "pet" / "tcide-pet.svg"
OUT = ROOT / "web" / "icons" / "pet"
TMP = ROOT / ".tcide-build" / "petframes"
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

STATES = ("idle", "work", "sleep", "error")
#: 每个状态的动画幅度（像素）与帧序列 —— 越"活跃"的状态幅度越大、帧越多
MOTION = {
    "idle": ([0, -2, 0, 1], 220),
    "work": ([0, -3, 0, -3], 110),
    "sleep": ([0, -1, 0, 0], 460),
    "error": ([0, -1, 0, 1], 320),
}
SIZE = 104


def render_state(state: str) -> pathlib.Path:
    """用 Edge 把某个状态的 SVG 渲染成带透明通道的 PNG。"""
    frame_html = TMP / f"{state}.html"
    svg = SVG.read_text(encoding="utf-8")
    frame_html.write_text(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>"
        "html,body{margin:0;padding:0;background:transparent}"
        f"#w{{display:inline-block;padding:12px}}</style></head>"
        f"<body><div id=\"w\" class=\"state-{state}\">{svg}</div></body></html>",
        encoding="utf-8", newline="\n")

    png = TMP / f"{state}-raw.png"
    if png.exists():
        png.unlink()
    profile = TMP / ".profile"
    profile.mkdir(exist_ok=True)
    subprocess.run(
        [EDGE, "--headless=new", "--disable-gpu", "--hide-scrollbars",
         "--no-first-run", "--default-background-color=00000000",
         f"--user-data-dir={profile}", "--window-size=280,300",
         "--virtual-time-budget=5000", f"--screenshot={png}", frame_html.as_uri()],
        capture_output=True, text=True)
    return png


def to_icon(raw: pathlib.Path, state: str) -> pathlib.Path:
    """裁掉透明边距 → 等比缩放到 SIZE → 存成 pet-{state}.png。"""
    from PIL import Image

    image = Image.open(raw).convert("RGBA")
    box = image.getbbox()          # 非透明区域的包围盒
    if box:
        image = image.crop(box)
    scale = SIZE / max(image.width, image.height)
    image = image.resize((max(1, round(image.width * scale)),
                          max(1, round(image.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    canvas.paste(image, ((SIZE - image.width) // 2, (SIZE - image.height) // 2),
                 image)
    target = OUT / f"pet-{state}.png"
    canvas.save(target)
    return target


def make_gif(icon: pathlib.Path, state: str) -> pathlib.Path:
    """用同一张 PNG 按 y 偏移合成"会呼吸"的 GIF（索引 255 作为透明色）。"""
    from PIL import Image

    icon_image = Image.open(icon).convert("RGBA")
    offsets, duration = MOTION[state]
    pad = max(abs(min(offsets)), abs(max(offsets))) + 2
    frames = []
    for offset in offsets:
        canvas = Image.new("RGBA", (SIZE, SIZE + pad * 2), (0, 0, 0, 0))
        canvas.paste(icon_image, (0, pad + offset), icon_image)
        alpha = canvas.split()[3]
        paletted = canvas.convert("RGB").convert("P", palette=Image.ADAPTIVE,
                                                colors=255)
        mask = alpha.point(lambda value: 255 if value <= 128 else 0)
        paletted.paste(255, mask)                    # 索引 255 留给透明
        paletted.info["transparency"] = 255
        paletted.info["duration"] = duration
        frames.append(paletted)

    target = OUT / f"pet-{state}.gif"
    frames[0].save(target, save_all=True, append_images=frames[1:],
                   duration=duration, loop=0, transparency=255, disposal=2,
                   optimize=False)
    return target


def main() -> int:
    from PIL import Image

    TMP.mkdir(parents=True, exist_ok=True)
    if not SVG.is_file():
        print("  ★ 找不到矢量源文件")
        return 1

    problems: list[str] = []
    for state in STATES:
        raw = render_state(state)
        if not raw.is_file() or raw.stat().st_size < 500:
            problems.append(f"{state}: Edge 没有渲染出图")
            continue
        with Image.open(raw) as probe:
            opaque = sum(1 for pixel in probe.convert("RGBA").getdata()
                         if pixel[3] > 0)
        icon = to_icon(raw, state)
        gif = make_gif(icon, state)
        print(f"  {state:<6} PNG {icon.stat().st_size:>6,} 字节"
              f"（非透明像素 {opaque:,}）  GIF {gif.stat().st_size:>6,} 字节")
        if opaque < 500:
            problems.append(f"{state}: 渲染出来的图几乎是空的（非透明像素 {opaque}）")

    print()
    if problems:
        print("★ 有问题：")
        for item in problems:
            print("  · " + item)
        return 1
    print("✓ 四个状态的 PNG 与 GIF 都已生成（透明背景）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
