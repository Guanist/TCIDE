"""前端契约路由：让 ``web/`` 前端调用的接口**真的存在且能对上**。

背景（这是本仓库"功能不完善"的主要形态）：``web/`` 是原 Electron 渲染层用 Vite
构建的产物，它通过 ``electron-shim.js`` 把 ``window.api.*`` 映射成 REST 调用。
对账后发现三类问题（``tools/api_audit.py`` 可复现）：

1. **URL 不一致**：前端 ``POST /api/warehouse/analyze-all``，后端只有
   ``GET /api/warehouse/analyze``；前端 ``POST /api/runner/execute``，后端只有
   ``/api/runner/run``。功能在，但界面调不到。
2. **参数名不一致**：前端 ``GET /api/entropy/evaluate?path=…``，后端签名只收
   ``file_path`` → FastAPI 直接返回 **422**，界面上这个功能必坏。
3. **从来没加过路由**：``/api/lint``、``/api/entropy/ctrl/*``、``/api/session/*``、
   ``/api/debug/start|stop|next|…``、``/api/vector/init`` 等。

本模块只做**接线、改名、参数兼容**，不重复实现引擎：
- 能委托给 ``advanced.py`` 里已有对象（服务启动时就已实例化）的一律委托；
- 仓库里确实没有的能力（如静态检查）用 ``tcide_core``（从 tcide-pawui 搬运的纯
  标准库实现，LGPL-3.0-or-later，见 ``tcide_core/__init__.py``）。

约定：与前缀路由保持一致 —— 出错也返回 200 + ``{"error": ...}``，不抛 5xx，
这样界面能显示原因而不是白屏。
"""

from __future__ import annotations

import os
import sys

from fastapi import APIRouter, Request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tcide_core.arch import ArchAnalyzer          # noqa: E402
from tcide_core.indexer import ProjectIndex        # noqa: E402
from tcide_core.lint import Linter                 # noqa: E402
from tcide_core.workspace import Workspace         # noqa: E402

router = APIRouter(tags=["ui-contract"])

#: 代码熵控制器的会话状态（前端会 init → 反复 tick → 读 recommendation）
_entropy_ctrl: dict = {"project": "", "ticks": 0, "last": None, "recommendation": None}


# ── 小工具 ────────────────────────────────────────────────────────────────

def _pick(*values: str | None) -> str:
    """取第一个非空值 —— 前端对同一个概念有 path/file_path、project/project_root 几种写法。"""
    for value in values:
        if value:
            return str(value)
    return ""


def current_project_root() -> str:
    """当前项目根（跟随主服务的 ``/api/project/open``）。

    名字刻意不叫 ``project_root``：路由处理函数的参数也叫 ``project_root``，
    同名会把模块级函数**遮蔽**掉，调用时得到 ``TypeError: 'str' object is not
    callable``（我第一版就这么写，被测试当场抓到）。
    """
    try:
        from api import files

        return files._project_root or os.getcwd()
    except Exception:      # noqa: BLE001 - 导入失败也不该让接口挂掉
        return os.getcwd()


def _workspace() -> Workspace:
    return Workspace(current_project_root())


def _relative(path: str) -> str:
    """把前端可能传来的绝对路径统一成工作区相对路径。"""
    if not path:
        return ""
    absolute = os.path.abspath(path)
    root = os.path.abspath(current_project_root())
    try:
        if os.path.commonpath([absolute, root]) == root:
            return os.path.relpath(absolute, root).replace("\\", "/")
    except ValueError:     # 不同盘符
        pass
    return path.replace("\\", "/")


def _engine(name: str):
    """取服务启动时实例化的引擎对象（拿不到就返回 None）。"""
    try:
        import server

        return getattr(server, name, None)
    except Exception:      # noqa: BLE001
        return None


# ── 代码熵 /api/entropy/* ────────────────────────────────────────────────

@router.post("/api/entropy/init")
async def entropy_init(project: str = "", project_root: str = ""):
    """前端在打开项目后调用；登记项目并清空上一轮状态。"""
    root = _pick(project, project_root) or current_project_root()
    _entropy_ctrl.update({"project": os.path.abspath(root), "ticks": 0,
                          "last": None, "recommendation": None})
    return {"success": True, "project": _entropy_ctrl["project"]}


