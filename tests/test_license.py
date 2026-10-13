# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""许可证一致性门禁。

**为什么需要这个测试**：本仓库曾经出现"``LICENSE`` 是 MIT 全文、而各源文件头写着
``SPDX-License-Identifier: LGPL-3.0-only``"的矛盾 —— 仓库页显示的许可证与代码
声明的授权对不上，这既是法务风险也是明显的疏漏。下面的断言把两者钉在一起。

（同类问题在 ``tcide-pawui`` 也发生过一次：拆开授权时代的 GPL 字面量残留在一次性
脚本里，靠同类门禁才揪出来。）
"""

from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
LICENSE = ROOT / "LICENSE"
EXPECTED_SPDX = "SPDX-License-Identifier: LGPL-3.0-only"

#: 不应再出现的旧许可证标识。用正则而不是子串 —— "GNU General Public License v3.0"
#: 是 "GNU **Lesser** General Public License v3.0" 的**子串**，子串匹配会假阳性
#: （第一版就踩了：合法的 LGPL 写法被自己的测试判成残留 ✗）。
STALE_PATTERNS = (
    r"MIT License",
    r"license-GPLv3",
    r"(?<!Lesser )GNU General Public License v3\.0",
)

#: 第三方 vendored 代码（各自的许可证不动，也不参与本仓声明的一致性检查）
VENDOR = ("assets/vendor", "node_modules")


def test_license_file_is_the_lgpl_full_text():
    assert LICENSE.is_file(), "缺少 LICENSE"
    text = LICENSE.read_text(encoding="utf-8")
    assert LICENSE.stat().st_size >= 7000, "LICENSE 太小，可能不是全文"
    assert "GNU LESSER GENERAL PUBLIC LICENSE" in text, "LICENSE 不是 LGPL 原文"
    assert "Version 3, 29 June 2007" in text, "LICENSE 不是 LGPL-3.0 原文"
    assert "MIT License" not in text, "LICENSE 还是 MIT 的"


def test_source_files_declare_the_same_license():
    """源码头与 LICENSE 必须一致（这正是当初出问题的地方）。"""
    missing: list[str] = []
    for path in [*sorted(ROOT.glob("*.py")), *sorted((ROOT / "tcide_core").rglob("*.py")),
                 *sorted((ROOT / "api").rglob("*.py"))]:
        head = "\n".join(path.read_text(encoding="utf-8").splitlines()[:4])
        if EXPECTED_SPDX not in head:
            missing.append(path.relative_to(ROOT).as_posix())
    assert not missing, f"这些文件的 SPDX 头不是 LGPL-3.0-only：{missing}"


def test_readme_license_section_matches():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "LGPL" in readme, "README 的许可证段落必须写明 LGPL"
    stale = [pattern for pattern in STALE_PATTERNS if re.search(pattern, readme)]
    assert not stale, f"README 里还留着旧许可证字样：{stale}"
    assert "仅第 3 版" in readme, "README 要写明是严格的第 3 版（不含 or later）"


#: 用拼接而不是字面量：写成字面量的话，**这个测试文件自己**就会被下面的断言抓到
#: （第一版就是字面量，测试把自己判成了违规 ✗）。
OR_LATER = "LGPL-3.0-" + "or-later"


def test_no_or_later_anywhere():
    """严格 LGPL-3.0：本仓的任何文本都不得再声明 "or later"。

    LICENSE 文件除外 —— 那是 FSF 的标准全文，附录里的 "or later" 是**示例声明**，
    改它等于篡改许可证文本；"仅第 3 版"由我们自己的声明表达。
    """
    offenders: list[str] = []
    for path in sorted(ROOT.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in (
                ".py", ".md", ".txt", ".json", ".toml", ".html", ".js", ".ts", ".css"):
            continue
        relative = path.relative_to(ROOT).as_posix()
        if path.name == "LICENSE" or any(part in relative for part in VENDOR):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if OR_LATER in text:
            offenders.append(relative)
    assert not offenders, f"这些文件仍写着 {OR_LATER}：{offenders}"


def test_source_headers_use_the_canonical_spdx_id():
    """SPDX 规范写法是 ``LGPL-3.0-only``；``LGPL-3.0`` 是已废弃的同义写法。"""
    header = (ROOT / "server.py").read_text(encoding="utf-8").splitlines()[1]
    assert "LGPL-3.0-only" in header, f"server.py 的 SPDX 头不对：{header!r}"


def test_copyright_holder_is_guanist_inc():
    """版权行统一为 ``Guanist, Inc.``（用户指定，与原 MIT LICENSE 的署名一致）。"""
    holders: dict[str, str] = {}
    for path in [*sorted(ROOT.glob("*.py")),
                 *sorted((ROOT / "tcide_core").rglob("*.py")),
                 *sorted((ROOT / "api").rglob("*.py"))]:
        head = "\n".join(path.read_text(encoding="utf-8").splitlines()[:3])
        match = re.search(r"SPDX-FileCopyrightText:\s*(.+)", head)
        assert match, f"{path.name} 前 3 行里没有版权行"
        holders[path.name] = match.group(1).strip()
    wrong = {name: holder for name, holder in holders.items()
             if holder != "2026 Guanist, Inc."}
    assert not wrong, f"版权行不是 Guanist, Inc.：{wrong}"
