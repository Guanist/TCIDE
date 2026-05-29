"""
installer-sidebar-v3.py
高质量虎猫吉祥物侧边图（164×314 BMP）
v3 修复: 文字截断 + 构图紧凑
"""
import math, os, sys
sys.stdout.reconfigure(encoding='utf-8')
from PIL import Image, ImageDraw, ImageFont

W, H = 164, 314
C_FUR      = (255, 140, 0)
C_FUR_LT   = (255, 165, 0)
C_FUR_PALE = (255, 210, 140)
C_STRIPE   = (204, 112, 0)
C_EYE      = (45,  80, 22)
C_NOSE     = (255, 107, 107)
C_BLUSH    = (255, 160, 160)
C_WHITE    = (255, 255, 255)
C_BLACK    = (30,  15,  5)
C_BG       = (28,  28,  32)
C_BG2      = (38,  36,  42)
C_ACCENT   = (255, 140, 0)
C_TEXT     = (212, 212, 212)
C_DIM      = (90,  90,  95)

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(OUT, "resources")


def try_font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def star(draw, sx, sy, sr, color):
    pts = []
    for i in range(10):
        angle = math.pi/2 + i * math.pi/5
        rad = sr if i % 2 == 0 else sr * 0.4
        pts.append((sx + rad*math.cos(angle), sy - rad*math.sin(angle)))
    draw.polygon(pts, fill=color)


