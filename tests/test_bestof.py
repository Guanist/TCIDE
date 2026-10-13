# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""best-of-N 的离线确定性测试。

全部用**假 runner / 假 isolate / 假 collect**，所以不联网、不跑真模型、结果确定 ——
这样才能把"选优逻辑"钉死。真实用法（真编排器 + 真测试命令）由 app 层注入。
"""

from __future__ import annotations

import pathlib

import pytest

from tcide_core.bestof import (Attempt, BestOfResult, apply_winner, copy_workspace,
                               force_rmtree, read_changes, run_best_of, score_attempt)


class FakeReport:
    """最小 RunReport 替身（只要 ok / planned / done / failed）。"""

    def __init__(self, planned=3, done=3, failed=0, ok=True):
        self.planned, self.done, self.failed, self.ok = planned, done, failed, ok


class FakeReview:
    """最小 ReviewSession 替身：只记录 propose 的调用。"""

    def __init__(self):
        self.proposed: list[tuple[str, str, str]] = []

    def propose(self, path, modified, *, source=""):
        self.proposed.append((path, modified, source))
        return object()


def make_runner(scores: dict[int, tuple[FakeReport, dict]]):
    """按调用顺序返回预设结果的 runner。

    为什么用**闭包计数器**而不是从副本路径反推序号：``copy_workspace`` 用的是
    ``mkdtemp``，名字里那段是随机串 —— 反推必然抛 ValueError（第一版就这么错的）。
    runner 每个尝试按顺序各调一次，计数天然就是序号。
    """
    counter = {"n": 0}

    def runner(workdir: pathlib.Path):
        counter["n"] += 1
        report, _ = scores.get(counter["n"],
                               (FakeReport(ok=False, done=0, failed=3), {}))
        return report

    return runner


class TestScoring:
    def test_completion_ratio_dominates(self):
        full = score_attempt(FakeReport(planned=4, done=4)).value
        half = score_attempt(FakeReport(planned=4, done=2)).value
        assert full > half, "完成率必须是主项"

    def test_tests_passing_adds_and_their_absence_does_not(self):
        base = score_attempt(FakeReport()).value
        with_tests = score_attempt(FakeReport(), tests_passed=5, tests_total=5).value
        assert with_tests == pytest.approx(base + 20.0)

    def test_lint_and_size_are_penalties(self):
        base = score_attempt(FakeReport()).value
        dirty = score_attempt(FakeReport(), lint_issues=4, changed_lines=200).value
        assert dirty < base, "静态问题多、改动大，分数应当更低"

    def test_error_scores_are_negative(self):
        assert score_attempt(error="炸了").value < 0

    def test_notes_explain_the_number(self):
        """分数不能是黑盒：每条加减都要有可读理由。"""
        notes = score_attempt(FakeReport(planned=2, done=1), tests_passed=1,
                              tests_total=2, lint_issues=2, changed_lines=10).notes
        assert any("完成" in item for item in notes)
        assert any("测试" in item for item in notes)
        assert any("静态" in item for item in notes)


class TestIsolation:
    def test_copy_workspace_is_independent(self, tmp_path):
        (tmp_path / "a.txt").write_text("原始", encoding="utf-8")
        (tmp_path / "node_modules").mkdir()
        (tmp_path / "node_modules" / "big.js").write_text("x" * 10, encoding="utf-8")

        copy = copy_workspace(tmp_path)
        try:
            assert (copy / "a.txt").read_text(encoding="utf-8") == "原始"
            assert not (copy / "node_modules").exists(), "重目录应当被跳过（如实标注的取舍）"
            (copy / "a.txt").write_text("改了", encoding="utf-8")
            assert (tmp_path / "a.txt").read_text(encoding="utf-8") == "原始", \
                "副本里改动不能影响原工作区"
        finally:
            force_rmtree(copy.parent)

    def test_read_changes_only_reports_real_differences(self, tmp_path):
        baseline = tmp_path / "base"
        work = tmp_path / "work"
        baseline.mkdir()
        work.mkdir()
        (baseline / "same.txt").write_text("一样", encoding="utf-8")
        (work / "same.txt").write_text("一样", encoding="utf-8")
        (work / "new.txt").write_text("新文件", encoding="utf-8")
        (baseline / "old.txt").write_text("旧", encoding="utf-8")
        (work / "old.txt").write_text("改成新的", encoding="utf-8")

        changes = read_changes(work, baseline)
        assert set(changes) == {"new.txt", "old.txt"}
        assert changes["old.txt"] == "改成新的"


class TestSelection:
    def test_picks_the_highest_scoring_attempt(self, tmp_path):
        (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
        reports = {1: (FakeReport(planned=3, done=1, ok=False), {}),
                   2: (FakeReport(planned=3, done=3, ok=True), {}),
                   3: (FakeReport(planned=3, done=2, ok=False), {})}
        result = run_best_of("做点事", attempts=3, source=tmp_path,
                             runner=make_runner(reports))
        assert result.winner is not None and result.winner.index == 2

    def test_ties_pick_the_lowest_index_deterministically(self, tmp_path):
        same = (FakeReport(planned=2, done=2, ok=True), {})
        result = run_best_of("做点事", attempts=3, source=tmp_path,
                             runner=make_runner({1: same, 2: same, 3: same}))
        assert result.winner.index == 1, "同分必须稳定取序号最小的，否则每次跑选的不一样"

    def test_a_crashing_attempt_does_not_take_down_the_others(self, tmp_path):
        calls = {"n": 0}

        def runner(workdir):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("第一个尝试炸了")
            return FakeReport(planned=2, done=2, ok=True)

        result = run_best_of("做点事", attempts=3, source=tmp_path, runner=runner)
        assert len(result.attempts) == 3
        assert result.attempts[0].error, "炸掉的那个要留下原因"
        assert result.winner is not None, "其余的尝试仍应参与选优"

    def test_all_failed_means_no_winner(self, tmp_path):
        bad = (FakeReport(planned=2, done=0, failed=2, ok=False), {})
        result = run_best_of("做点事", attempts=2, source=tmp_path,
                             runner=make_runner({1: bad, 2: bad}))
        assert result.all_failed is True and result.winner is None
        assert "全部失败" in result.summary()

    def test_summary_and_labels_are_readable(self, tmp_path):
        good = (FakeReport(planned=1, done=1, ok=True), {})
        result = run_best_of("做点事", attempts=2, source=tmp_path,
                             runner=make_runner({1: good, 2: good}))
        assert "选中 #1" in result.summary()
        assert len(result.labels()) == 2 and result.labels()[0].startswith("#1")

    def test_verify_metrics_feed_the_score(self, tmp_path):
        """验证结果（测试/lint）必须真的影响选优，而不是被忽略。"""
        reports = {1: (FakeReport(planned=2, done=2, ok=True), {}),
                   2: (FakeReport(planned=2, done=2, ok=True), {})}

        seen = {"n": 0}

        def verify(workdir, report):
            seen["n"] += 1
            # 第 2 个尝试测试全过，第 1 个一个都没过
            return {"tests_passed": 5 if seen["n"] == 2 else 0, "tests_total": 5}

        result = run_best_of("做点事", attempts=2, source=tmp_path,
                             runner=make_runner(reports), verify=verify)
        assert result.winner.index == 2, "验证结果没进评分"


class TestApplyWinner:
    def test_proposes_through_the_review_gate_not_blind_write(self, tmp_path):
        (tmp_path / "a.py").write_text("x = 1\n", encoding="utf-8")
        result = BestOfResult(requirement="r")
        result.attempts.append(Attempt(index=1, ok=True, score=10.0,
                                       changes={"a.py": "x = 2\n"}))
        result.winner = result.attempts[0]

        review = FakeReview()
        proposed = apply_winner(result, review)

        assert proposed == ["a.py"]
        assert review.proposed[0][0] == "a.py"
        assert "best-of" in review.proposed[0][2], "来源要标出来，便于审核时判断"
        assert (tmp_path / "a.py").read_text(encoding="utf-8") == "x = 1\n", \
            "不许绕过审核直接写盘"

    def test_no_winner_proposes_nothing(self):
        review = FakeReview()
        assert apply_winner(BestOfResult(requirement="r"), review) == []
        assert review.proposed == []


class TestCleanup:
    def test_sandboxes_are_removed_even_on_failure(self, tmp_path):
        made: list[pathlib.Path] = []

        def isolate(root):
            copy = copy_workspace(root)
            made.append(copy)
            return copy

        def runner(workdir):
            raise RuntimeError("boom")

        (tmp_path / "a.py").write_text("x\n", encoding="utf-8")
        run_best_of("r", attempts=2, source=tmp_path, runner=runner,
                    isolate=isolate)
        assert made and all(not path.parent.exists() for path in made), \
            "临时副本必须清理掉，否则跑几次就攒一堆残留"

    def test_force_rmtree_handles_missing_path(self, tmp_path):
        force_rmtree(tmp_path / "不存在")      # 不该抛
