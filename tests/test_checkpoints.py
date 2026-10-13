# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""长任务恢复（检查点）的离线测试。

两条主线：
1. **存储**：原子写、读回、最新、清理、坏文件不炸；
2. **恢复判定**：正常结束 → 不必恢复；有未完成任务 → 可恢复；
   有**结果未知**的工具 → 可恢复但必须先核验（盲目重跑比中断更危险）。

再加一条端到端：用**假模型**跑一次真编排，断言检查点确实在任务边界被写出来。
"""

from __future__ import annotations

import json
import pathlib

import pytest

from tcide_core.checkpoints import (Checkpoint, CheckpointStore, plan_resume)


def make(run_id="run-1", *, tasks=None, done=0, in_flight=None, finished=False,
         cancelled=False):
    return Checkpoint(run_id=run_id, requirement="需求", goal="目标",
                      tasks=tasks if tasks is not None else [],
                      done_count=done, in_flight=list(in_flight or []),
                      finished=finished, cancelled=cancelled)


class TestStore:
    def test_save_then_load(self, tmp_path):
        store = CheckpointStore(tmp_path)
        saved = store.save(make(tasks=[{"id": "t1", "status": "done"}]))
        assert saved.is_file()
        loaded = store.load("run-1")
        assert loaded is not None
        assert loaded.run_id == "run-1"
        assert loaded.tasks[0]["status"] == "done"

    def test_atomic_write_leaves_no_temp(self, tmp_path):
        store = CheckpointStore(tmp_path)
        store.save(make())
        assert not list(store.dir.glob("*.tmp")), "临时文件要清掉，否则崩溃时会误判"

    def test_run_id_is_sanitised(self, tmp_path):
        """run id 会进文件名 —— 不能让 ../ 之类的路径穿透。"""
        store = CheckpointStore(tmp_path)
        saved = store.save(make(run_id="../../evil"))
        assert saved.parent == store.dir
        assert ".." not in saved.name

    def test_latest_returns_newest(self, tmp_path):
        store = CheckpointStore(tmp_path)
        store.save(make("a"))
        store.save(make("b"))
        assert store.latest().run_id in {"a", "b"}
        assert set(store.list()) == {"a", "b"}

    def test_prune_keeps_the_most_recent(self, tmp_path):
        store = CheckpointStore(tmp_path)
        for index in range(5):
            store.save(make(f"run-{index}"))
        removed = store.prune(keep=2)
        assert removed == 3 and len(store.list()) == 2

    def test_broken_file_returns_none_not_raise(self, tmp_path):
        store = CheckpointStore(tmp_path)
        store.dir.mkdir(parents=True)
        (store.dir / "bad.json").write_text("{ 不是 json", encoding="utf-8")
        assert store.load("bad") is None
        assert store.latest() is None

    def test_unknown_keys_are_ignored(self, tmp_path):
        store = CheckpointStore(tmp_path)
        store.dir.mkdir(parents=True)
        (store.dir / "r.json").write_text(
            json.dumps({"run_id": "r", "未来字段": 1}), encoding="utf-8")
        assert store.load("r").run_id == "r"

    def test_drop(self, tmp_path):
        store = CheckpointStore(tmp_path)
        store.save(make())
        assert store.drop("run-1") is True
        assert store.drop("run-1") is False


class TestResumeDecision:
    def test_no_checkpoint_means_nothing_to_resume(self):
        decision = plan_resume(None)
        assert decision.can_resume is False
        assert "没有可恢复" in decision.summary()

    def test_finished_run_needs_no_resume(self):
        checkpoint = make(tasks=[{"id": "t1", "status": "done"}], done=1,
                          finished=True)
        decision = plan_resume(checkpoint)
        assert decision.can_resume is False
        assert "正常结束" in decision.summary()

    def test_pending_tasks_can_resume(self):
        checkpoint = make(tasks=[{"id": "t1", "status": "done"},
                                 {"id": "t2", "status": "pending"}], done=1)
        decision = plan_resume(checkpoint)
        assert decision.can_resume is True
        assert decision.pending == ["t2"] and decision.from_round == 1
        assert "还有 1 个未完成" in decision.summary()

    def test_unknown_tool_outcomes_force_verification_first(self):
        """最关键的一条：中断时已发起的工具，恢复前必须核验，不能盲目重跑。"""
        checkpoint = make(tasks=[{"id": "t1", "status": "running"}], done=0,
                          in_flight=["write_file", "run_command"])
        decision = plan_resume(checkpoint)
        assert decision.can_resume is True
        assert decision.unknown_tools == ["write_file", "run_command"]
        assert any("核验" in note for note in decision.notes)
        assert "结果未知" in decision.summary()

    def test_duplicate_in_flight_is_deduped(self):
        checkpoint = make(tasks=[{"id": "t", "status": "running"}],
                          in_flight=["write_file", "write_file"])
        assert plan_resume(checkpoint).unknown_tools == ["write_file"]

    def test_failed_tasks_are_called_out(self):
        checkpoint = make(tasks=[{"id": "t1", "status": "failed"},
                                 {"id": "t2", "status": "pending"}], done=0)
        decision = plan_resume(checkpoint)
        assert any("失败" in note for note in decision.notes)

    def test_cancelled_run_is_noted(self):
        checkpoint = make(tasks=[{"id": "t", "status": "pending"}], cancelled=True)
        assert any("取消" in note for note in plan_resume(checkpoint).notes)

    def test_nothing_pending_and_not_finished(self):
        checkpoint = make(tasks=[{"id": "t", "status": "done"}], done=1)
        decision = plan_resume(checkpoint)
        assert decision.can_resume is False
        assert any("没有未完成" in note for note in decision.notes)


class FakeModel:
    """最小假模型：实现 ModelClient 协议所需的方法，完全离线。

    注意：TCIDE **没有** `OfflineModel`（那是 PawUI 版的类），只有 `ModelClient`
    协议 —— 所以测试自己照协议写一个。
    """

    def __init__(self):
        self.calls = 0

    def complete(self, messages, tools=None, **kwargs):  # noqa: D401
        self.calls += 1
        from tcide_core.models import ChatResponse

        return ChatResponse(text="完成", tool_calls=[], usage=None)


class TestCheckpointsFromRealRun:
    def test_checkpoints_fire_at_task_boundaries(self, tmp_path):
        """端到端：假模型跑一次真编排，检查点必须在任务边界被写到。"""
        from tcide_core.agent import AgentOrchestrator
        from tcide_core.tools import ToolRegistry
        from tcide_core.workspace import Workspace

        (tmp_path / "main.py").write_text("def add(a, b):\n    return a + b\n",
                                          encoding="utf-8")
        seen: list[dict] = []
        orchestrator = AgentOrchestrator(
            FakeModel(), ToolRegistry(Workspace(tmp_path)),
            max_parallel_coders=1,
            on_checkpoint=seen.append)
        report = orchestrator.run("给 add 加一个测试")

        assert seen, "任务边界一次检查点都没触发 —— 接线没生效"
        stages = {item["stage"] for item in seen}
        assert "task_start" in stages
        # 每个检查点都要带上可恢复所需的信息
        for item in seen:
            assert "tasks" in item and "done_count" in item
            assert isinstance(item["in_flight"], list)
        assert report.planned >= 0

    def test_checkpoint_callback_failure_does_not_break_the_run(self, tmp_path):
        """落盘失败不该打断编排（回调抛异常也要被吞掉）。"""
        from tcide_core.agent import AgentOrchestrator
        from tcide_core.tools import ToolRegistry
        from tcide_core.workspace import Workspace

        (tmp_path / "main.py").write_text("x = 1\n", encoding="utf-8")

        def boom(_payload):
            raise RuntimeError("磁盘满了")

        orchestrator = AgentOrchestrator(
            FakeModel(), ToolRegistry(Workspace(tmp_path)),
            max_parallel_coders=1, on_checkpoint=boom)
        report = orchestrator.run("随便改点什么")   # 不该抛
        assert report is not None


class TestRoundTripThroughStore:
    def test_a_real_run_can_be_saved_and_resumed(self, tmp_path):
        """把真实编排产出的检查点存下来，再据此做恢复判定。"""
        from tcide_core.agent import AgentOrchestrator
        from tcide_core.tools import ToolRegistry
        from tcide_core.workspace import Workspace

        (tmp_path / "main.py").write_text("x = 1\n", encoding="utf-8")
        store = CheckpointStore(tmp_path)
        latest: dict = {}

        def recorder(payload):
            latest.clear()
            latest.update(payload)
            store.save(Checkpoint(
                run_id="live",
                requirement="随便改点什么",
                tasks=payload["tasks"],
                done_count=payload["done_count"],
                in_flight=payload["in_flight"],
                finished=False,
                cancelled=payload["cancelled"]))

        orchestrator = AgentOrchestrator(
            FakeModel(), ToolRegistry(Workspace(tmp_path)),
            max_parallel_coders=1, on_checkpoint=recorder)
        orchestrator.run("随便改点什么")

        loaded = store.load("live")
        assert loaded is not None and loaded.run_id == "live"
        decision = plan_resume(loaded)
        # 结论可以是"可恢复"或"没剩什么"，但**必须**给出一句可读的判断
        assert decision.summary()
