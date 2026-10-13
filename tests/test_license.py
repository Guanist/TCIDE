# SPDX-FileCopyrightText: 2025 tcide-pawui contributors
# SPDX-License-Identifier: LGPL-3.0-or-later
"""许可证一致性门禁。

**为什么需要这个测试**：本仓库曾经出现"``LICENSE`` 是 MIT 全文、而各源文件头写着
``SPDX-License-Identifier: LGPL-3.0-or-later``"的矛盾 —— 仓库页显示的许可证与代码
声明的授权对不上，这既是法务风险也是明显的疏漏。下面的断言把两者钉在一起。

（同类问题在 ``tcide-pawui`` 也发生过一次：拆开授权时代的 GPL 字面量残留在一次性
脚本里，靠同类门禁才揪出来。）
"""

from __future__ import annotations

import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
LICENSE = ROOT / "LICENSE"
EXPECTED_SPDX = "SPDX-License-Identifier: LGPL-3.0-or-later"

#: 不应再出现的旧许可证标识（本仓库历史上用过这些）
STALE = ("MIT License", "GPLv3", "GNU General Public License v3.0")


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
    assert not missing, f"这些文件的 SPDX 头不是 LGPL-3.0-or-later：{missing}"


def test_readme_license_section_matches():
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert "LGPL" in readme, "README 的许可证段落必须写明 LGPL"
    stale = [text for text in STALE if text in readme]
    assert not stale, f"README 里还留着旧许可证字样：{stale}"
    assert "license-GPLv3" not in readme, "README 徽章还是 GPLv3"
