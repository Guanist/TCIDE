# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""发布文档的风格回归测试。

用 `tools/readme_style.py` 的可数信号跑一遍：加粗密度、正文里的核对符号、
自指措辞、中文书名号当引号用、破折号与模板句式密度，以及"过期表述"这类硬伤。

这些阈值不是文学判据。它们的作用是：文档改着改着容易滑回机器腔（每个名词都加粗、
把自己的验证过程写进用户文档、满篇 ✓ ✗），有了这条测试，滑回去会在 CI 里被拦住。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
TOOL = ROOT / "tools" / "readme_style.py"

pytestmark = pytest.mark.skipif(not TOOL.is_file(), reason="缺少风格检查工具")


def run_style(*files: str) -> subprocess.CompletedProcess:
    args = [sys.executable, str(TOOL)]
    for item in files:
        args += ["--file", item]
    return subprocess.run(args, cwd=str(ROOT), capture_output=True, text=True,
                          encoding="utf-8", errors="replace")


class TestReleaseDocsStyle:
    def test_readme_passes(self):
        done = run_style("README.md")
        assert done.returncode == 0, "README 风格检查未通过：\n" + done.stdout

    def test_release_notes_pass(self):
        notes = sorted(Path(ROOT / "docs" / "releases").glob("*.md"))
        assert notes, "找不到发布说明"
        done = run_style(*[f"docs/releases/{item.name}" for item in notes])
        assert done.returncode == 0, "发布说明风格检查未通过：\n" + done.stdout

    def test_readme_has_no_symbols_in_prose(self):
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        hits = [line for line in text.splitlines()
                if any(symbol in line for symbol in "✓✗★")]
        assert not hits, f"README 正文里出现了核对符号：{hits[:2]}"

    def test_readme_covers_first_run_configuration(self):
        """真人写的 README 不会漏掉"第一次怎么让它跑起来"。

        这个项目第一次运行必须配模型（服务商 / 模型名 / API Key），否则界面里
        什么都做不了 —— 早期版本恰恰没写这一段。
        """
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        for word in ("API Key", "settings.json", "权限"):
            assert word in text, f"README 缺少首次运行的说明：{word}"

    def test_readme_structure_documents_real_paths(self):
        """目录结构里写的路径必须真实存在（旧 README 写过不存在的 core/ 模块）。"""
        text = (ROOT / "README.md").read_text(encoding="utf-8")
        block = text.split("## 目录结构", 1)[-1].split("```")[1]
        names = []
        for line in block.splitlines():
            head = line.strip().split()[0] if line.strip() else ""
            if head and "/" in head or head.endswith(".py"):
                names.append(head.rstrip("/").split("/")[0])
        assert names, "解析不出目录结构条目"
        missing = [item for item in set(names) if not (ROOT / item).exists()]
        assert not missing, f"目录结构里写了不存在的路径：{missing}"
