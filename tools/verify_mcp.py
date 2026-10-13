# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""验证 MCP **真的能用**：接一个**真第三方** MCP server，拿到真工具与真结果。

为什么必须接真服务器：本仓库此前的 MCP 实现按 **LSP 的 Content-Length 帧** 收发，
而 MCP stdio 的约定是**一行一个 JSON** —— 于是它"代码写了、看起来对，却一次也用不了"
（tools/list 只会一路超时）。这种问题只有接真的才暴露得出来。

默认用 ``@modelcontextprotocol/server-filesystem``（官方参考实现之一）：

    npm install -g @modelcontextprotocol/server-filesystem

用法：``python tools/verify_mcp.py``
退出码 0 = 通过；1 = 失败（会把"服务器没装"这种情况也讲清楚）。
"""

from __future__ import annotations

import pathlib
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from api import mcp  # noqa: E402


def main() -> int:
    print("=== 1) 找一个真 MCP server ===")
    candidates = ("mcp-server-filesystem", "server-filesystem")
    command = next((name for name in candidates if shutil.which(name)), "")
    if not command:
        print("  ★ 一个都没装。安装一个再跑：")
        print("    npm install -g @modelcontextprotocol/server-filesystem")
        return 1
    print(f"  ✓ {command} → {shutil.which(command)}")

    workdir = pathlib.Path(tempfile.mkdtemp(prefix="tcide-mcp-"))
    (workdir / "hello.txt").write_text("MCP 真的通了\n", encoding="utf-8")
    (workdir / "code.py").write_text("def answer():\n    return 42\n",
                                     encoding="utf-8")
    print(f"  允许目录: {workdir}")

    problems: list[str] = []
    try:
        # filesystem server 用位置参数声明允许访问的目录
        result = mcp.connect_server("fs", command, [str(workdir)],
                                   project_path=str(workdir))
        print(f"\n=== 2) connect_server → {result} ===")
        if not result.get("success"):
            problems.append(f"连接失败：{result.get('error')}")
            return _report(problems)
        print(f"  ✓ 握手成功，拿到 {result['tools']} 个工具")

        listing = mcp.list_tools()
        external = [t for t in listing["tools"] if t.get("_source") == "mcp"]
        print(f"\n=== 3) tools/list 合并结果：内置 {listing['builtin']} + 外部 {listing['external']} ===")
        for tool in external[:6]:
            print(f"  · {tool['name']}  — {str(tool.get('description'))[:70]}")
        if not external:
            problems.append("没拿到任何外部工具（tools/list 没通）")
            return _report(problems)

        # 挑一个"读目录/读文件"类的工具真调一次
        names = [t["name"] for t in external]
        want = next((n for n in names if "list_directory" in n or "list_allowed" in n),
                    next((n for n in names if "read_file" in n or "read_text_file" in n), ""))
        if not want:
            problems.append(f"没找到可验证的读类工具，工具名：{names}")
            return _report(problems)

        print(f"\n=== 4) tools/call：{want} ===")
        if "list" in want:
            called = mcp.call_tool(want, {"path": str(workdir)})
        else:
            called = mcp.call_tool(want, {"path": str(workdir / "hello.txt")})
        text = str(called.get("result", ""))
        print("  返回：" + (text[:300].replace("\n", " | ") or "(空)"))
        if called.get("error"):
            problems.append(f"调用返回 error：{called['error']}")
        elif not text.strip():
            problems.append("调用成功但返回空内容")
        elif "hello" not in text and "MCP" not in text and "code.py" not in text:
            problems.append(f"返回内容不符合预期（既没有 hello.txt 也没有 MCP/code.py）：{text[:160]}")
        else:
            print("  ✓ 真调用返回了真内容")

        print(f"\n=== 5) 服务器状态 ===")
        print(f"  {mcp.get_servers()}")
    finally:
        mcp.disconnect_all()
        shutil.rmtree(workdir, ignore_errors=True)

    return _report(problems)


def _report(problems: list[str]) -> int:
    print()
    if problems:
        print(f"★ 未通过（{len(problems)} 项）：")
        for item in problems:
            print("  · " + item)
        return 1
    print("✓ 通过：接真 MCP server 能握手、能列出工具、能真的调用并拿到内容")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
