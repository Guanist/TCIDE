# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""发布文档的风格检查：把"AI 味"变成可数的信号。

## 为什么做这个

"读起来像 AI 写的"通常不是玄学，而是几种可数的习惯堆在一起：

- **加粗泛滥**：几乎每个名词都加粗，等于没有重点；
- **符号入文**：正文里出现 ✓ / ✗ / ★ —— 那是改动清单或调试输出的写法，
  不该出现在给人读的发布说明里；
- **自指叙述**：把自己的验证过程写进用户文档（"已实测""如实标注""本轮没查清"）。
  读者关心的是软件怎么用，不是作者怎么查的；
- **中文书名号当引号用**：满篇「」，读起来像译稿；
- **破折号成瘾**：每段都有 "——"；
- **模板化并列**："不是 X 而是 Y""既能…又能…"反复出现。

这个工具把它们数出来，给出阈值并返回非零退出码，供 CI 或测试调用。
它**不是**文学判据 —— 只是提醒，避免文档慢慢漂回机器味。

用法：
    python tools/readme_style.py                 # 检查 README.md 与 docs/releases/*.md
    python tools/readme_style.py --file README.md
"""

from __future__ import annotations

import argparse
import pathlib
import re
import sys

sys.stdout.reconfigure(line_buffering=True)
ROOT = pathlib.Path(__file__).resolve().parent.parent

#: 阈值为"每 100 行允许出现的次数"，按正文行数归一，避免长文档吃亏
LIMITS = {
    "加粗": 12.0,
    "「」": 2.0,
    "核对符号": 0.0,          # ✓ ✗ ★ 一律不许进入发布文档正文
    "自指措辞": 1.0,
    "破折号": 10.0,
    "模板句式": 1.0,
    "夸张词": 0.0,
}

SELF_REFERENTIAL = ("如实", "诚实", "特此说明", "本轮", "我实测", "本机实测", "自证",
                    "钉住", "值得记一笔", "需要说明的是", "这里说明")
TEMPLATES = (r"不是[^。；\n]{0,24}而是", r"不仅[^。；\n]{0,24}而且",
             r"既能[^。；\n]{0,24}又能", r"之所以[^。；\n]{0,24}是因为",
             r"正是为了")
#: 注意这些是**成对结构**的正则，不是单词。原因是：光数「不是」会把
#: "只读档下写操作是真的被拒绝，不是弹个提示" 这种正常否定也算进来（第一版就误报了）。
#: 真正的机器味成对出现——"不是 X 而是 Y""不仅 X 而且 Y"反复来。
HYPERBOLE = ("超级", "完美", "极致", "强大无比", "一键搞定", "轻松上手", "无缝", "丝滑")
#: 过期/易腐的事实：写进 README 就会变成谎话，检查时单独提醒。
#:
#: 已知局限：这是**字面串**匹配，所以引述一句过去的错话（例如发布说明里写
#: "以前把前端说成从 CDN 加载"）也会被算进来 —— 已经误报过一次。真碰到就改措辞，
#: 不要为了绕开它去放宽检测。
STALE_HINTS = ("CDN 加载", "static/index.html")


def signals(text: str) -> dict[str, float]:
    body = [line for line in text.splitlines()
            if line.strip() and not line.lstrip().startswith(("```", "|", "![", "<"))]
    lines = max(1, len(body))
    counts = {
        "加粗": len(re.findall(r"\*\*[^*]+\*\*", text)),
        "「」": len(re.findall(r"[「」]", text)),
        "核对符号": len(re.findall(r"[✓✗★]", text)),
        "自指措辞": sum(text.count(word) for word in SELF_REFERENTIAL),
        "破折号": text.count("——"),
        "模板句式": sum(len(re.findall(word, text)) for word in TEMPLATES),
        "夸张词": sum(text.count(word) for word in HYPERBOLE),
    }
    return {name: value / lines * 100 for name, value in counts.items()} | {
        "_lines": float(lines)}


def check(path: pathlib.Path) -> tuple[list[str], list[str]]:
    text = path.read_text(encoding="utf-8")
    values = signals(text)
    problems: list[str] = []
    notes: list[str] = []
    for name, limit in LIMITS.items():
        value = values[name]
        flag = "✗" if value > limit else "·"
        notes.append(f"    {flag} {name:<6} 每百行 {value:5.1f} 次（上限 {limit:g}）")
        if value > limit:
            problems.append(f"{path.name}: {name} 偏多（每百行 {value:.1f}，上限 {limit:g}）")
    for hint in STALE_HINTS:
        if hint in text:
            problems.append(f"{path.name}: 出现过期表述「{hint}」")
    return problems, notes


def main() -> int:
    parser = argparse.ArgumentParser(description="发布文档风格检查")
    parser.add_argument("--file", action="append", default=[],
                        help="要检查的文件（默认 README 与 docs/releases/*.md）")
    args = parser.parse_args()

    targets = [pathlib.Path(item) if pathlib.Path(item).is_absolute()
               else ROOT / item for item in args.file]
    if not targets:
        targets = [ROOT / "README.md", *sorted((ROOT / "docs" / "releases").glob("*.md"))]

    problems: list[str] = []
    for path in targets:
        if not path.is_file():
            print(f"  · 跳过（不存在）：{path}")
            continue
        print(f"  {path.relative_to(ROOT)}")
        found, notes = check(path)
        print("\n".join(notes))
        problems.extend(found)

    print()
    if problems:
        print("★ 风格检查未通过：")
        for item in problems:
            print("  · " + item)
        print("\n（这是提醒而非文学判据：把加粗减到真正需要的地方、符号留给改动清单、"
              "把自己怎么验证的写进提交信息而不是用户文档。）")
        return 1
    print("✓ 风格检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
