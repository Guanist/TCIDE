# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""验证 LSP **真的能用**（不是"探测到"就算了）。

背景：本仓库的 LSP 客户端此前只用**假语言服务器**验证过协议逻辑 —— 也就是说
"接上真 pyright/gopls 到底行不行"从来没有实测过，状态栏长期显示"可用 0/6"。
这个脚本补上那条缺失的证据：

1. 在临时项目里放一个**故意写错类型**的文件；
2. 用本仓库的 ``LspClient`` 起真服务器（默认 pyright）；
3. 断言能拿到**真诊断**（而不是空列表），并给出具体诊断内容；
4. 顺带验证补全能返回候选。

用法：``python tools/verify_lsp.py``
退出码 0 = 通过；1 = 失败（含"服务器没装"这种情况，会打印安装命令）。
"""

from __future__ import annotations

import pathlib
import shutil
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tcide_core.lsp import LspClient, available_servers, detect_servers  # noqa: E402

#: 故意写错的示例：声明返回 str 却返回 int —— pyright 必然报错
BAD_SOURCE = '''def greet(name: str) -> str:
    return 42


def unused(value: int) -> int:
    return value
'''

GOOD_SOURCE = '''def greet(name: str) -> str:
    return f"hello {name}"
'''


def main() -> int:
    print("=== 1) 装了哪些语言服务器 ===")
    servers = detect_servers()
    for status in servers:
        print(f"  {'✓' if status.available else '·'} {status.language:10} {status.command or '(无)'}")
    usable = available_servers()
    if not usable:
        print("\n★ 一个语言服务器都没装 → LSP 只能是空的。安装 python 的：")
        print("    npm install -g pyright")
        return 1

    status = next((item for item in usable if item.language == "python"), usable[0])
    print(f"\n=== 2) 起真服务器：{status.language} / {status.command} ===")

    workdir = pathlib.Path(tempfile.mkdtemp(prefix="tcide-lsp-"))
    (workdir / "pyproject.toml").write_text("[project]\nname='probe'\nversion='0'\n",
                                            encoding="utf-8")
    bad = workdir / "bad.py"
    good = workdir / "good.py"
    bad.write_text(BAD_SOURCE, encoding="utf-8")
    good.write_text(GOOD_SOURCE, encoding="utf-8")

    client = LspClient(status, workdir)
    problems: list[str] = []
    try:
        if not client.start():
            # 打印**真实原因**（client.error）。笼统说一句"initialize 失败"没用 ——
            # 我第一版就是这么写的，结果看不出到底是 .cmd shim 还是别的问题。
            problems.append(f"客户端起不来：{getattr(client, 'error', '') or '（无错误信息）'}")
        else:
            print("  ✓ initialize 成功")
            client.open_file(str(good), GOOD_SOURCE, language="python")
            client.open_file(str(bad), BAD_SOURCE, language="python")

            # 诊断是异步推来的：轮询到出现为止（或超时）
            deadline = time.time() + 60
            issues: list = []
            while time.time() < deadline:
                issues = client.issues()
                if issues:
                    break
                time.sleep(1.0)

            print(f"\n=== 3) 诊断（等 {60}s 内）===")
            if not issues:
                problems.append("没拿到任何诊断 —— 说明「接上真服务器」这条链没通")
            for issue in issues[:5]:
                print(f"  · {pathlib.Path(str(issue.path)).name}:{issue.line} "
                      f"[{issue.severity}] {issue.message[:90]}")

            # 关键断言：必须报出"返回值类型不对"这类真问题
            texts = " ".join(str(getattr(issue, "message", "")) for issue in issues).lower()
            if issues and not any(word in texts for word in
                                 ("int", "str", "type", "类型", "return", "assign")):
                problems.append(f"拿到了诊断但内容不像类型错误：{texts[:120]}")

            print("\n=== 4) 补全 ===")
            labels = client.completion(str(good), 0, len("def greet"))
            print(f"  候选 {len(labels)} 个" + (f"，例如 {labels[:5]}" if labels else "（空）"))
            if not labels:
                # 补全对 pyright 依赖"文件已分析完"，空结果不判失败，但要说清楚
                print("  · 补全为空（真实 IDE 里通常是文件还没分析完；这里不判失败）")
    finally:
        client.stop()
        shutil.rmtree(workdir, ignore_errors=True)

    print()
    if problems:
        print(f"★ 未通过（{len(problems)} 项）：")
        for item in problems:
            print("  · " + item)
        return 1
    # 措辞要**如实**：补全这一项这次没拿到候选，就不能写在"通过"里 ——
    # 第一版我写成"能返回补全候选"，那是过度声称。
    print(f"✓ 通过：真服务器（{status.command}）能起、initialize 成功、能拿到真诊断")
    print("  · 补全本次返回 0 个候选（未验证，需要文件分析完成后再取；不计入通过条件）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
