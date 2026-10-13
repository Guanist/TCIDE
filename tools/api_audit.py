# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""接口对账：前端真正请求的 `/api/...` vs 后端真的实现了的路由。

为什么用这个方法找"功能不完善"：这个仓库的前端是原 Electron 渲染层用 Vite
构建出来的产物（`web/assets/index-*.js`），它会把后端当成 Electron IPC 的替身来调。
所以**前端调用但后端没有的接口 = 界面上坏掉的功能**，而且这是可枚举、可验证的，
不需要靠猜。

用法::

    python tools/api_audit.py            # 在仓库根目录跑
"""

from __future__ import annotations

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

#: 后端路由声明：既可能在 server.py（``@app.get(...)``），
#: 也可能在 api/*.py（``@router.get(...)``，由 include_router 注册）
ROUTE_RE = re.compile(r"""@(?:app|router)\.(get|post|put|delete|patch)\(\s*["']([^"']+)["']""")

#: 前端里出现的接口字面量："/api/xxx" 或 `/api/xxx?y=${...}`
CALL_RE = re.compile(r"""["'`](/api/[A-Za-z0-9_\-/{}$.]*)""")


def normalize(path: str) -> str:
    """把路径参数统一成 ``{}``，便于比较。"""
    path = path.split("?")[0].split("${")[0]
    path = re.sub(r"\{[^}]*\}", "{}", path)
    path = re.sub(r"\$\{[^}]*\}", "{}", path)
    return path.rstrip("/") or "/"


def backend_routes() -> dict[str, set[str]]:
    """后端所有已注册的路由。

    **必须扫全部 Python 文件**：只扫 ``server.py`` 会漏掉通过 ``include_router``
    注册的路由（第一版就是这样，于是"缺失接口"数一直停在 42，看不到修复进展）。
    """
    routes: dict[str, set[str]] = {}
    sources = [ROOT / "server.py", *sorted((ROOT / "api").glob("*.py"))]
    for source in sources:
        if not source.is_file():
            continue
        text = source.read_text(encoding="utf-8", errors="replace")
        for method, path in ROUTE_RE.findall(text):
            routes.setdefault(normalize(path), set()).add(method.upper())
    return routes


def frontend_calls() -> dict[str, set[str]]:
    calls: dict[str, set[str]] = {}
    assets = ROOT / "web" / "assets"
    files = sorted(assets.glob("*.js")) if assets.is_dir() else []
    files += [ROOT / "web" / "electron-shim.js"]
    for path in files:
        if not path.is_file():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        for raw in CALL_RE.findall(text):
            key = normalize(raw)
            if key != "/api" and len(key) > 5:
                calls.setdefault(key, set()).add(path.name)
    return calls


def main() -> int:
    routes = backend_routes()
    calls = frontend_calls()
    print(f"后端路由 {len(routes)} 条；前端引用的接口 {len(calls)} 个")
    print()

    missing = sorted(key for key in calls if key not in routes)
    print(f"=== 前端调用但后端**没有**的接口（{len(missing)} 个）===")
    for key in missing:
        where = ", ".join(sorted(calls[key])[:2])
        print(f"  ✗ {key:52} ← {where}")
    if not missing:
        print("  （没有缺口）")

    unused = sorted(key for key in routes if key not in calls)
    print()
    print(f"=== 后端有但前端未直接引用（{len(unused)} 个，可能由别的入口调用）===")
    for key in unused[:25]:
        print(f"  · {key:52} {sorted(routes[key])}")
    if len(unused) > 25:
        print(f"  … 还有 {len(unused) - 25} 个")

    out = ROOT / "tools" / "api_audit.json"
    out.write_text(json.dumps({"missing": missing, "unused": unused,
                               "routes": {k: sorted(v) for k, v in routes.items()}},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print()
    print(f"明细已写入 {out.relative_to(ROOT)}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