@router.post("/api/entropy/ctrl/init")
async def entropy_ctrl_init():
    """会话级控制器初始化（不重复求值，只重置计数）。"""
    if not _entropy_ctrl["project"]:
        _entropy_ctrl["project"] = current_project_root()
    _entropy_ctrl.update({"ticks": 0, "last": None, "recommendation": None})
    return {"success": True, "project": _entropy_ctrl["project"], "ticks": 0}


@router.post("/api/entropy/ctrl/tick")
async def entropy_ctrl_tick():
    """跑一次项目级熵评估，并给出可执行建议。

    委托给仓库里已有的 ``advanced.EntropyEvaluator``（服务启动时就已实例化），
    不重写算法。
    """
    engine = _engine("entropy_eval")
    if engine is None:
        return {"success": False, "error": "EntropyEvaluator 不可用（advanced.py 未加载）"}
    root = _entropy_ctrl["project"] or current_project_root()
    try:
        report = engine.evaluate_project(root)
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
    _entropy_ctrl["ticks"] += 1
    _entropy_ctrl["last"] = report
    _entropy_ctrl["recommendation"] = _recommend(report)
    return {"success": True, "project": root, "ticks": _entropy_ctrl["ticks"],
            "report": report, "recommendation": _entropy_ctrl["recommendation"]}


@router.get("/api/entropy/ctrl/recommendation")
async def entropy_ctrl_recommendation():
    """读取最近一次建议（没 tick 过就现算一次，避免界面空白）。"""
    if _entropy_ctrl["recommendation"] is None:
        await entropy_ctrl_tick()
    return {"success": True, "ticks": _entropy_ctrl["ticks"],
            "recommendation": _entropy_ctrl["recommendation"],
            "report": _entropy_ctrl["last"]}


def _recommend(report) -> dict:
    """把熵报告翻译成"该做什么"。字段名做兼容处理，拿不到就只给结论。"""
    if not isinstance(report, dict):
        return {"level": "unknown", "message": "熵报告格式未知", "actions": []}
    score = None
    for key in ("average", "avg", "score", "entropy", "mean"):
        value = report.get(key)
        if isinstance(value, (int, float)):
            score = float(value)
            break
    hotspots = report.get("hotspots") or report.get("files") or []
    if isinstance(hotspots, dict):
        hotspots = sorted(hotspots.items(), key=lambda kv: kv[1], reverse=True)[:5]
    level = "unknown"
    if score is not None:
        level = "high" if score >= 0.66 else "medium" if score >= 0.33 else "low"
    actions = []
    if level == "high":
        actions.append("挑一处高熵文件做拆分或补测试，再复评")
    elif level == "medium":
        actions.append("对热点文件补充类型标注与测试")
    else:
        actions.append("当前结构健康，可继续推进功能开发")
    return {"level": level, "score": score, "hotspots": hotspots,
            "message": f"项目熵水平：{level}", "actions": actions}


# ── 仓库分析 /api/warehouse/* ────────────────────────────────────────────

@router.post("/api/warehouse/init")
async def warehouse_init(project: str = "", project_root: str = ""):
    root = _pick(project, project_root) or current_project_root()
    return {"success": True, "project": os.path.abspath(root)}


@router.post("/api/warehouse/analyze-all")
@router.get("/api/warehouse/analyze-all")
async def warehouse_analyze_all(project: str = "", project_root: str = ""):
    """全仓库分析（前端 POST 与 GET 都在用，所以两个方法都注册）。

    引擎用仓库已有的 ``advanced.WarehouseAnalyzer``；额外附上 ``tcide_core.arch``
    的架构报告（依赖图/循环/分层/异味），因为界面上的"架构"视图需要这些字段。
    """
    root = _pick(project, project_root) or current_project_root()
    result: dict = {"project": os.path.abspath(root)}
    engine = _engine("warehouse")
    if engine is not None:
        try:
            result["analysis"] = engine.analyze(root)
        except Exception as exc:      # noqa: BLE001
            result["analysis_error"] = f"{type(exc).__name__}: {exc}"
    try:
        workspace = Workspace(root)
        report = ArchAnalyzer(workspace).analyze()
        result["architecture"] = report.to_dict()
        result["summary"] = report.summary()
    except Exception as exc:      # noqa: BLE001
        result["architecture_error"] = f"{type(exc).__name__}: {exc}"
    result["success"] = "analysis" in result or "architecture" in result
    return result


