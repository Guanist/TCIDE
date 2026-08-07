"""
installer-sidebar-v2.py
高质量虎猫吉祥物侧边图（164×314 BMP）
风格：卡通、圆润、可爱、有生命力
参考 mascot.svg 的配色和构图
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

W, H = 164, 314
C_FUR      = (255, 140, 0)
C_FUR_LT   = (255, 165, 0)
C_FUR_PALE = (255, 200, 120)
C_STRIPE   = (204, 112, 0)
C_EYE      = (45,  80, 22)
C_NOSE     = (255, 107, 107)
C_BLUSH    = (255, 160, 160)
C_WHITE    = (255, 255, 255)
C_BLACK    = (30,  15,  5)
C_BG       = (30,  30,  30)
C_BG2      = (40,  40,  40)
C_ACCENT   = (255, 140, 0)
C_TEXT     = (212, 212, 212)
C_DIM      = (100, 100, 100)

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


# ═══════════════════════════════════════════
# 抗锯齿圆（多次采样）
# ═══════════════════════════════════════════
def aa_circle(draw, cx, cy, r, fill, steps=8):
    """多次采样画圆，消除锯齿"""
    for i in range(steps):
        t = (i + 0.5) / steps
        d = 0.7 + 0.6 * t
        draw.ellipse([cx - r*d, cy - r*d, cx + r*d, cy + r*d],
                     fill=fill)


def aa_ellipse(draw, bbox, fill, steps=6):
    x0, y0, x1, y1 = bbox
    for i in range(steps):
        t = (i + 0.5) / steps
        d = 0.85 + 0.3 * t
        cx, cy = (x0+x1)/2, (y0+y1)/2
        rx, ry = (x1-x0)/2 * d, (y1-y0)/2 * d
        draw.ellipse([cx-rx, cy-ry, cx+rx, cy+ry], fill=fill)


def draw_cat_v2(img):
    """
    绘制 v2 版虎猫 - 更卡通、更可爱
    构图：居中偏上，面向右，编程姿态
    """
    draw = ImageDraw.Draw(img)
    
    # ── 渐变背景 ──
    for y in range(H):
        t = y / H
        r = int(C_BG[0] + (45-30)*t)
        g = int(C_BG[1] + (40-30)*t)
        b = int(C_BG[2] + (35-30)*t)
        draw.line([(0, y), (W, y)], fill=(r, g, b))
    
    # 顶部装饰条纹
    draw.rectangle([0, 0, W, 4], fill=C_FUR)
    for i in range(3):
        y = 6 + i * 5
        alpha = int(60 - i * 15)
        draw.line([(0, y), (W, y)], fill=C_FUR + (alpha,))
    
    # ── 坐标中心 ──
    cx, cy_head = W//2, 118
    
    # ══════════════════════════════════════
    # 身体（椭圆，横向）
    # ══════════════════════════════════════
    body_cx = cx + 5
    body_cy = cy_head + 85
    # 身体主体
    draw.ellipse([body_cx-60, body_cy-45, body_cx+60, body_cy+55],
                  fill=C_FUR)
    # 肚子白色
    draw.ellipse([body_cx-38, body_cy-20, body_cx+38, body_cy+45],
                  fill=C_FUR_PALE)
    # 肚子高光
    draw.ellipse([body_cx-30, body_cy-10, body_cx+28, body_cy+30],
                  fill=(255, 230, 200))
    
    # ══════════════════════════════════════
    # 尾巴（从身体右侧绕到头顶）
    # ══════════════════════════════════════
    # 尾巴路径：从身体右侧出发，向上绕到左侧
    tail_pts = []
    for t in range(21):
        tt = t / 20.0
        # 贝塞尔曲线近似
        bx = body_cx + 55 - 50 * math.sin(tt * math.pi * 0.8)
        by = body_cy + 10 - 130 * tt + 30 * math.sin(tt * math.pi)
        # 加一点摆动
        bx += 8 * math.sin(tt * math.pi * 3)
        tail_pts.append((bx, by))
    
    # 画尾巴（粗线 + 深色条纹）
    for w in range(14, 6, -1):
        alpha = int(255 * (w - 5) / 10)
        c = C_FUR if w > 10 else C_STRIPE
        for i in range(len(tail_pts)-1):
            draw.line([tail_pts[i], tail_pts[i+1]], fill=c, width=w)
    
    # ══════════════════════════════════════
    # 头部（大圆脸）
    # ══════════════════════════════════════
    head_r = 52
    head_bbox = [cx-head_r, cy_head-head_r, cx+head_r, cy_head+head_r]
    # 脸底色
    draw.ellipse(head_bbox, fill=C_FUR)
    # 脸颊白色区域
    cheek_r = 22
    draw.ellipse([cx-42, cy_head+8, cx-42+cheek_r*2, cy_head+8+cheek_r*2],
                  fill=C_FUR_PALE)
    draw.ellipse([cx+42-cheek_r*2, cy_head+8, cx+42, cy_head+8+cheek_r*2],
                  fill=C_FUR_PALE)
    
    # ══════════════════════════════════════
    # 耳朵
    # ══════════════════════════════════════
    # 左耳
    ear_l = [(cx-40, cy_head-44), (cx-58, cy_head-78), (cx-14, cy_head-50)]
    draw.polygon(ear_l, fill=C_FUR)
    ear_l_in = [(cx-34, cy_head-48), (cx-50, cy_head-72), (cx-18, cy_head-50)]
    draw.polygon(ear_l_in, fill=C_FUR_PALE)
    # 右耳
    ear_r = [(cx+40, cy_head-44), (cx+58, cy_head-78), (cx+14, cy_head-50)]
    draw.polygon(ear_r, fill=C_FUR)
    ear_r_in = [(cx+34, cy_head-48), (cx+50, cy_head-72), (cx+18, cy_head-50)]
    draw.polygon(ear_r_in, fill=C_FUR_PALE)
    
    # ══════════════════════════════════════
    # 脸部条纹
    # ══════════════════════════════════════
    # 中间条纹
    draw.line([(cx, cy_head-45), (cx, cy_head-10)], fill=C_STRIPE, width=7)
    # 左条纹
    draw.line([(cx-20, cy_head-40), (cx-18, cy_head-8)], fill=C_STRIPE, width=5)
    # 右条纹
    draw.line([(cx+20, cy_head-40), (cx+18, cy_head-8)], fill=C_STRIPE, width=5)
    
    # ══════════════════════════════════════
    # 眼睛（大圆眼，卡通感）
    # ══════════════════════════════════════
    eye_y = cy_head - 5
    # 左眼白
    draw.ellipse([cx-30, eye_y-16, cx-10, eye_y+12], fill=C_WHITE)
    # 右眼白
    draw.ellipse([cx+10, eye_y-16, cx+30, eye_y+12], fill=C_WHITE)
    # 左虹膜
    draw.ellipse([cx-26, eye_y-10, cx-14, eye_y+10], fill=C_EYE)
    # 右虹膜
    draw.ellipse([cx+14, eye_y-10, cx+26, eye_y+10], fill=C_EYE)
    # 左瞳孔
    draw.ellipse([cx-23, eye_y-5, cx-19, eye_y+5], fill=C_BLACK)
    # 右瞳孔
    draw.ellipse([cx+19, eye_y-5, cx+23, eye_y+5], fill=C_BLACK)
    # 左高光（大+小）
    draw.ellipse([cx-24, eye_y-8, cx-20, eye_y-4], fill=C_WHITE)
    draw.ellipse([cx-22, eye_y-2, cx-20, eye_y], fill=C_WHITE)
    # 右高光
    draw.ellipse([cx+20, eye_y-8, cx+24, eye_y-4], fill=C_WHITE)
    draw.ellipse([cx+22, eye_y-2, cx+24, eye_y], fill=C_WHITE)
    
    # ══════════════════════════════════════
    # 鼻子 + 嘴巴
    # ══════════════════════════════════════
    nose_y = cy_head + 20
    # 鼻子
    draw.ellipse([cx-6, nose_y-3, cx+6, nose_y+4], fill=C_NOSE)
    # 嘴巴（W形微笑）
    draw.arc([cx-14, nose_y+4, cx, nose_y+20], 0, 180, fill=C_BLACK, width=2)
    draw.arc([cx, nose_y+4, cx+14, nose_y+20], 0, 180, fill=C_BLACK, width=2)
    # 舌头
    draw.ellipse([cx-5, nose_y+14, cx+5, nose_y+22], fill=C_NOSE)
    
    # ══════════════════════════════════════
    # 腮红
    # ══════════════════════════════════════
    blush_r = 10
    # 左腮红
    for a in range(3):
        d = a * 3
        draw.ellipse([cx-48-d, cy_head+18-d, cx-48+d+blush_r*2, cy_head+18+d+blush_r*2],
                      fill=C_BLUSH + (50 - a*15,))
    # 右腮红
    for a in range(3):
        d = a * 3
        draw.ellipse([cx+48-d-blush_r*2, cy_head+18-d, cx+48+d, cy_head+18+d+blush_r*2],
                      fill=C_BLUSH + (50 - a*15,))
    
    # ══════════════════════════════════════
    # 胡须（6根，细细的）
    # ══════════════════════════════════════
    whisker_c = (60, 30, 15)
    # 左
    draw.line([(cx-50, cy_head+18), (cx-80, cy_head+8)], fill=whisker_c, width=1)
    draw.line([(cx-50, cy_head+25), (cx-82, cy_head+25)], fill=whisker_c, width=1)
    draw.line([(cx-48, cy_head+32), (cx-78, cy_head+42)], fill=whisker_c, width=1)
    # 右
    draw.line([(cx+50, cy_head+18), (cx+80, cy_head+8)], fill=whisker_c, width=1)
    draw.line([(cx+50, cy_head+25), (cx+82, cy_head+25)], fill=whisker_c, width=1)
    draw.line([(cx+48, cy_head+32), (cx+78, cy_head+42)], fill=whisker_c, width=1)
    
    # ══════════════════════════════════════
    # 前爪（抱着键盘）
    # ══════════════════════════════════════
    # 左爪
    draw.ellipse([body_cx-50, body_cy+30, body_cx-20, body_cy+55], fill=C_FUR)
    draw.ellipse([body_cx-50, body_cy+30, body_cx-20, body_cy+55],
                  outline=C_STRIPE, width=1)
    # 右爪
    draw.ellipse([body_cx+20, body_cy+30, body_cx+50, body_cy+55], fill=C_FUR)
    draw.ellipse([body_cx+20, body_cy+30, body_cx+50, body_cy+55],
                  outline=C_STRIPE, width=1)
    # 肉垫
    draw.ellipse([body_cx-44, body_cy+38, body_cx-36, body_cy+46], fill=C_WHITE)
    draw.ellipse([body_cx+36, body_cy+38, body_cx+44, body_cy+46], fill=C_WHITE)
    
    # ══════════════════════════════════════
    # 键盘（小）
    # ══════════════════════════════════════
    kb_x, kb_y = cx - 32, body_cy + 58
    kb_w, kb_h = 64, 22
    draw.rounded_rectangle([kb_x, kb_y, kb_x+kb_w, kb_y+kb_h],
                           radius=4, fill=(50, 50, 50))
    draw.rounded_rectangle([kb_x, kb_y, kb_x+kb_w, kb_y+kb_h],
                           radius=4, outline=(80, 80, 80), width=1)
    # 按键
    for row in range(2):
        for col in range(5):
            kx = kb_x + 5 + col * 11
            ky = kb_y + 3 + row * 8
            draw.rounded_rectangle([kx, ky, kx+8, ky+5], radius=1, fill=(70, 70, 70))
    # 空格键（橙色）
    draw.rounded_rectangle([kb_x+5, ky+8, kx+5+34, ky+13], radius=1, fill=C_FUR)
    
    # ══════════════════════════════════════
    # 星星装饰
    # ══════════════════════════════════════
    def star(draw, sx, sy, sr, color):
        pts = []
        for i in range(10):
            angle = math.pi/2 + i * math.pi/5
            rad = sr if i % 2 == 0 else sr * 0.4
            pts.append((sx + rad*math.cos(angle), sy - rad*math.sin(angle)))
        draw.polygon(pts, fill=color)
    
    star(draw, 20, 45, 5, (255, 220, 100))
    star(draw, 144, 38, 4, (255, 220, 100))
    star(draw, 14, 95, 3, (255, 240, 180))
    star(draw, 150, 88, 3.5, (255, 240, 180))
    star(draw, 82, 42, 3, (255, 220, 100))
    
    # ══════════════════════════════════════
    # 底部文字
    # ══════════════════════════════════════
    font_title = try_font([
        "C:\\Windows\\Fonts\\msyhbd.ttc",
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
    ], 15)
    font_sub = try_font([
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ], 10)
    
    # 标题
    title = "虎猫 TCIDE"
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text((cx - tw//2, 228), title, fill=C_FUR, font=font_title)
    
    # 副标题
    sub = "智能编程助手"
    bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
    tw2 = bbox2[2] - bbox2[0]
    draw.text((cx - tw2//2, 248), sub, fill=C_TEXT, font=font_sub)
    
    # 特性列表（带小圆点）
    features = ["双智能体架构", "本地私有部署", "多模型切换", "项目级理解"]
    fy = 268
    for feat in features:
        # 小圆点
        draw.ellipse([cx-52, fy+3, cx-46, fy+9], fill=C_FUR)
        # 文字
        bbox3 = draw.textbbox((0, 0), feat, font=font_sub)
        tw3 = bbox3[2] - bbox3[0]
        draw.text((cx - 40, fy), feat, fill=C_TEXT, font=font_sub)
        fy += 16
    
    # 底部版权
    font_copy = try_font(["C:\\Windows\\Fonts\\arial.ttf"], 8)
    copy_text = "© 2026 Guanist"
    bbox4 = draw.textbbox((0, 0), copy_text, font=font_copy)
    tw4 = bbox4[2] - bbox4[0]
    draw.text((cx - tw4//2, H - 18), copy_text, fill=C_DIM, font=font_copy)
    
    return img


if __name__ == "__main__":
    print("生成 installer-sidebar-v2...")
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    img = draw_cat_v2(img)
    
    # 保存 BMP（NSIS 要求）
    bmp_path = os.path.join(DST, "installer-sidebar.bmp")
    img_rgb = Image.new("RGB", (W, H), C_BG)
    img_rgb.paste(img, mask=img.split()[3])
    img_rgb.save(bmp_path, "BMP")
    print(f"  → {bmp_path}")
    
    # 同时保存 PNG
    png_path = os.path.join(DST, "installer-sidebar.png")
    img.save(png_path, "PNG")
    print(f"  → {png_path}")
    
    print("完成！")
