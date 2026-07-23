# -*- coding: utf-8 -*-
"""
Generate complete-body pixel-art cat sprites for TCIDE pet window.
9 states: idle, wave, run, failed, review, jump, extra1, extra2, extra3
Canvas: 192x208, transparent background, pixel-art (crisp).
"""
import base64
import io
import json
import math
import random

from PIL import Image, ImageDraw

W, H = 192, 208

# Palette
ORANGE   = (245, 166, 35)    # main fur
ORANGE_D = (214, 138, 22)    # shade
ORANGE_L = (255, 196, 92)    # highlight
CREAM    = (255, 230, 190)   # muzzle / belly
PINK     = (233, 110, 120)   # nose / inner ear / tongue
BLACK    = (44, 52, 64)      # eyes / outline
OUTLINE  = (90, 60, 25)      # soft dark outline
WHITE    = (255, 255, 255)
GREEN    = (120, 200, 110)
RED      = (220, 70, 60)
BLUE     = (90, 160, 230)
PURPLE   = (160, 120, 220)
GRAY     = (150, 150, 160)
DARK     = (60, 60, 70)

TRANSPARENT = (0, 0, 0, 0)


def new_img():
    return Image.new("RGBA", (W, H), TRANSPARENT)


def px(d, x, y, color):
    if 0 <= x < W and 0 <= y < H:
        d.putpixel((int(x), int(y)), color)


def rect(d, x0, y0, x1, y1, color):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            px(d, x, y, color)


def fill_ellipse(d, cx, cy, rx, ry, color):
    for y in range(int(cy - ry), int(cy + ry) + 1):
        for x in range(int(cx - rx), int(cx + rx) + 1):
            dx = (x - cx) / rx
            dy = (y - cy) / ry
            if dx * dx + dy * dy <= 1.0:
                px(d, x, y, color)


def outline_ellipse(d, cx, cy, rx, ry, color, t=1):
    for y in range(int(cy - ry - t), int(cy + ry + t) + 1):
        for x in range(int(cx - rx - t), int(cx + rx + t) + 1):
            if x < 0 or y < 0 or x >= W or y >= H:
                continue
            dx = (x - cx) / (rx + t)
            dy = (y - cy) / (ry + t)
            inside = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0
            if (dx * dx + dy * dy <= 1.0) and not inside:
                px(d, x, y, color)


def circle(d, cx, cy, r, color):
    fill_ellipse(d, cx, cy, r, r, color)


# ---- Cat body builder -------------------------------------------------------
# Coordinate plan (192x208):
#   head:  cx=96, headY centers ~70, head radius ~42
#   ears:  two triangles on top of head
#   body:  ellipse below head, cx=96, bodyY ~150, rx~46, ry~44
#   legs/paws: small rounded rects under body
#   tail:  curve on right/left side

def draw_ear(d, tipx, tipy, basex, basey, half, color, inner):
    # simple triangle ear
    for t in range(0, half * 2 + 1):
        # left edge from tip to base-left
        pass
    # rasterize triangle tip->(basex-half,basey)->(basex+half,basey)
    pts = [(tipx, tipy), (basex - half, basey), (basex + half, basey)]
    minx = min(p[0] for p in pts); maxx = max(p[0] for p in pts)
    miny = min(p[1] for p in pts); maxy = max(p[1] for p in pts)
    for y in range(int(miny), int(maxy) + 1):
        for x in range(int(minx), int(maxx) + 1):
            if point_in_tri((x + 0.5, y + 0.5), pts):
                px(d, x, y, color)
    # inner ear (smaller triangle)
    pts2 = [(tipx, tipy + 6), (basex - half + 6, basey - 1), (basex + half - 6, basey - 1)]
    for y in range(int(miny), int(maxy) + 1):
        for x in range(int(minx), int(maxx) + 1):
            if point_in_tri((x + 0.5, y + 0.5), pts2):
                px(d, x, y, inner)


