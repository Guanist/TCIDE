# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""把 CI 构建出来的渲染层产物同步进 `web/`（并做两件必须做的事）。

为什么需要这个工具：本机**构建不了前端**（仓库外两层有个损坏的 package.json 挡住
esbuild），所以流程是"改源码 → CI 构建 → 下载产物 → 同步进 web/"。这件事我手工做过
三次，每次都要记得三件容易忘的事，索性固化下来：

1. **清理被取代的旧产物**：同步只复制不删除，新旧 `index-*.{js,css}` 会并存 ——
   验证脚本会因此**看错文件**（我踩过：拿旧 CSS 断言，得出错误结论）。
   只删 `index-*` / `vendor-*` / `p0|p1|p2-*` 里不被新首页引用的，其余（手写的
   `electron-shim.js`、宠物素材、图标）一律不动。
2. **注入覆盖层皮肤到 bundle 之后**：源码里的 `<link>` 会排在 vite 追加的标签**之前**
   而被压过，所以必须在**产物**里注入到 `</head>` 前。
3. **复核**：打印新首页引用的 CSS 里主题变量与浅色主题块的数量，让结果一眼可查。

用法：``python tools/sync_frontend.py --from <产物目录> [--dry-run]``
"""

from __future__ import annotations

import argparse
import pathlib
import re
import shutil
import sys

sys.stdout.reconfigure(line_buffering=True)
ROOT = pathlib.Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
SKIN_CSS = '<link rel="stylesheet" href="/static/tcide-theme.css" />'
BUILD_NAME = re.compile(r"^(?:index|vendor|p\d)-")


def clean_stale(referenced: set[str], dry: bool) -> list[str]:
    assets = WEB / "assets"
    if not assets.is_dir():
        return []
    removed: list[str] = []
    for path in sorted(assets.glob("*")):
        if not path.is_file() or not BUILD_NAME.match(path.name):
            continue
        if path.name in referenced:
            continue
        if dry:
            removed.append(path.name + "（dry-run）")
            continue
        path.unlink()
        removed.append(path.name)
    return removed


def inject_skin(index: pathlib.Path, dry: bool) -> str:
    text = index.read_text(encoding="utf-8")
    text = text.replace(SKIN_CSS, "")           # 先去掉旧的，避免重复
    if text.count("</head>") != 1:
        return "★ 产物 index.html 的 </head> 不唯一，未注入"
    if not dry:
        index.write_text(text.replace("</head>", SKIN_CSS + "</head>", 1),
                         encoding="utf-8", newline="")
    return "✓ 覆盖层已注入到 </head> 前（位于 vite 标签之后）"


def main() -> int:
    parser = argparse.ArgumentParser(description="同步前端产物到 web/")
    parser.add_argument("--from", dest="source", required=True, help="产物目录")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force", action="store_true",
                        help="即使产物提交与 HEAD 不一致也同步")
    args = parser.parse_args()

    source = pathlib.Path(args.source)
    if not (source / "index.html").is_file():
        print(f"★ {source} 里没有 index.html（不是渲染层产物？）")
        return 1

    # 防呆：产物里的 COMMIT 必须与本地 HEAD 一致。
    # 起因是我用"最近一次成功的构建"下载到了**更早提交**的产物，把旧代码同步回了
    # web/（旧 bundle 里还有已经撤掉的界面内宠物）。这种事不该靠记性避免。
    stamp = source / "COMMIT"
    if stamp.is_file() and not args.force:
        built = stamp.read_text(encoding="utf-8").strip()
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(ROOT),
                              capture_output=True, text=True).stdout.strip()
        if built and head and built != head:
            print(f"★ 拒绝同步：产物来自提交 {built[:7]}，而本地 HEAD 是 {head[:7]}")
            print("  （对不上说明下错了产物。确认要同步就加 --force。）")
            return 1
        print(f"  ✓ 产物提交与 HEAD 一致（{built[:7]}）")
    elif not stamp.is_file():
        print("  · 产物里没有 COMMIT 文件（旧构建），无法核对提交号")

    # 1) 以**新产物**的首页为准，算出被引用的资源
    new_index = (source / "index.html").read_text(encoding="utf-8")
    referenced = set(re.findall(r'\./assets/([A-Za-z0-9._-]+\.(?:js|css))', new_index))
    print(f"=== 1) 新产物首页引用 {len(referenced)} 个资源 ===")

    # 2) 同步文件
    copied = 0
    for item in source.rglob("*"):
        if not item.is_file():
            continue
        target = WEB / item.relative_to(source)
        if args.dry_run:
            copied += 1
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(item, target)
        copied += 1
    print(f"=== 2) {'（dry-run）将' if args.dry_run else ''}同步 {copied} 个文件到 web/ ===")

    # 3) 清理被取代的旧产物
    removed = clean_stale(referenced, args.dry_run)
    for name in removed:
        print(f"  ✓ 删除被取代的旧产物：{name}")
    if not removed:
        print("  · 没有需要清理的旧产物")

    # 4) 注入覆盖层皮肤
    print("=== 3) 注入覆盖层皮肤 ===")
    print("  " + inject_skin(WEB / "index.html", args.dry_run))

    # 5) 复核
    print("=== 4) 复核（新首页引用的 CSS 里的主题内容）===")
    for name in sorted(referenced):
        if not name.endswith(".css"):
            continue
        path = WEB / "assets" / name
        if not path.is_file():
            print(f"  ★ 缺文件：{name}")
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        print(f"  {name}: --bg-primary={text.count('--bg-primary')} "
              f"light-theme={text.count('data-tcide-theme')}")
    left = [item.name for item in (WEB / "assets").glob("*")
            if item.is_file() and BUILD_NAME.match(item.name)
            and item.name not in referenced]
    print(f"  未被引用的构建产物：{left or '无 ✓'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
