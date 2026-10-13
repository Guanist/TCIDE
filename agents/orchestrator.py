"""
Agent 编排器 - Builder → Coder Pool → Reviewer → Verify 循环
"""
import asyncio
import time
from dataclasses import dataclass, field

from agents.builder import Task, build_plan
from agents.coder import CoderResult, execute_task
from agents.reviewer import ReviewResult, review_code


@dataclass
class OrchestratorStep:
    phase: str  # build | code | review | verify
    task_id: str
    status: str  # running | passed | failed
    detail: str = ""
    duration_ms: int = 0


@dataclass
class OrchestratorResult:
    success: bool
    steps: list[OrchestratorStep] = field(default_factory=list)
    plan: list[Task] = field(default_factory=list)
    summary: str = ""
    error: str = ""


async def run_pipeline(
    requirement: str,
    project_context: str = "",
    file_contents: dict[str, str] = None,
    on_step=None,
    max_retries: int = 2,
) -> OrchestratorResult:
    """执行完整的 Builder → Coder → Reviewer 流水线"""
    file_contents = file_contents or {}
    result = OrchestratorResult(success=False)
    t0 = time.time()

    # Phase 1: Builder - 生成任务计划
    step = OrchestratorStep(phase="build", task_id="plan", status="running")
    _notify(on_step, step)
    try:
        tasks = await build_plan(requirement, project_context)
        result.plan = tasks
        step.status = "passed"
        step.detail = f"生成 {len(tasks)} 个任务"
    except Exception as e:
        step.status = "failed"
        step.detail = str(e)
        result.steps.append(step)
        result.error = f"Builder 失败: {e}"
        return result
    step.duration_ms = int((time.time() - t0) * 1000)
    result.steps.append(step)

    # Phase 2: Coder - 按拓扑序执行任务
    completed = set()
    code_results: dict[str, CoderResult] = {}
    changed_files: dict[str, str] = {}

    for attempt in range(max_retries + 1):
        for task in tasks:
            if task.id in completed:
                continue
            # 检查依赖
            if not all(dep in completed for dep in task.dependencies):
                continue

            step = OrchestratorStep(phase="code", task_id=task.id, status="running")
            _notify(on_step, step)
            t1 = time.time()

            task_files = {p: file_contents[p] for p in task.files if p in file_contents}
            try:
                code_result = await execute_task(
                    task.description,
                    project_context=project_context,
                    file_contents=task_files,
                    max_retries=1,
                )
                code_results[task.id] = code_result
                if code_result.success:
                    completed.add(task.id)
                    step.status = "passed"
                    step.detail = code_result.summary
                    # 收集变更文件
                    for action in code_result.actions:
                        if action.action == "write_file" and action.path:
                            changed_files[action.path] = action.content
                else:
                    step.status = "failed"
                    step.detail = code_result.error or code_result.summary
            except Exception as e:
                step.status = "failed"
                step.detail = str(e)

            step.duration_ms = int((time.time() - t1) * 1000)
            result.steps.append(step)

        # 检查是否所有任务完成
        if len(completed) == len(tasks):
            break

    # Phase 3: Reviewer - 审查变更
    if changed_files:
        step = OrchestratorStep(phase="review", task_id="review", status="running")
        _notify(on_step, step)
        t2 = time.time()
        try:
            review = await review_code(requirement, changed_files)
            step.duration_ms = int((time.time() - t2) * 1000)
            if review.approved:
                step.status = "passed"
                step.detail = review.summary
            else:
                step.status = "failed"
                step.detail = f"{len(review.issues)} 个问题: {review.summary}"
                # 如果审查不通过，可以触发修复循环（简化版暂不实现）
        except Exception as e:
            step.status = "failed"
            step.detail = str(e)
        result.steps.append(step)

    # 汇总
    failed_steps = [s for s in result.steps if s.status == "failed"]
    result.success = len(failed_steps) == 0 and len(completed) == len(tasks)
    total_ms = int((time.time() - t0) * 1000)
    result.summary = (
        f"{'✅ 成功' if result.success else '❌ 失败'} | "
        f"任务 {len(completed)}/{len(tasks)} | "
        f"耗时 {total_ms}ms"
    )
    return result


def _notify(callback, step: OrchestratorStep):
    """回调通知步骤变化"""
    if callback:
        try:
            callback(step)
        except Exception:
            pass
