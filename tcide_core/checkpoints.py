# SPDX-FileCopyrightText: 2026 Guanist, Inc.
# SPDX-License-Identifier: LGPL-3.0-only
"""长任务恢复：语义检查点。

参照 DeepSeek Harness 的 ``session-checkpoint-policy``：在**有意义的边界**上落盘，
而不是随便存一份状态。它强调的两条这里都照做：

1. **崩溃/中断不该丢副作用** —— 检查点写在任务边界（任务开始 / 成功 / 失败），
   于是"已经做完的任务"不会白做；
2. **不确定的工具结果不许盲目重试** —— 如果检查点里存在"已发起但未结算"的工具调用，
   恢复时把它标成 ``unknown_tools``，要求**先核验副作用是否已发生**再做下一步。
   盲目重跑一个可能已经在磁盘上写了东西的工具，比中断本身危险得多。

本模块只做数据与判定（不碰 Qt、不碰网络），所以能离线严格测试。
"""

from __future__ import annotations

import datetime as _datetime
import json
import os
import pathlib
from dataclasses import asdict, dataclass, field

#: 检查点目录（相对项目根）。放在项目内是为了"跟着项目走"，方便一起排查。
CHECKPOINT_DIR = ".tcide/checkpoints"


@dataclass
class Checkpoint:
    """一次长任务在某个边界上的快照。"""

    run_id: str
    requirement: str = ""
    goal: str = ""
    #: 任务快照（id/title/status/summary/error/tool_calls）
    tasks: list[dict] = field(default_factory=list)
    #: 已经完成的任务数（进度）
    done_count: int = 0
    tool_calls: int = 0
    #: **已发起但结果未知**的工具名（半途中断的证据）
    in_flight: list[str] = field(default_factory=list)
    #: 整轮是否正常结束
    finished: bool = False
    cancelled: bool = False
    created: str = ""

    def __post_init__(self) -> None:
        if not self.created:
            self.created = _datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # -- 查询 -------------------------------------------------------------

    def pending_tasks(self) -> list[dict]:
        """还没结束的任务（``pending`` / ``running``）。"""
        return [task for task in self.tasks
                if str(task.get("status", "")) in ("pending", "running")]

    def failed_tasks(self) -> list[dict]:
        return [task for task in self.tasks if task.get("status") == "failed"]

    def summary(self) -> str:
        total = len(self.tasks)
        state = "已完成" if self.finished else ("已取消" if self.cancelled else "进行中")
        extra = f"，{len(self.in_flight)} 个工具结果未知" if self.in_flight else ""
        return f"{self.run_id}：{state}（{self.done_count}/{total} 个任务）{extra}"

    def to_dict(self) -> dict:
        return asdict(self)


class CheckpointStore:
    """检查点的落盘与读取（``<项目根>/.tcide/checkpoints/*.json``）。"""

    def __init__(self, root) -> None:
        self.root = pathlib.Path(root)
        self.dir = self.root / CHECKPOINT_DIR

    def path_for(self, run_id: str) -> pathlib.Path:
        safe = "".join(char for char in str(run_id)
                       if char.isalnum() or char in "-_") or "run"
        return self.dir / f"{safe}.json"

    def save(self, checkpoint: Checkpoint) -> pathlib.Path:
        """原子写（先写临时文件再替换）—— 崩溃时不会留下半个 JSON。"""
        self.dir.mkdir(parents=True, exist_ok=True)
        target = self.path_for(checkpoint.run_id)
        temporary = target.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(checkpoint.to_dict(), ensure_ascii=False,
                                        indent=1),
                             encoding="utf-8", newline="\n")
        os.replace(temporary, target)
        return target

    def load(self, run_id: str) -> Checkpoint | None:
        target = self.path_for(run_id)
        if not target.is_file():
            return None
        try:
            data = json.loads(target.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(data, dict):
            return None
        known = set(Checkpoint.__dataclass_fields__)          # type: ignore[attr-defined]
        return Checkpoint(**{key: value for key, value in data.items()
                             if key in known})

    def list(self) -> list[str]:
        if not self.dir.is_dir():
            return []
        return sorted(item.stem for item in self.dir.glob("*.json"))

    def latest(self) -> Checkpoint | None:
        if not self.dir.is_dir():
            return None
        files = sorted(self.dir.glob("*.json"), key=lambda item: item.stat().st_mtime)
        if not files:
            return None
        return self.load(files[-1].stem)

    def prune(self, *, keep: int = 10) -> int:
        """只保留最近 ``keep`` 个（避免跑久了攒一堆）。返回删除数量。"""
        files = sorted(self.dir.glob("*.json"),
                       key=lambda item: item.stat().st_mtime, reverse=True) \
            if self.dir.is_dir() else []
        removed = 0
        for item in files[max(0, int(keep)):]:
            try:
                item.unlink()
                removed += 1
            except OSError:
                continue
        return removed

    def drop(self, run_id: str) -> bool:
        target = self.path_for(run_id)
        if target.is_file():
            try:
                target.unlink()
                return True
            except OSError:
                return False
        return False


@dataclass
class ResumeDecision:
    """"能不能接着跑、从哪儿接着跑"的判定结果。"""

    can_resume: bool = False
    run_id: str = ""
    from_round: int = 0
    pending: list[str] = field(default_factory=list)
    #: **结果未知**的工具（中断时已发起、未结算）—— 恢复前必须先核验
    unknown_tools: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> str:
        if not self.can_resume:
            return "没有可恢复的检查点" if not self.run_id else \
                f"{self.run_id}：已经正常结束，无需恢复"
        head = f"可从「{self.run_id}」恢复：已完成 {self.from_round} 个任务"
        if self.pending:
            head += f"，还有 {len(self.pending)} 个未完成"
        if self.unknown_tools:
            head += (f"；**{len(self.unknown_tools)} 个工具结果未知**"
                     f"（{', '.join(self.unknown_tools[:3])}），"
                     f"恢复前请先核验它们的副作用是否已经发生")
        return head


def plan_resume(checkpoint: Checkpoint | None) -> ResumeDecision:
    """根据检查点决定怎么恢复。

    三条规则（都是为了让"恢复"不制造新问题）：

    - 整轮已正常结束 → **不需要**恢复（``can_resume=False``）；
    - 有未完成的任务 → 可以恢复，从已完成数继续；
    - 有**结果未知**的工具 → 可以恢复，但必须把"先核验"写进说明里 ——
      盲目重跑可能已经在磁盘上写了东西的工具，比中断本身更危险。
    """
    decision = ResumeDecision()
    if checkpoint is None:
        return decision

    decision.run_id = checkpoint.run_id
    decision.from_round = checkpoint.done_count
    decision.pending = [str(task.get("id", "")) for task in checkpoint.pending_tasks()]
    decision.unknown_tools = list(dict.fromkeys(checkpoint.in_flight))

    if checkpoint.finished:
        decision.notes.append("整轮已正常结束，无需恢复")
        return decision

    decision.can_resume = bool(decision.pending) or bool(decision.unknown_tools)
    if not decision.can_resume:
        decision.notes.append("没有未完成的任务，也没有未知结果的工具")
        return decision
    if checkpoint.cancelled:
        decision.notes.append("上一次是被取消的（用户主动停止）")
    if decision.unknown_tools:
        decision.notes.append(
            "存在结果未知的工具调用：先核验副作用（文件是否已改、命令是否已执行），"
            "再决定重试还是跳过 —— 不要直接重跑")
    if checkpoint.failed_tasks():
        decision.notes.append(
            f"{len(checkpoint.failed_tasks())} 个任务上次失败，恢复时应当重试或跳过")
    return decision