def main():
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # ── 渐变背景（深色渐变）──
    for y in range(H):
        t = y / H
        r = int(C_BG[0] + (38-28)*t)
        g = int(C_BG[1] + (34-28)*t)
        b = int(C_BG[2] + (40-32)*t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # 顶部装饰条（橙色）
    draw.rectangle([0, 0, W, 4], fill=C_FUR)
    # 渐变光晕
    for i in range(6):
        y = 4 + i * 4
        alpha = max(1, int(40 - i * 7))
        draw.line([(0, y), (W, y)], fill=C_FUR + (alpha,))

    # ── 布局规划 ──
    # 总高 314px：
    #   0-20:   装饰条
    #   20-170: 吉祥物（150px 高度）
    #   175-230: 标题区（55px）
    #   235-295: 特性列表（60px）
    #   300-310: 版权
    cx = W // 2          # 82
    cy_head = 93         # 头部中心 Y

    # ══════════════════════════════════════
    # 身体（椭圆）
    # ══════════════════════════════════════
    body_cx = cx + 3
    body_cy = cy_head + 68
    draw.ellipse([body_cx-52, body_cy-40, body_cx+52, body_cy+48], fill=C_FUR)
    # 肚子白色
    draw.ellipse([body_cx-33, body_cy-18, body_cx+33, body_cy+40], fill=C_FUR_PALE)

    # ══════════════════════════════════════
    # 尾巴（从右侧绕到头顶左侧）
    # ══════════════════════════════════════
    tail_pts = []
    for t in range(22):
        tt = t / 21.0
        bx = body_cx + 50 - 45 * math.sin(tt * math.pi * 0.75)
        by = body_cy + 5 - 110 * tt + 25 * math.sin(tt * math.pi)
        bx += 6 * math.sin(tt * math.pi * 3)
        tail_pts.append((bx, by))
    
    for w in range(12, 5, -1):
        c = C_FUR if w > 9 else C_STRIPE
        for i in range(len(tail_pts)-1):
            draw.line([tail_pts[i], tail_pts[i+1]], fill=c, width=w)

    # ══════════════════════════════════════
    # 头部（大圆脸）
    # ══════════════════════════════════════
    head_r = 46
    draw.ellipse([cx-head_r, cy_head-head_r, cx+head_r, cy_head+head_r], fill=C_FUR)
    # 脸颊白
    cheek_r = 18
    draw.ellipse([cx-37, cy_head+6, cx-37+cheek_r*2, cy_head+6+cheek_r*2], fill=C_FUR_PALE)
    draw.ellipse([cx+37-cheek_r*2, cy_head+6, cx+37, cy_head+6+cheek_r*2], fill=C_FUR_PALE)

    # ══════════════════════════════════════
    # 耳朵
    # ══════════════════════════════════════
    # 左耳
    draw.polygon([(cx-35, cy_head-38), (cx-52, cy_head-70), (cx-14, cy_head-44)], fill=C_FUR)
    draw.polygon([(cx-31, cy_head-42), (cx-45, cy_head-64), (cx-17, cy_head-44)], fill=C_FUR_PALE)
    # 右耳
    draw.polygon([(cx+35, cy_head-38), (cx+52, cy_head-70), (cx+14, cy_head-44)], fill=C_FUR)
    draw.polygon([(cx+31, cy_head-42), (cx+45, cy_head-64), (cx+17, cy_head-44)], fill=C_FUR_PALE)

    # ══════════════════════════════════════
    # 条纹
    # ══════════════════════════════════════
    draw.line([(cx, cy_head-38), (cx, cy_head-8)], fill=C_STRIPE, width=6)
    draw.line([(cx-18, cy_head-35), (cx-16, cy_head-6)], fill=C_STRIPE, width=4)
    draw.line([(cx+18, cy_head-35), (cx+16, cy_head-6)], fill=C_STRIPE, width=4)

    # ══════════════════════════════════════
    # 眼睛
    # ══════════════════════════════════════
    eye_y = cy_head - 3
    # 白眼球
    draw.ellipse([cx-26, eye_y-14, cx-8, eye_y+11], fill=C_WHITE)
    draw.ellipse([cx+8, eye_y-14, cx+26, eye_y+11], fill=C_WHITE)
    # 虹膜
    draw.ellipse([cx-23, eye_y-9, cx-13, eye_y+9], fill=C_EYE)
    draw.ellipse([cx+13, eye_y-9, cx+23, eye_y+9], fill=C_EYE)
    # 瞳孔
    draw.ellipse([cx-20, eye_y-4, cx-16, eye_y+4], fill=C_BLACK)
    draw.ellipse([cx+16, eye_y-4, cx+20, eye_y+4], fill=C_BLACK)
    # 高光
    draw.ellipse([cx-21, eye_y-7, cx-18, eye_y-4], fill=C_WHITE)
    draw.ellipse([cx-19, eye_y-1, cx-17, eye_y+1], fill=C_WHITE)
    draw.ellipse([cx+18, eye_y-7, cx+21, eye_y-4], fill=C_WHITE)
    draw.ellipse([cx+19, eye_y-1, cx+21, eye_y+1], fill=C_WHITE)

    # ══════════════════════════════════════
    # 鼻子 + 嘴巴
    # ══════════════════════════════════════
    nose_y = cy_head + 17
    draw.ellipse([cx-5, nose_y-3, cx+5, nose_y+3], fill=C_NOSE)
    # 微笑
    draw.arc([cx-12, nose_y+3, cx, nose_y+16], 0, 180, fill=C_BLACK, width=2)
    draw.arc([cx, nose_y+3, cx+12, nose_y+16], 0, 180, fill=C_BLACK, width=2)

    # ══════════════════════════════════════
    # 腮红
    # ══════════════════════════════════════
    blush_r = 8
    draw.ellipse([cx-43, cy_head+15, cx-43+blush_r*2, cy_head+15+blush_r*2],
                  fill=(255, 180, 180, 120))
    draw.ellipse([cx+43-blush_r*2, cy_head+15, cx+43, cy_head+15+blush_r*2],
                  fill=(255, 180, 180, 120))

    # ══════════════════════════════════════
    # 胡须
    # ══════════════════════════════════════
    wc = (55, 25, 12)
    draw.line([(cx-43, cy_head+15), (cx-70, cy_head+7)], fill=wc, width=1)
    draw.line([(cx-43, cy_head+22), (cx-72, cy_head+22)], fill=wc, width=1)
    draw.line([(cx-41, cy_head+28), (cx-68, cy_head+37)], fill=wc, width=1)
    draw.line([(cx+43, cy_head+15), (cx+70, cy_head+7)], fill=wc, width=1)
    draw.line([(cx+43, cy_head+22), (cx+72, cy_head+22)], fill=wc, width=1)
    draw.line([(cx+41, cy_head+28), (cx+68, cy_head+37)], fill=wc, width=1)

    # ══════════════════════════════════════
    # 前爪
    # ══════════════════════════════════════
    draw.ellipse([body_cx-44, body_cy+26, body_cx-18, body_cy+48], fill=C_FUR)
    draw.ellipse([body_cx+18, body_cy+26, body_cx+44, body_cy+48], fill=C_FUR)
    draw.ellipse([body_cx-39, body_cy+33, body_cx-33, body_cy+41], fill=C_WHITE)
    draw.ellipse([body_cx+33, body_cy+33, body_cx+39, body_cy+41], fill=C_WHITE)

    # ══════════════════════════════════════
    # 小键盘
    # ══════════════════════════════════════
    kb_x, kb_y = cx - 26, body_cy + 50
    kb_w, kb_h = 54, 18
    draw.rounded_rectangle([kb_x, kb_y, kb_x+kb_w, kb_y+kb_h], radius=3,
                           fill=(45, 45, 48), outline=(65, 65, 68), width=1)
    for row in range(2):
        for col in range(5):
            kx = kb_x + 4 + col * 9
            ky = kb_y + 2 + row * 7
            draw.rounded_rectangle([kx, ky, kx+7, ky+4], radius=1, fill=(62, 62, 66))
    # 橙色空格键
    draw.rounded_rectangle([kb_x+4, kb_y+15, kb_x+30, kb_y+17], radius=1, fill=C_FUR)

    # ══════════════════════════════════════
    # 星星装饰
    # ══════════════════════════════════════
    star(draw, 16, 35, 4, (255, 220, 100))
    star(draw, 148, 32, 3.5, (255, 220, 100))
    star(draw, 12, 78, 2.5, (255, 240, 180))
    star(draw, 152, 74, 3, (255, 240, 180))
    star(draw, 78, 24, 2.5, (255, 220, 100))

    # ══════════════════════════════════════
    # 底部文字区
    # ══════════════════════════════════════
    font_title = try_font([
        "C:\\Windows\\Fonts\\msyhbd.ttc",
        "C:\\Windows\\Fonts\\msyh.ttc",
    ], 11)
    font_sub = try_font(["C:\\Windows\\Fonts\\msyh.ttc"], 9)
    font_copy = try_font(["C:\\Windows\\Fonts\\arial.ttf"], 8)

    # 分隔线
    line_y = 178
    draw.line([(18, line_y), (W-18, line_y)], fill=(60, 60, 65), width=1)

    # 标题（自适应字号，确保不截断）
    title = "虎猫 TCIDE"
    # 逐级缩小直到文字完全在画布内
    for fs in range(13, 6, -1):
        ft = try_font([
            "C:\\Windows\\Fonts\\msyhbd.ttc",
            "C:\\Windows\\Fonts\\msyh.ttc",
        ], fs)
        # 用临时画布测量实际渲染宽度
        tmp = Image.new("RGBA", (W, 30), (0,0,0,0))
        td = ImageDraw.Draw(tmp)
        td.text((12, 2), title, fill=(255,255,255), font=ft)
        bbox_actual = tmp.getbbox()
        if bbox_actual:
            actual_w = bbox_actual[2] - bbox_actual[0]
        else:
            actual_w = 0
        if actual_w > 0 and actual_w <= W - 16:
            font_title = ft
            draw.text(((W-actual_w)//2, 184), title, fill=C_FUR, font=font_title)
            print(f"  title: fs={fs}, actual_w={actual_w}")
            break

    # 副标题
    sub = "智能编程助手"
    bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
    tw2 = bbox2[2] - bbox2[0]
    draw.text(((W-tw2)//2, 200), sub, fill=C_TEXT, font=font_sub)

    # 特性列表
    features = ["双智能体架构", "本地私有部署", "多模型切换", "项目级理解"]
    fy = 222
    dot_r = 3
    for feat in features:
        # 圆点
        draw.ellipse([cx-46, fy+2, cx-46+dot_r*2, fy+2+dot_r*2], fill=C_ACCENT)
        # 文字
        fbbox = draw.textbbox((0, 0), feat, font=font_sub)
        ftw = fbbox[2] - fbbox[0]
        draw.text((cx - 38, fy), feat, fill=C_TEXT, font=font_sub)
        fy += 15

    # 底部分隔线
    draw.line([(18, 290), (W-18, 290)], fill=(50, 50, 55), width=1)

    # 版权
    copy_text = "© 2026 Guanist"
    cbbox = draw.textbbox((0, 0), copy_text, font=font_copy)
    ctw = cbbox[2] - cbbox[0]
    draw.text(((W-ctw)//2, 296), copy_text, fill=C_DIM, font=font_copy)

    # ── 保存 ──
    bmp_path = os.path.join(DST, "installer-sidebar.bmp")
    img_rgb = Image.new("RGB", (W, H), C_BG)
    img_rgb.paste(img, mask=img.split()[3])
    img_rgb.save(bmp_path, "BMP")
    print(f"✓ {bmp_path}")

    png_path = os.path.join(DST, "installer-sidebar.png")
    img.save(png_path, "PNG")
    print(f"✓ {png_path}")


if __name__ == "__main__":
    main()
