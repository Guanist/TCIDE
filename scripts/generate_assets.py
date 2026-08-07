"""
TCIDE 虎猫视觉素材生成器
基于 mascot.svg 的配色体系，生成全套 PNG/BMP 资产
风格：可爱、活力、有生命力，拒绝冷冰冰的工具感
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(OUT, "resources")
BRAND = os.path.join(RES, "brand")
ICONS = os.path.join(RES, "icons")
os.makedirs(BRAND, exist_ok=True)
os.makedirs(ICONS, exist_ok=True)

# ═══════════════════════════════════════════
# 虎猫配色体系
# ═══════════════════════════════════════════
C_FUR      = (255, 140, 0)    # #FF8C00 主橙
C_FUR_LT   = (255, 165, 0)    # #FFA500 亮橙
C_FUR_PALE = (255, 179, 71)   # #FFB347 浅橙
C_STRIPE   = (204, 112, 0)    # #CC7000 条纹深橙
C_EYE      = (45,  80,  22)   # #2D5016 眼睛绿
C_NOSE     = (255, 107, 107)  # #FF6B6B 鼻子粉
C_BLUSH    = (255, 150, 150)  # 腮红
C_WHITE    = (255, 255, 255)
C_BG       = (30,  30,  30)   # #1E1E1E 深色背景
C_BG_MID   = (45,  45,  45)   # #2D2D2D
C_CODE     = (61,  61,  61)   # #3D3D3D
C_TEXT     = (212, 212, 212)  # #D4D4D4
C_ACCENT   = (255, 140, 0)

# 语言配色
LANG_COLORS = {
    'kt':     (127, 61, 255),  # Kotlin 紫
    'java':   (237, 139, 0),   # Java 橙
    'py':     (55, 118, 171),  # Python 蓝
    'ts':     (49, 120, 198),  # TypeScript 蓝
    'js':     (247, 223, 30),  # JavaScript 黄
    'json':   (240, 200, 0),   # JSON 金
    'md':     (97, 175, 239),  # Markdown 蓝
    'xml':    (0, 87, 155),    # XML 深蓝
    'gradle': (2, 54, 100),    # Gradle 深蓝
    'go':     (0, 173, 216),   # Go 青
    'rs':     (222, 165, 132), # Rust 棕
    'sh':     (78, 201, 71),   # Shell 绿
    'html':   (228, 77, 38),   # HTML 橙红
    'css':    (38, 77, 228),   # CSS 蓝
    'default':(150, 150, 150), # 默认灰
}
LANG_LABELS = {
    'kt': 'KT', 'java': 'JV', 'py': 'PY', 'ts': 'TS', 'js': 'JS',
    'json': '{ }', 'md': 'MD', 'xml': '<>', 'gradle': 'GR',
    'go': 'GO', 'rs': 'RS', 'sh': 'SH', 'html': '</>', 'css': '#',
    'default': '?'
}


def try_font(size=16):
    """尝试加载中文字体"""
    candidates = [
        "C:\\Windows\\Fonts\\msyh.ttc",
        "C:\\Windows\\Fonts\\simhei.ttf",
        "C:\\Windows\\Fonts\\simsun.ttc",
        "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for fp in candidates:
        if os.path.exists(fp):
            try:
                return ImageFont.truetype(fp, size)
            except Exception:
                continue
    return ImageFont.load_default()


# ═══════════════════════════════════════════
# 可爱虎猫吉祥物绘制
# ═══════════════════════════════════════════
def draw_cat_face(draw, cx, cy, scale=1.0, expression="happy"):
    """绘制可爱虎猫脸部"""
    s = scale
    
    # 耳朵
    ear_y = cy - 38*s
    # 左耳
    draw.polygon([
        (cx - 28*s, ear_y), (cx - 38*s, ear_y - 30*s), (cx - 12*s, ear_y + 5*s)
    ], fill=C_FUR)
    draw.polygon([
        (cx - 24*s, ear_y + 2), (cx - 33*s, ear_y - 22*s), (cx - 16*s, ear_y + 5*s)
    ], fill=C_FUR_PALE)
    # 右耳
    draw.polygon([
        (cx + 28*s, ear_y), (cx + 38*s, ear_y - 30*s), (cx + 12*s, ear_y + 5*s)
    ], fill=C_FUR)
    draw.polygon([
        (cx + 24*s, ear_y + 2), (cx + 33*s, ear_y - 22*s), (cx + 16*s, ear_y + 5*s)
    ], fill=C_FUR_PALE)
    
    # 脸 - 大圆脸 (chibi风格)
    face_r = 40*s
    draw.ellipse([
        cx - face_r, cy - face_r, cx + face_r, cy + face_r
    ], fill=C_FUR)
    
    # 脸颊白色区域
    cheek_r = 18*s
    draw.ellipse([
        cx - 30*s, cy + 5*s, cx - 30*s + cheek_r*2, cy + 5*s + cheek_r*2
    ], fill=(255, 240, 220))
    draw.ellipse([
        cx + 30*s - cheek_r*2, cy + 5*s, cx + 30*s, cy + 5*s + cheek_r*2
    ], fill=(255, 240, 220))
    
    # 条纹
    stripe_w = 6*s
    draw.line([(cx, cy - 35*s), (cx, cy - 8*s)], fill=C_STRIPE, width=int(stripe_w))
    draw.line([(cx - 18*s, cy - 30*s), (cx - 16*s, cy - 5*s)], fill=C_STRIPE, width=int(stripe_w * 0.7))
    draw.line([(cx + 18*s, cy - 30*s), (cx + 16*s, cy - 5*s)], fill=C_STRIPE, width=int(stripe_w * 0.7))
    
    # 眼睛
    eye_w, eye_h = 14*s, 16*s
    # 白眼
    draw.ellipse([cx - 22*s, cy - 8*s, cx - 22*s + eye_w, cy - 8*s + eye_h], fill=C_WHITE)
    draw.ellipse([cx + 8*s, cy - 8*s, cx + 8*s + eye_w, cy - 8*s + eye_h], fill=C_WHITE)
    
    # 虹膜
    iris_r = 8*s
    draw.ellipse([cx - 18*s, cy - 3*s, cx - 18*s + iris_r*2, cy - 3*s + iris_r*2], fill=C_EYE)
    draw.ellipse([cx + 10*s, cy - 3*s, cx + 10*s + iris_r*2, cy - 3*s + iris_r*2], fill=C_EYE)
    
    # 高光
    hl_r = 3*s
    draw.ellipse([cx - 16*s, cy - 2*s, cx - 16*s + hl_r*2, cy - 2*s + hl_r*2], fill=C_WHITE)
    draw.ellipse([cx + 12*s, cy - 2*s, cx + 12*s + hl_r*2, cy - 2*s + hl_r*2], fill=C_WHITE)
    hl_r2 = 1.5*s
    draw.ellipse([cx - 20*s, cy + 2*s, cx - 20*s + hl_r2*2, cy + 2*s + hl_r2*2], fill=C_WHITE)
    draw.ellipse([cx + 17*s, cy + 2*s, cx + 17*s + hl_r2*2, cy + 2*s + hl_r2*2], fill=C_WHITE)
    
    # 鼻子
    nose_y = cy + 12*s
    draw.ellipse([cx - 5*s, nose_y - 3*s, cx + 5*s, nose_y + 3*s], fill=C_NOSE)
    
    # 嘴巴 - 根据表情变化
    if expression == "happy":
        draw.arc([cx - 12*s, nose_y + 2*s, cx, nose_y + 14*s], 0, 180, fill=(80, 40, 20), width=max(2, int(2*s)))
        draw.arc([cx, nose_y + 2*s, cx + 12*s, nose_y + 14*s], 0, 180, fill=(80, 40, 20), width=max(2, int(2*s)))
    elif expression == "thinking":
        # 歪嘴
        draw.arc([cx - 4*s, nose_y + 2*s, cx + 8*s, nose_y + 14*s], 0, 180, fill=(80, 40, 20), width=max(2, int(2*s)))
    elif expression == "working":
        # 认真的小嘴
        draw.ellipse([cx - 4*s, nose_y + 3*s, cx + 4*s, nose_y + 9*s], fill=(100, 50, 30))
    elif expression == "done":
        # 开心大嘴
        draw.arc([cx - 15*s, nose_y + 0, cx + 15*s, nose_y + 18*s], 0, 180, fill=(80, 40, 20), width=max(2, int(2.5*s)))
    
    # 腮红
    blush_r = 7*s
    draw.ellipse([cx - 32*s, cy + 8*s, cx - 32*s + blush_r*2, cy + 8*s + blush_r*2], fill=C_BLUSH)
    draw.ellipse([cx + 32*s - blush_r*2, cy + 8*s, cx + 32*s, cy + 8*s + blush_r*2], fill=C_BLUSH)
    
    # 胡须
    whisker_color = (60, 30, 15)
    ww = int(1.5*s)
    # 左
    draw.line([(cx - 38*s, cy + 12*s), (cx - 60*s, cy + 5*s)], fill=whisker_color, width=ww)
    draw.line([(cx - 38*s, cy + 18*s), (cx - 60*s, cy + 18*s)], fill=whisker_color, width=ww)
    draw.line([(cx - 38*s, cy + 24*s), (cx - 58*s, cy + 32*s)], fill=whisker_color, width=ww)
    # 右
    draw.line([(cx + 38*s, cy + 12*s), (cx + 60*s, cy + 5*s)], fill=whisker_color, width=ww)
    draw.line([(cx + 38*s, cy + 18*s), (cx + 60*s, cy + 18*s)], fill=whisker_color, width=ww)
    draw.line([(cx + 38*s, cy + 24*s), (cx + 58*s, cy + 32*s)], fill=whisker_color, width=ww)


def draw_cat_body(draw, cx, cy, scale=1.0):
    """绘制身体"""
    s = scale
    body_h = 50*s
    body_w = 55*s
    draw.ellipse([cx - body_w, cy - 10*s, cx + body_w, cy + body_h], fill=C_FUR)
    
    # 肚子白色
    draw.ellipse([cx - 25*s, cy + 5*s, cx + 25*s, cy + body_h - 5*s], fill=(255, 240, 220))
    
    # 前爪
    paw_w, paw_h = 14*s, 10*s
    draw.ellipse([cx - 40*s, cy + 30*s, cx - 40*s + paw_w*2, cy + 30*s + paw_h*2], fill=C_FUR)
    draw.ellipse([cx + 40*s - paw_w*2, cy + 30*s, cx + 40*s, cy + 30*s + paw_h*2], fill=C_FUR)
    # 肉垫
    pad_r = 4*s
    draw.ellipse([cx - 34*s, cy + 34*s, cx - 34*s + pad_r*2, cy + 34*s + pad_r*2], fill=C_WHITE)
    draw.ellipse([cx + 34*s - pad_r*2, cy + 34*s, cx + 34*s, cy + 34*s + pad_r*2], fill=C_WHITE)


def draw_cat_tail(draw, cx, cy, scale=1.0):
    """绘制尾巴"""
    s = scale
    tail_pts = [
        (cx + 50*s, cy + 10*s),
        (cx + 75*s, cy - 5*s),
        (cx + 85*s, cy - 20*s),
        (cx + 80*s, cy - 35*s),
        (cx + 65*s, cy - 40*s),
        (cx + 55*s, cy - 30*s),
    ]
    # 尾巴主体
    tail_w = int(12*s)
    for i in range(len(tail_pts) - 1):
        draw.line([tail_pts[i], tail_pts[i+1]], fill=C_FUR, width=tail_w)
    # 尾巴尖端
    draw.line([tail_pts[-2], tail_pts[-1]], fill=C_STRIPE, width=tail_w)


def draw_cat_prop(draw, cx, cy, prop="keyboard", scale=1.0):
    """绘制道具"""
    s = scale
    if prop == "keyboard":
        # 小键盘
        kb_w, kb_h = 70*s, 28*s
        draw.rounded_rectangle(
            [cx - kb_w//2, cy - kb_h//2, cx + kb_w//2, cy + kb_h//2],
            radius=int(5*s), fill=C_BG_MID, outline=C_CODE, width=1
        )
        # 按键
        key_w, key_h = 8*s, 5*s
        for row in range(3):
            for col in range(6):
                kx = cx - kb_w//2 + 6*s + col * (key_w + 2*s)
                ky = cy - kb_h//2 + 6*s + row * (key_h + 3*s)
                color = C_FUR if (row == 2 and col == 3) else C_CODE
                draw.rounded_rectangle(
                    [kx, ky, kx + key_w, ky + key_h],
                    radius=int(1.5*s), fill=color
                )
    elif prop == "sparkles":
        # 周围的小星星
        for (sx, sy, sr) in [(cx-50*s, cy-50*s, 6*s), (cx+55*s, cy-45*s, 4*s),
                              (cx-45*s, cy+55*s, 5*s), (cx+50*s, cy+50*s, 7*s)]:
            star_color = (255, 220, 100)
            draw_star(draw, sx, sy, sr, star_color)


def draw_star(draw, cx, cy, r, color):
    """绘制小星星"""
    pts = []
    for i in range(10):
        angle = math.pi / 2 + i * math.pi / 5
        rad = r if i % 2 == 0 else r * 0.4
        pts.append((cx + rad * math.cos(angle), cy - rad * math.sin(angle)))
    draw.polygon(pts, fill=color)


# ═══════════════════════════════════════════
# 1. 安装向导侧边图 (164×314 BMP)
# ═══════════════════════════════════════════
def generate_installer_sidebar():
    w, h = 164, 314
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font = try_font(14)
    font_sm = try_font(10)
    
    # 渐变背景
    for y in range(h):
        t = y / h
        r = int(C_BG[0] * (1-t) + 40*t)
        g = int(C_BG[1] * (1-t) + 35*t)
        b = int(C_BG[2] * (1-t) + 30*t)
        draw.line([(0, y), (w, y)], fill=(r, g, b))
    
    # 顶部装饰条
    draw.rectangle([0, 0, w, 4], fill=C_FUR)
    
    # 中心吉祥物
    cat_cx, cat_cy = w//2, 135
    draw_cat_face(draw, cat_cx, cat_cy, scale=1.0, expression="happy")
    
    # 星星装饰
    for (sx, sy, sr) in [(30, 40, 4), (135, 35, 5), (20, 90, 3), (145, 100, 4)]:
        draw_star(draw, sx, sy, sr, (255, 220, 100))
    
    # 文字
    text_y = 200
    draw.text((w//2 - 30, text_y), "虎猫 TCIDE", fill=C_FUR, font=font)
    draw.text((w//2 - 42, text_y + 24), "智能编程助手", fill=C_TEXT, font=font_sm)
    
    # 特性列表
    features = ["✨ 双智能体架构", "🚀 本地私有部署", "🎯 项目级理解", "💡 多模型切换"]
    fy = text_y + 55
    for feat in features:
        draw.text((w//2 - 44, fy), feat, fill=C_TEXT, font=font_sm)
        fy += 18
    
    # 底部品牌
    draw.text((w//2 - 24, h - 24), "© 2026 Guanist", fill=(100, 100, 100), font=font_sm)
    
    # 保存为 BMP (electron-builder 要求 BMP)
    bmp_path = os.path.join(RES, "installer-sidebar.bmp")
    # Pillow 的 BMP 默认不保存 alpha，转 RGB
    img_rgb = Image.new("RGB", (w, h), (30, 30, 30))
    img_rgb.paste(img, mask=img.split()[3])
    img_rgb.save(bmp_path, "BMP")
    print(f"✓ installer-sidebar.bmp ({w}×{h})")
    
    # 同时保存 PNG 版本
    img.save(os.path.join(RES, "installer-sidebar.png"), "PNG")


# ═══════════════════════════════════════════
# 2. 文件类型图标 (32×32 PNG, @2x 64×64)
# ═══════════════════════════════════════════
def generate_file_icons():
    sizes = [(32, 32, ""), (64, 64, "@2x")]
    
    for size, _, suffix in sizes:
        icon_dir = os.path.join(ICONS, f"file{suffix}")
        os.makedirs(icon_dir, exist_ok=True)
        
        for lang, color in LANG_COLORS.items():
            img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            r = size // 8  # 圆角
            
            # 背景圆角矩形
            draw.rounded_rectangle([1, 1, size-1, size-1], radius=r, fill=color)
            
            # 标签
            label = LANG_LABELS.get(lang, "?")
            font_size = size // 3
            try:
                f = ImageFont.truetype("C:\\Windows\\Fonts\\consola.ttf", font_size)
            except:
                f = ImageFont.load_default()
            
            bbox = draw.textbbox((0, 0), label, font=f)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            tx = (size - tw) // 2
            ty = (size - th) // 2
            draw.text((tx, ty), label, fill=C_WHITE, font=f)
            
            path = os.path.join(icon_dir, f"file-{lang}.png")
            img.save(path, "PNG")
        
        # 文件夹图标
        folder_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        fd = ImageDraw.Draw(folder_img)
        # 文件夹主体
        fd.rounded_rectangle([2, size//4, size-2, size-2], radius=size//12, fill=C_FUR_PALE)
        # 文件夹标签
        fd.rounded_rectangle([2, size//4, size//2+4, size//4+size//5], radius=size//12, fill=C_FUR)
        folder_img.save(os.path.join(icon_dir, "folder.png"), "PNG")
        
        # 文件夹打开
        folder_open = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        fod = ImageDraw.Draw(folder_open)
        fod.rounded_rectangle([2, size//4, size-2, size-2], radius=size//12, fill=C_FUR_PALE)
        fod.rounded_rectangle([2, size//4, size//2+4, size//4+size//5], radius=size//12, fill=C_FUR)
        # 开口
        fod.polygon([(size//2-4, size//4+2), (size//2+8, size//4-4), (size//2+8, size//4+size//5)], fill=C_FUR)
        folder_open.save(os.path.join(icon_dir, "folder-open.png"), "PNG")
        
        print(f"✓ {len(LANG_COLORS)} file icons + folder ({size}×{size})")


# ═══════════════════════════════════════════
# 3. 工具栏图标 (24×24 + 48×48 @2x)
# ═══════════════════════════════════════════
def generate_toolbar_icons():
    sizes = [(24, 24, ""), (48, 48, "@2x")]
    
    icons_def = {
        "new-file":    ("+", (100, 200, 100)),
        "new-folder":  ("📁", C_FUR_PALE),
        "search":      ("🔍", C_TEXT),
        "settings":    ("⚙", C_TEXT),
        "git-branch":  ("⎇", (240, 140, 50)),
        "terminal":    (">_", (100, 200, 100)),
        "refresh":     ("↻", (100, 160, 220)),
        "close":       ("×", (200, 80, 80)),
        "send":        ("➤", C_FUR),
        "stop":        ("■", (200, 80, 80)),
        "attach":      ("📎", C_TEXT),
    }
    
    for size, _, suffix in sizes:
        icon_dir = os.path.join(ICONS, f"toolbar{suffix}")
        os.makedirs(icon_dir, exist_ok=True)
        
        for name, (text, color) in icons_def.items():
            img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            draw = ImageDraw.Draw(img)
            
            # 圆形背景
            margin = size // 8
            r = size // 2 - margin
            draw.ellipse([margin, margin, size - margin, size - margin], fill=color + (40,))
            
            # 图标文字
            font_size = size // 2
            try:
                f = ImageFont.truetype("C:\\Windows\\Fonts\\seguiemj.ttf", font_size)
            except:
                try:
                    f = ImageFont.truetype("C:\\Windows\\Fonts\\segoeui.ttf", font_size)
                except:
                    f = ImageFont.load_default()
            
            bbox = draw.textbbox((0, 0), text, font=f)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            tx = (size - tw) // 2
            ty = (size - th) // 2
            draw.text((tx, ty), text, fill=color, font=f)
            
            path = os.path.join(icon_dir, f"{name}.png")
            img.save(path, "PNG")
        
        print(f"✓ {len(icons_def)} toolbar icons ({size}×{size})")


# ═══════════════════════════════════════════
# 4. 欢迎页插图 (600×400 PNG)
# ═══════════════════════════════════════════
def generate_welcome_illustration():
    w, h = 600, 400
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    font_title = try_font(28)
    font_sub = try_font(14)
    
    # 背景圆
    draw.ellipse([w//2 - 180, 30, w//2 + 180, 390], fill=C_BG + (15,))
    draw.ellipse([w//2 - 140, 70, w//2 + 140, 350], fill=C_BG + (25,))
    
    # 中心吉祥物 (大)
    cat_cx, cat_cy = w//2, 180
    draw_cat_face(draw, cat_cx, cat_cy, scale=2.0, expression="happy")
    draw_cat_prop(draw, cat_cx, cat_cy + 100, prop="sparkles", scale=1.5)
    
    # 标题
    title = "虎猫 TCIDE"
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text((w//2 - tw//2, 290), title, fill=C_FUR, font=font_title)
    
    # 副标题
    sub = "你的可爱AI编程伙伴 🐱"
    bbox2 = draw.textbbox((0, 0), sub, font=font_sub)
    tw2 = bbox2[2] - bbox2[0]
    draw.text((w//2 - tw2//2, 330), sub, fill=C_TEXT, font=font_sub)
    
    path = os.path.join(BRAND, "welcome-illustration.png")
    img.save(path, "PNG")
    print(f"✓ welcome-illustration.png ({w}×{h})")


# ═══════════════════════════════════════════
# 5. 吉祥物表情变体 (128×128 PNG)
# ═══════════════════════════════════════════
def generate_mascot_emotions():
    size = 128
    expressions = {
        "happy":    "开心",
        "thinking": "思考中",
        "working":  "工作中",
        "done":     "完成啦",
        "sleeping": "休息中",
    }
    
    for expr, name in expressions.items():
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        cx, cy = size//2, size//2
        
        if expr == "sleeping":
            # 睡觉：闭眼
            draw_cat_face(draw, cx, cy, scale=1.3, expression="done")
            # 覆盖闭眼
            draw.rectangle([cx - 25, cy - 15, cx + 25, cy + 5], fill=C_FUR)
            draw.line([(cx - 20, cy - 2), (cx + 5, cy - 2)], fill=(40, 20, 10), width=3)
            draw.line([(cx + 20, cy - 2), (cx + 5, cy - 2)], fill=(40, 20, 10), width=3)
            # Zzz
            try:
                fz = ImageFont.truetype("C:\\Windows\\Fonts\\arial.ttf", 14)
            except:
                fz = ImageFont.load_default()
            draw.text((cx + 35, cy - 40), "Z", fill=C_TEXT, font=fz)
            draw.text((cx + 45, cy - 55), "z", fill=(150, 150, 150), font=fz)
            draw.text((cx + 52, cy - 67), "z", fill=(100, 100, 100), font=fz)
        else:
            draw_cat_face(draw, cx, cy, scale=1.3, expression=expr)
        
        path = os.path.join(BRAND, f"mascot-{expr}.png")
        img.save(path, "PNG")
    
    print(f"✓ {len(expressions)} mascot emotions ({size}×{size})")


# ═══════════════════════════════════════════
# 6. 空状态插图 (320×200 PNG)
# ═══════════════════════════════════════════
def generate_empty_states():
    w, h = 320, 200
    
    states = {
        "empty-files": ("还没有文件哦~", "打开一个项目开始编码吧"),
        "empty-search": ("什么都没找到 😿", "试试换个关键词"),
        "empty-chat": ("开始对话吧！", "选中代码右键使用 AI 功能"),
        "empty-tasks": ("没有运行中的任务", "使用 /task 启动智能任务"),
    }
    
    for name, (title, desc) in states.items():
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        font_t = try_font(16)
        font_d = try_font(12)
        
        # 小吉祥物
        draw_cat_face(draw, w//2, 70, scale=0.8, expression="thinking" if "search" in name else "happy")
        
        # 标题
        bbox = draw.textbbox((0, 0), title, font=font_t)
        tw = bbox[2] - bbox[0]
        draw.text((w//2 - tw//2, 130), title, fill=C_TEXT, font=font_t)
        
        # 描述
        bbox2 = draw.textbbox((0, 0), desc, font=font_d)
        tw2 = bbox2[2] - bbox2[0]
        draw.text((w//2 - tw2//2, 155), desc, fill=(130, 130, 130), font=font_d)
        
        path = os.path.join(BRAND, f"{name}.png")
        img.save(path, "PNG")
    
    print(f"✓ {len(states)} empty state illustrations ({w}×{h})")


# ═══════════════════════════════════════════
# 7. About 对话框图标 (256×256 PNG)
# ═══════════════════════════════════════════
def generate_about_icon():
    size = 256
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 圆角背景
    draw.rounded_rectangle([4, 4, size-4, size-4], radius=32, fill=C_BG)
    
    # 渐变装饰圈
    for i in range(10):
        r = 100 - i * 8
        alpha = 30 - i * 3
        draw.ellipse([size//2 - r, size//2 - r, size//2 + r, size//2 + r],
                     fill=C_FUR + (alpha,))
    
    # 吉祥物
    draw_cat_face(draw, size//2, size//2 - 10, scale=1.8, expression="happy")
    
    path = os.path.join(RES, "about-icon-new.png")
    img.save(path, "PNG")
    print(f"✓ about-icon-new.png ({size}×{size})")


# ═══════════════════════════════════════════
# 8. 品牌背景纹理 (用于欢迎页 CSS)
# ═══════════════════════════════════════════
def generate_brand_texture():
    """生成品牌纹理，用于 CSS background"""
    size = 200
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # 散布小猫爪印
    paws = [
        (30, 40, 0), (120, 80, 45), (60, 140, 15),
        (150, 30, 30), (90, 170, 60), (170, 110, 20),
        (40, 160, 50), (140, 150, 10),
    ]
    for px, py, angle in paws:
        # 小圆点 (爪印)
        r = 4
        draw.ellipse([px - r, py - r, px + r, py + r], fill=C_FUR + (40,))
        # 三个小趾
        for da in [-15, 0, 15]:
            rad = math.radians(angle + da)
            tx = px + 8 * math.cos(rad)
            ty = py - 8 * math.sin(rad)
            draw.ellipse([tx - 3, ty - 3, tx + 3, ty + 3], fill=C_FUR + (30,))
    
    path = os.path.join(BRAND, "brand-texture.png")
    img.save(path, "PNG")
    print(f"✓ brand-texture.png ({size}×{size})")


# ═══════════════════════════════════════════
# 9. 欢迎页快速操作图标 (64×64 PNG)
# ═══════════════════════════════════════════
def generate_quick_action_icons():
    size = 64
    
    actions = {
        "open-project": ("📂", C_FUR),
        "new-project":  ("✨", (100, 200, 100)),
        "ai-chat":      ("💬", (100, 160, 220)),
        "settings":     ("⚙", C_TEXT),
    }
    
    for name, (emoji, color) in actions.items():
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 圆角方形背景
        r = size // 8
        draw.rounded_rectangle([2, 2, size-2, size-2], radius=r, fill=color + (30,))
        draw.rounded_rectangle([2, 2, size-2, size-2], radius=r, outline=color + (80,), width=1)
        
        # Emoji 作为图标
        try:
            f = ImageFont.truetype("C:\\Windows\\Fonts\\seguiemj.ttf", 28)
        except:
            f = ImageFont.load_default()
        
        bbox = draw.textbbox((0, 0), emoji, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        draw.text(((size - tw)//2, (size - th)//2 - 2), emoji, font=f, embedded_color=True)
        
        path = os.path.join(BRAND, f"action-{name}.png")
        img.save(path, "PNG")
    
    print(f"✓ {len(actions)} quick action icons ({size}×{size})")


# ═══════════════════════════════════════════
# 10. 窗口标题栏图标 (16×16, 32×32)
# ═══════════════════════════════════════════
def generate_titlebar_icons():
    for size in [16, 32]:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # 简化版虎猫头
        s = size / 32
        cx, cy = size // 2, size // 2 + 2
        r = size // 2 - 2
        
        # 头
        draw.ellipse([cx - r, cy - r + 1, cx + r, cy + r], fill=C_FUR)
        # 耳朵
        draw.polygon([(cx - 10*s, cy - 10*s), (cx - 14*s, cy - 18*s), (cx - 4*s, cy - 8*s)], fill=C_FUR)
        draw.polygon([(cx + 10*s, cy - 10*s), (cx + 14*s, cy - 18*s), (cx + 4*s, cy - 8*s)], fill=C_FUR)
        # 眼睛
        er = 3*s
        draw.ellipse([cx - 6*s, cy - 3*s, cx - 6*s + er*2, cy - 3*s + er*2], fill=C_EYE)
        draw.ellipse([cx + 6*s - er*2, cy - 3*s, cx + 6*s, cy - 3*s + er*2], fill=C_EYE)
        # 鼻子
        nr = 1.5*s
        draw.ellipse([cx - nr, cy + 2*s, cx + nr, cy + 2*s + nr*2], fill=C_NOSE)
        
        path = os.path.join(ICONS, f"titlebar-{size}.png")
        img.save(path, "PNG")
    
    print(f"✓ titlebar icons (16×16, 32×32)")


# ═══════════════════════════════════════════
# 主函数
# ═══════════════════════════════════════════
if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print("🐱 虎猫 TCIDE 视觉素材生成器")
    print("=" * 50)
    
    generate_installer_sidebar()
    generate_file_icons()
    generate_toolbar_icons()
    generate_welcome_illustration()
    generate_mascot_emotions()
    generate_empty_states()
    generate_about_icon()
    generate_brand_texture()
    generate_quick_action_icons()
    generate_titlebar_icons()
    
    print("=" * 50)
    print("✅ 全部素材生成完成！")
