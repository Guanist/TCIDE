# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""best-of-N：同一个需求跑多个尝试，**在隔离副本里各跑各的**，按可验证的分数选优。

参照：Codex 的 ``codex cloud exec --attempts 1-4``（best-of-N）与它强调的
worktree 隔离；DeepSeek Harness 的"子代理各自有工作区"也是同一个思路。

为什么必须隔离：多个尝试会**同时改同一批文件**，不隔离就是互相踩 —— 于是"跑 3 个
尝试"得到的不是 3 个候选，而是 1 个被搅乱的残局。所以每个尝试都在项目的一份
**临时副本**里跑，最后只有胜出者的改动被回收（而且**经审核门**，不是盲写）。

为什么评分要写死权重：不写清权重，"选了更好的那个"就成了一句话术。这里的口径是

    100 × 完成率  + 20（测试通过）  − 0.5 × 静态问题数  − 0.05 × 改动行数  − 2 × 失败任务

- **完成率是主项** —— 任务没做完，别的都白搭；
- **测试通过是最强加分** —— 这是"能验证"与"看起来对"的分界；
- **轻微惩罚改动规模** —— 同样的完成度下，改动小的那个更好审、风险更低。

本模块只依赖标准库，并且把"怎么跑一个尝试 / 怎么验一个尝试"做成**可注入的回调**，
所以能用假 runner 做**完全确定性的离线测试**；真跑时由 app 层注入真实的编排器。
"""

from __future__ import annotations

import os
import pathlib
import shutil
import stat
import tempfile
from dataclasses import dataclass, field

#: 复制工作区时默认跳过的重目录（可覆盖）。
#: 取舍：不复制 ``.git`` 与 ``node_modules`` 能让副本创建快很多；代价是副本里
#: 没有 git 历史、JS 依赖也不在 —— 所以"在副本里跑 JS 测试"这类事做不了。
#: 这是**如实标注的限制**，不是"没想到"。
DEFAULT_IGNORES = (".git", "node_modules", "__pycache__", ".venv", "venv", "dist",
                   "build", ".mypy_cache", ".pytest_cache", ".ruff_cache")


def force_rmtree(path: pathlib.Path) -> None:
    """删目录树，能处理只读文件（git 的 .git/objects 就是只读）。

    ``ignore_errors=True`` 会把失败静默吞掉，实测能攒下上百个残留目录 ——
    所以这里显式改权限后重试（与 tests/conftest.py 里那个 force_rmtree 同源）。
    """

    def handle(func, target, _exc):
        try:
            os.chmod(target, stat.S_IWRITE | stat.S_IREAD)
            func(target)
        except OSError:
            pass

    if not path.exists():
        return
    shutil.rmtree(path, onerror=handle)


def copy_workspace(source: pathlib.Path, *, ignores=DEFAULT_IGNORES) -> pathlib.Path:
    """把工作区复制成一份隔离副本，返回副本根目录。"""
    target = pathlib.Path(tempfile.mkdtemp(prefix="tcide-attempt-"))
    copied = target / "work"
    shutil.copytree(source, copied, ignore=shutil.ignore_patterns(*ignores),
                    dirs_exist_ok=False)
    return copied


def read_changes(workdir: pathlib.Path, baseline: pathlib.Path) -> dict[str, str]:
    """比较副本与基线，返回**被改动/新增**的文本文件（相对路径 -> 内容）。

    只收文本文件：二进制（图片等）走不了 ``review.propose``，硬塞进去会变成乱码。
    """
    changes: dict[str, str] = {}
    for path in sorted(workdir.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(workdir)
        original = baseline / relative
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if original.is_file():
            try:
                if original.read_text(encoding="utf-8") == text:
                    continue
            except (UnicodeDecodeError, OSError):
                pass
        changes[relative.as_posix()] = text
    return changes


@dataclass
class Score:
    """一个尝试的分数与**可读的理由**（分数不该是个黑盒数字）。"""

    value: float = 0.0
    notes: list[str] = field(default_factory=list)

    def add(self, delta: float, why: str) -> None:
        self.value += delta
        self.notes.append(f"{delta:+.2f} {why}")


def score_attempt(report=None, *, tests_passed: int | None = None,
                  tests_total: int | None = None, lint_issues: int = 0,
                  changed_lines: int = 0, error: str = "") -> Score:
    """按明确口径打分（见模块文档）。任何输入缺失都不影响可算。"""
    score = Score()
    if error:
        score.add(-100.0, f"尝试失败：{error[:60]}")
        return score

    planned = int(getattr(report, "planned", 0) or 0)
    done = int(getattr(report, "done", 0) or 0)
    failed = int(getattr(report, "failed", 0) or 0)
    if planned:
        ratio = done / planned
        score.add(100.0 * ratio, f"任务完成 {done}/{planned}")
    elif report is not None:
        score.add(50.0, "没有计划任务（无法按完成率评分）")

    if tests_total:
        ratio = (tests_passed or 0) / tests_total
        score.add(20.0 * ratio, f"测试通过 {tests_passed or 0}/{tests_total}")
    elif tests_passed:
        score.add(20.0, f"测试通过 {tests_passed} 项")

    if lint_issues:
        score.add(-0.5 * lint_issues, f"静态问题 {lint_issues} 个")
    if changed_lines:
        score.add(-0.05 * changed_lines, f"改动 {changed_lines} 行")
    if failed:
        score.add(-2.0 * failed, f"失败任务 {failed} 个")
    return score


@dataclass
class Attempt:
    """一个尝试的结果。"""

    index: int
    ok: bool = False
    score: float = 0.0
    notes: list[str] = field(default_factory=list)
    error: str = ""
    changes: dict[str, str] = field(default_factory=dict)
    workdir: str = ""

    def label(self) -> str:
        mark = "✓" if self.ok else "✗"
        why = self.error[:60] if self.error else "；".join(self.notes[:3])
        return f"#{self.index} {mark} 分数 {self.score:.2f}  {why}"

    @property
    def changed_lines(self) -> int:
        return sum(len(text.splitlines()) for text in self.changes.values())


@dataclass
class BestOfResult:
    """best-of-N 的总结果。"""

    requirement: str
    attempts: list[Attempt] = field(default_factory=list)
    winner: Attempt | None = None
    #: 所有尝试都失败时为 True（此时**不**回收任何改动）
    all_failed: bool = False

    def summary(self) -> str:
        if not self.attempts:
            return "没有尝试"
        head = (f"best-of-{len(self.attempts)}："
                f"{'全部失败' if self.all_failed else f'选中 #{self.winner.index}'}")
        best = max((item.score for item in self.attempts), default=0.0)
        return f"{head}（最高分 {best:.2f}）"

    def labels(self) -> list[str]:
        return [item.label() for item in self.attempts]


def run_best_of(requirement: str, *, attempts: int = 3, runner, verify=None,
                isolate=None, collect=None, on_event=None,
                source: str | pathlib.Path | None = None) -> BestOfResult:
    """跑 N 个隔离尝试并选优。

    参数都是可注入的回调，便于离线测试：

    - ``runner(workdir) -> RunReport``：在副本里跑一次编排（真跑时注入编排器）
    - ``verify(workdir, report) -> dict``：在副本里验证（例如跑测试、跑 linter），
      返回 ``{"tests_passed": .., "tests_total": .., "lint_issues": ..}``
    - ``isolate(source) -> Path``：创建隔离副本（默认 :func:`copy_workspace`）
    - ``collect(workdir, baseline) -> dict``：回收改动（默认 :func:`read_changes`）
    - ``on_event(text)``：进度回调（可选）

    失败被**隔离在单个尝试内**：第 2 个尝试崩了不会影响第 1、3 个。
    """
    # 源目录是**显式参数**。第一版用 ``getattr(runner, "project_root", cwd)``
    # 去猜 —— 那是让调用方偷偷挂个属性，既不可读也容易错。
    root = pathlib.Path(source) if source is not None else pathlib.Path.cwd()
    make_copy = isolate or (lambda item: copy_workspace(item))
    take = collect or read_changes

    result = BestOfResult(requirement=requirement)
    sandboxes: list[pathlib.Path] = []
    try:
        for index in range(1, max(1, int(attempts)) + 1):
            if on_event:
                on_event(f"尝试 #{index} 开始（隔离副本）")
            attempt = Attempt(index=index)
            workdir: pathlib.Path | None = None
            try:
                workdir = make_copy(root)
                sandboxes.append(workdir)
                attempt.workdir = str(workdir)
                report = runner(workdir)
                metrics = {}
                if verify is not None:
                    metrics = verify(workdir, report) or {}
                attempt.changes = take(workdir, root)
                scored = score_attempt(
                    report,
                    tests_passed=metrics.get("tests_passed"),
                    tests_total=metrics.get("tests_total"),
                    lint_issues=int(metrics.get("lint_issues") or 0),
                    changed_lines=sum(len(text.splitlines())
                                      for text in attempt.changes.values()),
                )
                attempt.score = scored.value
                attempt.notes = scored.notes
                attempt.ok = bool(getattr(report, "ok", False))
            except Exception as exc:      # noqa: BLE001 - 一个尝试失败不该拖垮其他
                attempt.error = f"{type(exc).__name__}: {exc}"
                attempt.score = score_attempt(error=attempt.error).value
                attempt.notes = [attempt.error]
            result.attempts.append(attempt)
            if on_event:
                on_event(attempt.label())

        usable = [item for item in result.attempts if not item.error]
        if usable:
            # 同分取**序号最小**的：deterministic，避免"每次跑选的不一样"
            best = max(usable, key=lambda item: (item.score, -item.index))
            result.winner = best if best.score > 0 or best.ok else None
        result.all_failed = not usable or result.winner is None
        if on_event:
            on_event(result.summary())
        return result
    finally:
        for path in sandboxes:
            force_rmtree(path.parent if path.name == "work" else path)


def apply_winner(result: BestOfResult, review) -> list[str]:
    """把胜出者的改动**经审核门**提交（``review.propose``），返回被提议的路径。

    刻意不直接写盘：本项目的原则是"写操作要可拦可审"（权限三档 + 变更清单都建在
    这条原则上）。best-of-N 只是**多给你几个候选**，不该绕过审核。
    """
    if result.winner is None:
        return []
    proposed: list[str] = []
    for path, text in sorted(result.winner.changes.items()):
        review.propose(path, text, source=f"best-of-{len(result.attempts)} #{result.winner.index}")
        proposed.append(path)
    return proposed