@router.get("/api/warehouse/call-chain")
async def warehouse_call_chain(file: str = "", path: str = "", file_path: str = ""):
    """某个文件（或符号）调用了谁。"""
    target = _relative(_pick(file, path, file_path))
    if not target:
        return {"error": "缺少 file 参数"}
    return _graph_view(target, direction="out")


@router.get("/api/warehouse/impact")
async def warehouse_impact(file: str = "", path: str = "", file_path: str = ""):
    """改动某个文件会影响谁（反向依赖）—— 做重构/评审时最有用的一张图。"""
    target = _relative(_pick(file, path, file_path))
    if not target:
        return {"error": "缺少 file 参数"}
    return _graph_view(target, direction="in")


def _graph_view(target: str, *, direction: str) -> dict:
    """基于 ``tcide_core.indexer`` 的依赖/调用图给出 neighbors。"""
    try:
        index = ProjectIndex(_workspace())
        index.scan()
        depends = index.dependency_graph()
        calls = index.call_graph()
    except Exception as exc:      # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}", "file": target}

    if direction == "out":
        neighbors = list(depends.get(target, []))
        symbols = [name for name in calls if target in name]
        return {"file": target, "direction": "out", "count": len(neighbors),
                "depends_on": neighbors, "symbols": symbols[:50]}
    reverse: dict[str, list[str]] = {}
    for source, targets in depends.items():
        for item in targets:
            reverse.setdefault(item, []).append(source)
    neighbors = reverse.get(target, [])
    return {"file": target, "direction": "in", "count": len(neighbors),
            "depended_by": neighbors,
            "callers": [name for name in calls if target in name][:50]}


# ── 分块 /api/chunker/* ─────────────────────────────────────────────────

@router.get("/api/chunker/needs-chunking")
async def chunker_needs_chunking(file_path: str = "", path: str = "", file: str = ""):
    """这个文件是否值得分块（前端据此决定要不要走分块索引）。

    判定用已有引擎：能分块且块数 > 1 就需要。阈值集中在这里，便于调整。
    """
    name = _pick(file_path, path, file)
    if not name:
        return {"error": "缺少 file_path 参数"}
    relative = _relative(name)
    engine = _engine("chunker")
    if engine is None:
        return {"error": "SemanticChunker 不可用"}
    try:
        text = _workspace().read(relative)
    except Exception as exc:      # noqa: BLE001
        return {"error": f"读取失败：{exc}", "file": relative}
    try:
        chunks = engine.chunk_file(text, relative) or []
    except Exception as exc:      # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}", "file": relative}
    return {"file": relative, "needs_chunking": len(chunks) > 1,
            "chunks": len(chunks), "characters": len(text)}


# ── 静态检查 /api/lint ──────────────────────────────────────────────────

@router.get("/api/lint")
async def lint_file(path: str = "", file_path: str = "", file: str = ""):
    """对单个文件做静态检查。

    仓库里没有任何 linter，所以这里用 ``tcide_core.lint``（纯标准库、11 条规则、
    在 tcide-pawui 里已有回归测试）。返回结构与前端解构的字段保持一致：
    ``issues``（数组）+ ``summary``（计数）。
    """
    name = _pick(path, file_path, file)
    if not name:
        return {"error": "缺少 path 参数"}
    relative = _relative(name)
    try:
        linter = Linter(_workspace())
        issues = linter.lint_file(relative)
        return {"file": relative, "success": True,
                "issues": [item.to_dict() for item in issues],
                "summary": Linter.summary(issues)}
    except Exception as exc:      # noqa: BLE001
        return {"file": relative, "success": False,
                "error": f"{type(exc).__name__}: {exc}"}