def point_in_tri(p, tri):
    (x, y) = p
    (x1, y1), (x2, y2), (x3, y3) = tri
    def sign(a, b, c):
        return (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1])
    d1 = sign((x, y), (x1, y1), (x2, y2))
    d2 = sign((x, y), (x2, y2), (x3, y3))
    d3 = sign((x, y), (x3, y3), (x1, y1))
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def draw_eye(d, cx, cy, r, look=(0, 0), mood="normal"):
    # white-ish sclera optional; we use black cat eye with shine
    if mood == "happy":
        # upward arc (closed happy eye)
        for x in range(cx - r, cx + r + 1):
            yy = cy + int(round(math.sqrt(max(0, r * r - (x - cx) ** 2)) * 0.6))
            px(d, x, yy, BLACK)
            if yy - 1 >= 0:
                px(d, x, yy - 1, BLACK)
        return
    if mood == "x":
        # X eye (failed)
        for i in range(-r, r + 1):
            px(d, cx + i, cy + i, BLACK)
            px(d, cx + i, cy - i, BLACK)
        return
    circle(d, cx, cy, r, BLACK)
    # shine
    sx = cx + look[0] * (r * 0.4)
    sy = cy + look[1] * (r * 0.4)
    px(d, int(sx - 1), int(sy - 1), WHITE)
    px(d, int(sx), int(sy - 1), WHITE)
    px(d, int(sx - 1), int(sy), WHITE)
    px(d, int(sx), int(sy), WHITE)


def draw_cat(d, state="idle", frame=0):
    head_cx, head_cy, head_r = 96, 74, 40
    body_cx, body_cy, body_rx, body_ry = 96, 150, 44, 46

    bob = 0
    if state in ("idle", "review"):
        bob = int(2 * math.sin(frame / 3.0))
    elif state == "run":
        bob = int(3 * math.sin(frame / 1.5))
    elif state == "jump":
        bob = -int(10 * abs(math.sin(frame / 3.0)))
    elif state == "failed":
        bob = int(2 * math.sin(frame / 4.0))

    head_cy += bob
    body_cy += bob

    # ---- tail ----
    tail_side = 1 if state != "wave" else 1
    tail_color = ORANGE
    # base of tail near body right
    tx0 = body_cx + body_rx - 6
    ty0 = body_cy + 10
    # curve up and out
    for i in range(26):
        t = i / 25.0
        tx = tx0 + int(28 * t)
        ty = ty0 - int(40 * math.sin(t * math.pi * 0.9))
        if state == "run":
            ty += int(8 * math.sin((frame + i) / 2.0))
        # tail thickness 6
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                if dx * dx + dy * dy <= 9:
                    px(d, tx + dx, ty + dy, tail_color)
    # tail tip
    px(d, tx0 + 28, ty0 - 38, ORANGE_D)

    # ---- body ----
    outline_ellipse(d, body_cx, body_cy, body_rx, body_ry, OUTLINE, t=2)
    fill_ellipse(d, body_cx, body_cy, body_rx, body_ry, ORANGE)
    # belly cream
    fill_ellipse(d, body_cx, body_cy + 12, body_rx - 16, body_ry - 20, CREAM)
    # tabby stripes on body
    for sy in (-10, 2, 14):
        for k in (-1, 1):
            rect(d, body_cx + k * 22 - 3, body_cy + sy, body_cx + k * 22 + 3, body_cy + sy + 10, ORANGE_D)

    # ---- legs / paws ----
    leg_y = body_cy + body_ry - 6
    for lx in (body_cx - 26, body_cx - 9, body_cx + 9, body_cx + 26):
        rect(d, lx - 7, leg_y - 4, lx + 7, leg_y + 16, ORANGE)
        rect(d, lx - 7, leg_y + 14, lx + 7, leg_y + 18, CREAM)

    # ---- head ----
    outline_ellipse(d, head_cx, head_cy, head_r, head_r - 2, OUTLINE, t=2)
    fill_ellipse(d, head_cx, head_cy, head_r, head_r - 2, ORANGE)
    # ears
    draw_ear(d, head_cx - 24, head_cy - head_r - 6, head_cx - 24, head_cy - head_r + 14, 16, ORANGE, PINK)
    draw_ear(d, head_cx + 24, head_cy - head_r - 6, head_cx + 24, head_cy - head_r + 14, 16, ORANGE, PINK)
    # muzzle
    fill_ellipse(d, head_cx, head_cy + 14, 22, 16, CREAM)
    # stripes on forehead
    for sx in (-10, 0, 10):
        rect(d, head_cx + sx - 2, head_cy - head_r + 6, head_cx + sx + 2, head_cy - 6, ORANGE_D)
    # cheeks
    circle(d, head_cx - 16, head_cy + 4, 6, ORANGE_L)
    circle(d, head_cx + 16, head_cy + 4, 6, ORANGE_L)

    # ---- eyes ----
    eye_y = head_cy - 2
    look = (0, 0)
    if state == "run":
        look = (1, 0)
    if state == "review":
        look = (0, -1)
    if state == "failed":
        draw_eye(d, head_cx - 15, eye_y, 8, mood="x")
        draw_eye(d, head_cx + 15, eye_y, 8, mood="x")
    elif state in ("idle", "wave", "review", "extra1", "extra2", "extra3", "jump"):
        draw_eye(d, head_cx - 15, eye_y, 8, look=look, mood="normal")
        draw_eye(d, head_cx + 15, eye_y, 8, look=look, mood="normal")
    elif state == "run":
        draw_eye(d, head_cx - 15, eye_y, 7, look=look, mood="normal")
        draw_eye(d, head_cx + 15, eye_y, 7, look=look, mood="normal")

    # ---- nose + mouth ----
    # nose
    fill_ellipse(d, head_cx, head_cy + 12, 5, 4, PINK)
    # mouth
    for i in range(8):
        mx = head_cx - 8 + i
        my = head_cy + 18 + int(3 * (1 - abs(i - 4) / 4))
        px(d, mx, my, BLACK)
        px(d, 2 * head_cx - mx, my, BLACK)

    # ---- whiskers ----
    for k in (-1, 1):
        for w in (0, 1):
            wy = head_cy + 10 + w * 6
            for t in range(18):
                wx = head_cx + k * (18 + t)
                if 0 <= wx < W:
                    if t % 2 == 0:
                        px(d, int(wx), int(wy + (t // 6)), (210, 210, 210))

    # ---- state-specific overlays ----
    if state == "wave":
        # raised paw near head right (clean, attached to body)
        paw_x = head_cx + head_r - 2
        paw_y = head_cy - 30 + bob
        # arm from shoulder up to paw
        rect(d, paw_x, paw_y + 12, paw_x + 12, paw_y + 26, ORANGE)
        rect(d, paw_x + 4, paw_y + 2, paw_x + 16, paw_y + 16, ORANGE)
        circle(d, paw_x + 10, paw_y, 9, CREAM)
    elif state == "review":
        # magnifier held to the side, handle tucked into body
        magx = head_cx + head_r + 26
        magy = head_cy + 6 + bob
        circle(d, magx, magy, 15, (180, 210, 240))
        circle(d, magx, magy, 11, (225, 242, 255))
        # thick handle from body edge into lens
        rect(d, head_cx + head_r - 2, magy, magx + 11, magy + 8, GRAY)
        rect(d, magx + 4, magy + 6, magx + 22, magy + 16, GRAY)
    elif state == "failed":
        # sweat drop
        circle(d, head_cx + head_r + 2, head_cy - 8 + bob, 5, BLUE)
        # tear
        px(d, head_cx - 15, eye_y + 10, BLUE)
    elif state == "jump":
        # small motion puffs under feet only
        for i in range(3):
            circle(d, 70 + i * 22, 198, 4, (210, 210, 210))
    elif state == "extra1":
        # heart above
        hx, hy = head_cx, head_cy - head_r - 22
        draw_heart(d, hx, hy, 10, RED)
    elif state == "extra2":
        # star above
        draw_star(d, head_cx, head_cy - head_r - 20, 12, (255, 220, 80))
    elif state == "extra3":
        # music note above
        draw_note(d, head_cx + 6, head_cy - head_r - 18, PURPLE)

    # ground shadow
    sh_y = 200
    for x in range(40, 152):
        a = int(70 * (1 - abs(x - 96) / 56))
        if a > 0:
            col = (0, 0, 0, a)
            px(d, x, sh_y, col)
            px(d, x, sh_y + 1, col)


def draw_heart(d, cx, cy, s, color):
    for y in range(-s, s + 1):
        for x in range(-s, s + 1):
            if (x * x + (y - s * 0.3) ** 2 <= (s * 0.8) ** 2) or \
               ((x + s * 0.5) ** 2 + y * y <= (s * 0.7) ** 2) or \
               ((x - s * 0.5) ** 2 + y * y <= (s * 0.7) ** 2):
                if y < -s * 0.1:
                    continue
                px(d, cx + x, cy + y, color)


def draw_star(d, cx, cy, r, color):
    points = []
    for i in range(10):
        ang = math.pi / 5 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.45
        points.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    # fill convex-ish via scanline of triangles from center
    for y in range(int(cy - r), int(cy + r) + 1):
        for x in range(int(cx - r), int(cx + r) + 1):
            inside = False
            for i in range(5):
                if point_in_tri((x + 0.5, y + 0.5), [points[i * 2], points[i * 2 + 1], points[(i * 2 + 2) % 10]]):
                    inside = True
            if inside:
                px(d, x, y, color)


def draw_note(d, cx, cy, color):
    rect(d, cx, cy - 18, cx + 3, cy, color)
    circle(d, cx - 2, cy, 6, color)
    rect(d, cx + 14, cy - 22, cx + 17, cy - 6, color)
    circle(d, cx + 12, cy - 6, 6, color)
    rect(d, cx + 3, cy - 18, cx + 14, cy - 14, color)


def make_png_bytes(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def main():
    states = {
        "idle": 1, "wave": 1, "run": 3, "failed": 1, "review": 1,
        "jump": 3, "extra1": 1, "extra2": 1, "extra3": 1,
    }
    manifest = {}
    for st, frames in states.items():
        if frames == 1:
            img = new_img()
            draw_cat(img, st, 0)
            manifest[st] = "data:image/png;base64," + base64.b64encode(make_png_bytes(img)).decode()
        else:
            # pick representative frame (mid) for static; animation loops same sheet
            frames_list = []
            for fr in range(frames):
                img = new_img()
                draw_cat(img, st, fr)
                frames_list.append("data:image/png;base64," + base64.b64encode(make_png_bytes(img)).decode())
            # use first frame as the state image; loop will reuse it (F frames)
            manifest[st] = frames_list[0]

    out = {
        "idle": manifest["idle"],
        "wave": manifest["wave"],
        "run": manifest["run"],
        "failed": manifest["failed"],
        "review": manifest["review"],
        "jump": manifest["jump"],
        "extra1": manifest["extra1"],
        "extra2": manifest["extra2"],
        "extra3": manifest["extra3"],
    }
    with open("C:/Users/noirh/.qclaw/workspace-ua58rsb93veqtxl7/pet_manifest.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print("Wrote pet_manifest.json with", len(out), "states")
    # also write preview pngs for visual check
    for st, frames in states.items():
        img = new_img()
        draw_cat(img, st, 0)
        img.save("C:/Users/noirh/.qclaw/workspace-ua58rsb93veqtxl7/pet_preview_%s.png" % st, format="PNG")
    print("Wrote preview pngs")


if __name__ == "__main__":
    main()
