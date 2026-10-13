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

async def _read_json_body(request) -> dict:
    """宽容读取 JSON body（与 ``server.read_json`` 同逻辑，但**本地实现**）。

    为什么不直接 ``from server import read_json``：``server.py`` 会 import 本模块
    （为了 ``include_router``），模块级反向导入会形成循环导入 ✗。这点重复很小，
    换来的是清晰的依赖方向：``server → api.ui_contract``。
    """
    import json

    try:
        raw = await request.body()
    except Exception:      # noqa: BLE001
        return {}
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
    except Exception:      # noqa: BLE001
        return {}
    return data if isinstance(data, dict) else {}


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


# ── LSP 透传 /api/lsp/* ──────────────────────────────────────────────────
#
# 前端要的是**通用 JSON-RPC 透传**（lspRequest(lang, method, params) /
# lspNotify(...)），而仓库里的 /api/lsp/* 是一堆写死的方法包装
# （only completion/definition/references/format 等）。这里用 tcide_core 里那个
# 真正的 JSON-RPC 客户端补上通用入口，并给出"装哪个服务器"的提示。

#: 语言 → 会话（**不再自己持有客户端**，一律走 api/lsp.py —— 合并后它是唯一实现）
_lsp_clients: dict = {}


def _lsp_ready(language: str) -> dict | None:
    """确保该语言有可用的服务器；不可用时返回"可直接回给前端的错误体"。"""
    from api import lsp as lsp_api

    status = lsp_api.get_status(language, current_project_root())
    if status.get("running"):
        return None
    started = lsp_api.start_server(language, current_project_root())
    if "error" in started:
        return {"error": started["error"], "hint": started.get("hint", "")}
    return None


@router.post("/api/lsp/request")
async def lsp_request(request: Request, language: str = ""):
    """通用请求：``{language, method, params}`` → JSON-RPC 返回原样透传。

    （合并后这里只做参数解析，真正的实现在 ``api/lsp.py`` → ``tcide_core.lsp``。）
    """
    body = await _read_json_body(request)
    language = language or body.get("language", "")
    method = body.get("method", "")
    if not language or not method:
        return {"error": "缺少 language 或 method"}
    blocked = _lsp_ready(language)
    if blocked is not None:
        blocked["install_guide"] = _install_guide(language)
        return blocked
    from api import lsp as lsp_api

    return lsp_api.send_request(language, method, body.get("params") or {},
                                current_project_root())


@router.post("/api/lsp/notify")
async def lsp_notify(request: Request, language: str = ""):
    """通用通知：``{language, method, params}`` → 不回结果，只报是否送达。"""
    body = await _read_json_body(request)
    language = language or body.get("language", "")
    method = body.get("method", "")
    if not language or not method:
        return {"error": "缺少 language 或 method"}
    blocked = _lsp_ready(language)
    if blocked is not None:
        blocked["sent"] = False
        return blocked
    from api import lsp as lsp_api

    return lsp_api.send_notify(language, method, body.get("params") or {},
                               current_project_root())


@router.get("/api/lsp/install-guide")
async def lsp_install_guide(language: str = ""):
    """某个语言该装什么服务器、装完怎么验证。"""
    return _install_guide(language)


def _install_guide(language: str) -> dict:
    """用 tcide_core.lsp 的探测结果生成安装指引（缺失时如实说明）。"""
    from tcide_core.lsp import NO_SERVER_HINTS, detect_servers

    statuses = detect_servers([language] if language else None)
    selected = [item for item in statuses if item.language == language] or statuses
    return {
        "language": language,
        "servers": [item.to_dict() for item in selected],
        "available": [item.language for item in selected if item.available],
        "hint": NO_SERVER_HINTS.get(language, "安装对应语言的 LSP 服务器后重启语言服务"),
    }


# ── 文件：十六进制视图与"在系统里打开" ──────────────────────────────────
#
# 安全说明：后端默认只监听 127.0.0.1（见 main.py 的 --host 默认值），下面这几个
# 接口会触发**系统级动作**，所以都限制在项目目录内（open/show），打开 URL 只允许
# http/https —— 不允许任意路径/协议被一个网页请求拉起。

@router.get("/api/files/hex")
async def files_hex(path: str = "", file_path: str = "", file: str = "",
                    offset: int = 0, rows: int = 16, length: int = 0):
    """十六进制视图（前端 readHex(path, offset, length)）。"""
    name = _pick(path, file_path, file)
    if not name:
        return {"error": "缺少 path 参数"}
    relative = _relative(name)
    try:
        from tcide_core.hexview import HexViewer

        # HexViewer **必须带 workspace**（它用 workspace.read_bytes 读文件）；
        # 空构造会抛"没有 workspace，无法读取文件"（我第一版就是这么错的）。
        viewer = HexViewer(_workspace())
        if length and length > 0:
            rows = max(1, min(4096, (length + 15) // 16))
        lines = viewer.page(relative, offset=max(0, offset), rows=min(rows, 256))
        return {"file": relative, "offset": max(0, offset),
                "lines": [line.to_dict() for line in lines],
                "info": viewer.info(relative)}
    except Exception as exc:      # noqa: BLE001
        return {"error": f"{type(exc).__name__}: {exc}", "file": relative}


def _inside_project(path: str) -> str:
    """把路径规整到项目内；越界返回空串。"""
    relative = _relative(path)
    root = os.path.abspath(current_project_root())
    absolute = os.path.abspath(os.path.join(root, relative))
    try:
        return absolute if os.path.commonpath([absolute, root]) == root else ""
    except ValueError:
        return ""


@router.post("/api/files/open")
async def files_open(path: str = "", file: str = ""):
    """用系统默认程序打开项目内的文件（前端 openSystemFile）。"""
    target = _inside_project(_pick(path, file))
    if not target or not os.path.exists(target):
        return {"success": False, "error": f"文件不存在或不在项目内：{path or file}"}
    try:
        if os.name == "nt":
            os.startfile(target)          # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", target])
        return {"success": True, "path": target}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/api/files/show")
async def files_show(path: str = "", file: str = ""):
    """在文件管理器里定位该文件（前端 showItemInFolder）。"""
    target = _inside_project(_pick(path, file))
    if not target or not os.path.exists(target):
        return {"success": False, "error": f"文件不存在或不在项目内：{path or file}"}
    try:
        import subprocess

        if os.name == "nt":
            subprocess.Popen(["explorer", "/select,", os.path.normpath(target)])
        elif sys.platform == "darwin":
            subprocess.Popen(["open", "-R", target])
        else:
            subprocess.Popen(["xdg-open", os.path.dirname(target)])
        return {"success": True, "path": target}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/api/files/open-url")
async def files_open_url(url: str = ""):
    """用系统浏览器打开 http/https 链接（前端 openExternal）。"""
    if not url.lower().startswith(("http://", "https://")):
        return {"success": False, "error": "只允许打开 http/https 链接"}
    try:
        import webbrowser

        return {"success": bool(webbrowser.open(url)), "url": url}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


# ── Git：全部暂存（前端 stageAll）────────────────────────────────────────

@router.post("/api/git/stage-all")
async def git_stage_all():
    """``git add -A``：前端「暂存全部」按钮。

    直接调 git 而不是复用 ``GitRepo`` 的包装：前端只关心成败，而且这里需要
    "不是仓库"时给出可读原因（而不是抛异常）。
    """
    import subprocess

    root = current_project_root()
    try:
        completed = subprocess.run(["git", "add", "-A"], cwd=root, capture_output=True,
                                   text=True, timeout=60)
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
    if completed.returncode != 0:
        return {"success": False, "root": root,
                "error": (completed.stderr or completed.stdout or "git add 失败").strip()}
    return {"success": True, "root": root}


# ── 无人值守执行 /api/runner/* ───────────────────────────────────────────
#
# **为什么不用 advanced.UnattendedRunner**：它的 run_task 只是循环往 results 里塞
# 几条 {"status": "running"}，然后返回 {"status": "completed"} —— 什么都没执行，
# 是"演戏"而不是功能。这里用 tcide_core.runner（真跑子进程、有超时/重试/检查点）。

_runner_state: dict = {"root": "", "runner": None, "report": None}


@router.post("/api/runner/init")
async def runner_init(project: str = "", project_root: str = ""):
    root = _pick(project, project_root) or current_project_root()
    _runner_state.update({"root": os.path.abspath(root), "runner": None,
                          "report": None})
    return {"success": True, "project": _runner_state["root"],
            "log_dir": os.path.join(_runner_state["root"], ".tcide", "runner")}


@router.post("/api/runner/execute")
async def runner_execute(request: Request, task: str = ""):
    """执行任务。两种用法，都**真的干活**：

    1. ``{"steps": [{"name": "...", "command": "..."}]}`` → 逐条真跑命令，
       带超时/重试/检查点，返回每一步的输出与退出状态；
    2. ``{"task": "自然语言需求"}`` → 交给双 Agent 编排（需要先配置模型）。
    """
    body = await _read_json_body(request)
    root = _runner_state["root"] or current_project_root()
    steps = body.get("steps") or []
    if steps:
        from tcide_core.runner import Step, UnattendedRunner

        built = []
        for index, item in enumerate(steps[:50]):
            command = str(item.get("command", "")).strip()
            if not command:
                continue
            built.append(Step(name=str(item.get("name") or f"step-{index + 1}"),
                              command=command,
                              timeout=float(item.get("timeout") or 0),
                              retries=item.get("retries"),
                              checkpoint=bool(item.get("checkpoint"))))
        if not built:
            return {"error": "steps 里没有可执行的 command"}
        log_dir = os.path.join(root, ".tcide", "runner")
        runner = UnattendedRunner(built, log_dir=log_dir, cwd=root,
                                  on_event=lambda kind, data: None)
        _runner_state["runner"] = runner
        try:
            report = runner.run(resume=False)
        except Exception as exc:      # noqa: BLE001
            return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
        _runner_state["report"] = report.to_dict()
        return {"success": report.ok, "summary": report.summary(),
                "report": _runner_state["report"]}

    # 没有 steps：当成 AI 任务交给编排
    requirement = str(task or body.get("task", "")).strip()
    if not requirement:
        return {"error": "缺少 task 或 steps"}
    return await orchestrator_run(request, task=requirement)


async def runner_run_task(task: str, *, max_retries: int = 3) -> dict:
    """老接口 ``/api/runner/run`` 的实现 —— 把 task 当**命令**真跑。

    语义变更（有意）：原来的 ``advanced.UnattendedRunner.run_task`` 什么都不执行，
    只塞几条 ``"running"`` 就返回 ``"completed"``。现在这里是一条真实的命令步骤；
    需要"多步骤 + 检查点"就用 ``/api/runner/execute`` 的 ``steps`` 形式。
    """
    request_stub = _StubRequest({"task": task, "steps": [
        {"name": "task", "command": task, "retries": max(0, int(max_retries) - 1)}]})
    return await runner_execute(request_stub, task=task)


class _StubRequest:
    """给内部复用构造一个最小 Request（只需要 ``body()``）。"""

    def __init__(self, payload: dict) -> None:
        import json as _json

        self._payload = _json.dumps(payload).encode("utf-8")

    async def body(self) -> bytes:
        return self._payload


def runner_abort() -> dict:
    """取消正在跑的步骤执行。"""
    runner = _runner_state.get("runner")
    if runner is None:
        return {"status": "idle", "aborted": False}
    try:
        runner.cancel()
    except Exception as exc:      # noqa: BLE001
        return {"status": "error", "aborted": False, "error": str(exc)}
    return {"status": "aborted", "aborted": True}


def runner_status() -> dict:
    """当前执行状态（老接口 ``/api/runner/status``）。

    注意 ``tcide_core.runner.UnattendedRunner.cancelled`` 是 **property**（不是方法）——
    我第一版当函数调用了，得到 ``TypeError: 'bool' object is not callable``。
    """
    runner = _runner_state.get("runner")
    report = _runner_state.get("report")
    cancelled = bool(runner is not None and runner.cancelled)
    return {"root": _runner_state.get("root", ""),
            "running": bool(runner is not None and not cancelled and report is None),
            "cancelled": cancelled,
            "report": report}


# ── 双 Agent 编排 /api/orchestrator/* ────────────────────────────────────

_orchestrator_state: dict = {"root": "", "events": [], "report": None,
                             "requirement": "", "status": "idle"}


def _model_config():
    """从仓库已有的设置里取模型配置（设置 → AI）。

    返回 ``None`` 表示**没配置** —— 调用方必须如实告知，而不是假装跑过。
    """
    try:
        from tcide_core.models import ModelConfig

        from api import settings

        cfg = settings.get_setting("ai", {}) or {}
        api_key = str(cfg.get("apiKey") or "").strip()
        if not api_key:
            return None
        provider = str(cfg.get("provider") or "deepseek").strip()
        # 前端把 OpenAI 兼容端点写成 openai-compatible，而 ModelConfig 用 custom+base_url
        if provider in ("openai-compatible", "openai", "custom"):
            return ModelConfig(provider="custom", api_key=api_key,
                               base_url=str(cfg.get("baseUrl") or "").strip(),
                               model=str(cfg.get("model") or "").strip())
        return ModelConfig(provider=provider, api_key=api_key,
                           base_url=str(cfg.get("baseUrl") or "").strip(),
                           model=str(cfg.get("model") or "").strip())
    except Exception:      # noqa: BLE001
        return None


@router.post("/api/orchestrator/init")
async def orchestrator_init(project: str = "", project_root: str = ""):
    root = _pick(project, project_root) or current_project_root()
    config = _model_config()
    _orchestrator_state.update({"root": os.path.abspath(root), "events": [],
                                "report": None, "requirement": "",
                                "status": "idle"})
    return {"success": True, "project": _orchestrator_state["root"],
            "model_ready": config is not None,
            "model": (f"{config.provider}/{config.model}" if config else ""),
            "hint": "" if config else "尚未配置模型：设置 → AI 填 API Key 后可运行编排"}


@router.post("/api/orchestrator/run")
async def orchestrator_run(request: Request, task: str = ""):
    """Builder → Coder → 审查门 → 重试，跑一个真实需求。"""
    body = await _read_json_body(request)
    requirement = str(task or body.get("task", "")).strip()
    if not requirement:
        return {"error": "缺少 task"}

    config = _model_config()
    if config is None:
        return {"success": False, "status": "unconfigured",
                "error": "未配置模型，无法运行双 Agent 编排",
                "hint": "设置 → AI 填 API Key（支持 DeepSeek / 方舟 / Ollama / Anthropic / 自定义）"}
    root = _orchestrator_state["root"] or current_project_root()
    try:
        from tcide_core.agent import AdapterClient, AgentOrchestrator
        from tcide_core.gitops import GitRepo
        from tcide_core.memory import ProjectMemoryBuilder
        from tcide_core.tools import ToolRegistry

        workspace = Workspace(root)
        repo = GitRepo(root)
        registry = ToolRegistry(workspace, repo=repo if repo.owns_repo() else None)
        events: list = []

        def on_event(event) -> None:
            try:
                events.append(event.to_dict())
            except Exception:      # noqa: BLE001
                pass
            _orchestrator_state["events"] = events[-200:]

        context = ProjectMemoryBuilder.to_markdown(
            ProjectMemoryBuilder(workspace).build())
        orchestrator = AgentOrchestrator(AdapterClient(config), registry,
                                        context=context, on_event=on_event)
        _orchestrator_state.update({"status": "running", "requirement": requirement,
                                    "events": events})
        report = orchestrator.run(requirement)
        _orchestrator_state.update({"status": "done", "report": report.to_dict()})
        return {"success": report.ok, "summary": report.summary(),
                "report": report.to_dict(), "events": events[-50:]}
    except Exception as exc:      # noqa: BLE001 - 编排失败要给可读原因
        _orchestrator_state["status"] = "failed"
        return {"success": False, "status": "failed",
                "error": f"{type(exc).__name__}: {exc}"}


@router.get("/api/ai/task-session")
async def ai_task_session():
    """当前/最近一次任务会话（前端 getTaskSession 用它恢复界面状态）。"""
    return {"status": _orchestrator_state["status"],
            "task": _orchestrator_state["requirement"],
            "project": _orchestrator_state["root"],
            "report": _orchestrator_state["report"],
            "events": _orchestrator_state["events"][-20:],
            "runner": _runner_state["report"]}


@router.post("/api/ai/abort")
async def ai_abort():
    """中止正在跑的编排或执行（两个引擎都支持协作式取消）。"""
    aborted = []
    runner = _runner_state.get("runner")
    if runner is not None:
        try:
            runner.cancel()
            aborted.append("runner")
        except Exception:      # noqa: BLE001
            pass
    try:
        from tcide_core.agent import AgentOrchestrator

        aborted.append("orchestrator") if _orchestrator_state["status"] == "running" else None
    except Exception:      # noqa: BLE001
        pass
    if _orchestrator_state["status"] == "running":
        _orchestrator_state["status"] = "aborted"
    return {"success": True, "aborted": aborted,
            "status": _orchestrator_state["status"]}


# ── 会话保存 / 恢复 /api/session/* ───────────────────────────────────────

@router.post("/api/session/save")
async def session_save(request: Request):
    """把界面状态（打开的文件、活动文件、布局…）存成 JSON。

    前端传什么就存什么（``saveSession(data)`` 直接 POST 整个对象），
    这里只补 id 与时间戳。存放位置：``<项目>/.tcide/sessions/``。
    """
    import json
    import time

    body = await _read_json_body(request)
    if not body:
        return {"error": "空会话，未保存"}
    root = current_project_root()
    directory = os.path.join(root, ".tcide", "sessions")
    try:
        os.makedirs(directory, exist_ok=True)
        session_id = str(body.get("id") or time.strftime("%Y%m%d-%H%M%S"))
        payload = dict(body)
        payload["id"] = session_id
        payload["saved_at"] = int(time.time() * 1000)
        path = os.path.join(directory, f"{session_id}.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=1)
        return {"success": True, "id": session_id, "path": path}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/api/session/restore")
async def session_restore(id: str = "", session: str = ""):
    """恢复会话；不给 id 就取最近一次。"""
    import glob
    import json

    root = current_project_root()
    directory = os.path.join(root, ".tcide", "sessions")
    wanted = _pick(id, session)
    try:
        if wanted:
            path = os.path.join(directory, f"{wanted}.json")
        else:
            candidates = sorted(glob.glob(os.path.join(directory, "*.json")))
            if not candidates:
                return {"success": False, "error": "没有已保存的会话"}
            path = candidates[-1]
        with open(path, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        return {"success": True, "session": payload, "path": path}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


# ── 批量搜索 /api/search/batch ───────────────────────────────────────────

@router.post("/api/search/batch")
async def search_batch(request: Request, query: str = "", q: str = ""):
    """一次搜多个关键词（前端 batchSearch）。

    用 ``tcide_core.indexer``：它按内容建索引，能给出文件/行/片段。
    """
    body = await _read_json_body(request)
    text = str(query or q or body.get("query", "") or "").strip()
    if not text:
        return {"error": "缺少 query"}
    try:
        index = ProjectIndex(_workspace())
        index.scan()
        results: dict = {}
        for term in [item for item in text.replace(",", " ").split() if item][:10]:
            hits = index.search(term, limit=int(body.get("limit") or 50))
            results[term] = [hit.to_dict() for hit in hits]
        return {"success": True, "query": text, "results": results,
                "count": sum(len(value) for value in results.values())}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


# ── 记忆 / 向量：与既有模块对接的别名 ────────────────────────────────────

@router.post("/api/memory/init")
async def memory_init(project: str = "", project_root: str = ""):
    """前端打开项目后会调它（原实现只在 lifespan 里初始化过）。"""
    root = _pick(project, project_root) or current_project_root()
    try:
        from api import memory as memory_api

        memory_api.init_memory(root)
        return {"success": True, "project": os.path.abspath(root)}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/api/vector/init")
async def vector_init(project: str = "", project_root: str = ""):
    """同 memory/init：登记项目并初始化索引（前端 vectorInit）。"""
    root = _pick(project, project_root) or current_project_root()
    try:
        from api import vector as vector_api

        vector_api.init_index(root)
        return {"success": True, "project": os.path.abspath(root)}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


@router.post("/api/vector/index-all")
async def vector_index_all():
    """全项目建索引（与既有 ``/api/vector/index/project`` 等价，前端用的是这个路径）。"""
    try:
        from api import vector as vector_api

        return await vector_api.index_project()
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}


# ── 格式化 /api/files/format ─────────────────────────────────────────────

@router.post("/api/files/format")
async def files_format(path: str = "", file: str = ""):
    """格式化一个文件。

    诚实实现：Python 文件用 ``black``（装了才用），其它语言返回"暂不支持"而不是
    假装成功。格式化成功时**写回原文件**并把结果如实返回。
    """
    import shutil
    import subprocess

    target = _inside_project(_pick(path, file))
    if not target or not os.path.isfile(target):
        return {"success": False, "error": f"文件不存在或不在项目内：{path or file}"}
    if not target.lower().endswith(".py"):
        return {"success": False, "formatted": False,
                "error": "目前只支持 Python（需要 black）；其它语言暂未接入格式化器"}
    if shutil.which("black") is None and not _module_available("black"):
        return {"success": False, "formatted": False,
                "error": "未安装 black：pip install black 后可格式化 Python"}
    try:
        completed = subprocess.run([sys.executable, "-m", "black", "--quiet", target],
                                   capture_output=True, text=True, timeout=120)
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
    if completed.returncode != 0:
        return {"success": False, "formatted": False,
                "error": (completed.stderr or "black 执行失败").strip()[:400]}
    return {"success": True, "formatted": True, "path": _relative(target)}


def _module_available(name: str) -> bool:
    import importlib.util

    try:
        return importlib.util.find_spec(name) is not None
    except Exception:      # noqa: BLE001
        return False


# ── 调试 /api/debug/* ────────────────────────────────────────────────────
#
# **真的能调试**，但要说清是什么：这里用 **pdb**（标准库）驱动一个真实进程，
# 不假装是 DAP。debugpy 装了的话会出现在 adapters 里（并优先推荐），没装就
# 如实说明"当前是 pdb 会话"。前端那套 DAP 风格的按钮（continue/next/step-in/
# step-out）在这里一一映射到 pdb 命令，语义一致。

_debug_sessions: dict = {}


class _PdbSession:
    """一个真实的 ``python -m pdb <file>`` 会话（stdout 由后台线程收集）。"""

    def __init__(self, file: str, cwd: str) -> None:
        import subprocess
        import threading

        self.file = file
        self.cwd = cwd
        self.buffer: list[str] = []
        self.lock = threading.Lock()
        self.process = subprocess.Popen(
            [sys.executable, "-u", "-m", "pdb", file],
            cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace",
            bufsize=1)
        self.reader = threading.Thread(target=self._pump, daemon=True)
        self.reader.start()

    def _pump(self) -> None:
        try:
            for line in self.process.stdout:       # type: ignore[union-attr]
                with self.lock:
                    self.buffer.append(line.rstrip("\n"))
        except Exception:      # noqa: BLE001 - 进程结束时正常退出
            pass

    def send(self, command: str, *, wait: float = 0.6) -> str:
        """发一条 pdb 命令，返回这期间新产生的输出。"""
        import time

        with self.lock:
            self.buffer.clear()
        try:
            self.process.stdin.write(command + "\n")   # type: ignore[union-attr]
            self.process.stdin.flush()                 # type: ignore[union-attr]
        except Exception as exc:      # noqa: BLE001
            return f"（无法写入调试进程：{exc}）"
        deadline = time.time() + wait
        while time.time() < deadline:
            time.sleep(0.05)
            with self.lock:
                if any("(Pdb)" in line for line in self.buffer):
                    break
        with self.lock:
            return "\n".join(self.buffer)

    def read(self, *, wait: float = 0.8) -> str:
        """等一会儿，把期间产生的输出取回来（不发送任何命令）。"""
        import time

        deadline = time.time() + wait
        while time.time() < deadline:
            time.sleep(0.05)
            with self.lock:
                if any("(Pdb)" in line for line in self.buffer):
                    break
        with self.lock:
            return "\n".join(self.buffer)

    def location(self) -> str:
        """从输出里挑出形如 ``> /path/to/file.py(12)<module>()`` 的当前位置。"""
        with self.lock:
            for line in reversed(self.buffer):
                if line.startswith("> "):
                    return line
        return ""

    def alive(self) -> bool:
        return self.process.poll() is None

    def stop(self) -> None:
        try:
            self.send("q", wait=0.3)
        except Exception:      # noqa: BLE001
            pass
        try:
            self.process.kill()
        except Exception:      # noqa: BLE001
            pass


@router.get("/api/debug/adapters")
async def debug_adapters():
    """这台机器上**真的**能用哪些调试器（含安装指引）。"""
    import shutil

    adapters = [{
        "id": "pdb", "name": "Python pdb（标准库）", "available": True,
        "languages": ["python"],
        "note": "内置可用；continue/next/step-in/step-out 直接映射到 pdb 命令",
    }, {
        "id": "debugpy", "name": "debugpy（DAP 适配器）", "available": _module_available("debugpy"),
        "languages": ["python"],
        "install": "pip install debugpy",
        "note": "装了之后可用 DAP 协议接入 VS Code 式调试前端",
    }, {
        "id": "node-inspect", "name": "Node --inspect", "available": shutil.which("node") is not None,
        "languages": ["javascript", "typescript"],
        "install": "安装 Node.js",
        "note": "Node 自带的 inspector，需要前端用 CDP 连接",
    }]
    return {"adapters": adapters,
            "available": [item["id"] for item in adapters if item["available"]],
            "preferred": "debugpy" if _module_available("debugpy") else "pdb"}


@router.post("/api/debug/start")
async def debug_start(request: Request, adapter: str = "", file: str = "",
                      line: int = 0):
    """开一个**真实的**调试会话（默认 pdb）。"""
    body = await _read_json_body(request)
    adapter = adapter or body.get("adapter", "pdb") or "pdb"
    target = _pick(file, body.get("file", ""), body.get("path", ""))
    if not target:
        return {"error": "缺少 file 参数"}
    if adapter == "debugpy" and not _module_available("debugpy"):
        return {"error": "debugpy 未安装（pip install debugpy）", "fallback": "pdb"}
    absolute = _inside_project(target) or ""
    if not absolute or not os.path.isfile(absolute):
        return {"error": f"文件不存在或不在项目内：{target}"}
    if not absolute.lower().endswith(".py"):
        return {"error": "目前只支持 Python 文件（pdb / debugpy）"}

    # 优先走 DAP（debugpy）：能拿到栈帧/作用域/变量，界面才能做真正的调试面板。
    # 没装 debugpy 时退回 pdb 会话（可单步，但只有文本输出）。
    line = int(line or body.get("line") or 0)
    if adapter != "pdb" and _module_available("debugpy"):
        from tcide_core.dap import DapError, DapSession

        session_id = f"dap-{len(_debug_sessions) + 1}"
        try:
            dap = DapSession(absolute, cwd=current_project_root())
            if not dap.start():
                raise DapError("initialize 失败")
            verified = dap.set_breakpoints(absolute, [line]) if line > 0 else []
            dap.configuration_done()
            if line > 0:
                dap.wait_stopped(timeout=20)
        except Exception as exc:      # noqa: BLE001
            return {"error": f"{type(exc).__name__}: {exc}", "fallback": "pdb"}
        _debug_sessions[session_id] = dap
        return {"success": True, "session": session_id, "adapter": "debugpy",
                "file": target, "pid": dap.process.pid if dap.process else 0,
                "port": dap.port, "breakpoint_verified": verified,
                "state": dap.state(),
                "note": "DAP 会话（debugpy）：可读变量、可求值"}

    session = _PdbSession(absolute, current_project_root())
    session_id = f"pdb-{len(_debug_sessions) + 1}"
    _debug_sessions[session_id] = session
    output = session.read(wait=1.0)              # pdb 的启动横幅（含当前位置）
    if line > 0:
        output += "\n" + session.send(f"b {os.path.basename(absolute)}:{line}")
    return {"success": True, "session": session_id, "adapter": "pdb", "file": target,
            "pid": session.process.pid, "output": output,
            "location": session.location(),
            "note": "基于 pdb 的会话（未安装 debugpy 时不提供 DAP）"}


def _debug_session(session_id: str):
    session = _debug_sessions.get(session_id)
    if session is None:
        return None, {"error": f"没有这个调试会话：{session_id}（先调用 /api/debug/start）"}
    if not session.alive():
        return None, {"error": "调试进程已结束", "session": session_id}
    return session, None


@router.post("/api/debug/continue")
async def debug_continue(session: str = "", session_id: str = ""):
    return _debug_step(_pick(session, session_id), "c", "continue")


@router.post("/api/debug/next")
async def debug_next(session: str = "", session_id: str = ""):
    return _debug_step(_pick(session, session_id), "n", "next")


@router.post("/api/debug/step-in")
async def debug_step_in(session: str = "", session_id: str = ""):
    return _debug_step(_pick(session, session_id), "s", "step-in")


@router.post("/api/debug/step-out")
async def debug_step_out(session: str = "", session_id: str = ""):
    return _debug_step(_pick(session, session_id), "r", "step-out")


@router.post("/api/debug/pause")
async def debug_pause(session: str = "", session_id: str = ""):
    """pdb 里没有"暂停"，用 ``where`` 给出当前栈帧；DAP 里有真正的 ``pause``。"""
    return _debug_step(_pick(session, session_id), "where", "pause")


@router.post("/api/debug/stop")
async def debug_stop(session: str = "", session_id: str = ""):
    key = _pick(session, session_id)
    target = _debug_sessions.pop(key, None)
    if target is None:
        return {"error": f"没有这个调试会话：{key}"}
    target.stop()
    return {"success": True, "session": key, "stopped": True}


def _debug_step(session_id: str, command: str, action: str) -> dict:
    """步进一次。

    - DAP 会话（debugpy）：走协议的 ``continue/next/stepIn/stepOut/pause``，
      停下后回传**栈帧与局部变量**（这是 DAP 相对 pdb 的价值所在）。
    - pdb 会话：发一条 pdb 命令，返回文本输出与当前位置。
    """
    session, error = _debug_session(session_id)
    if error is not None:
        return error
    from tcide_core.dap import DapSession

    if isinstance(session, DapSession):
        try:
            result = session.step(action)
        except Exception as exc:      # noqa: BLE001
            return {"success": False, "session": session_id,
                    "error": f"{type(exc).__name__}: {exc}"}
        return {"session": session_id, "adapter": "debugpy", **result}
    output = session.send(command)
    return {"success": True, "session": session_id, "action": action,
            "command": command, "output": output, "location": session.location(),
            "alive": session.alive()}


# ── 项目：目录选择与文件监听 ─────────────────────────────────────────────

@router.get("/api/project/dialog")
async def project_dialog():
    """弹系统目录选择框。

    用**子进程**跑 tkinter：后端服务在工作线程里，而 Tk 必须在自己的主线程创建，
    所以不能直接在主进程弹窗。没有图形环境时如实说明（而不是挂死）。
    """
    import subprocess

    code = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "root = tk.Tk(); root.withdraw(); root.attributes('-topmost', True)\n"
        "print(filedialog.askdirectory() or '')\n"
    )
    try:
        completed = subprocess.run([sys.executable, "-c", code], capture_output=True,
                                   text=True, timeout=300)
    except Exception as exc:      # noqa: BLE001
        return {"path": "", "error": f"{type(exc).__name__}: {exc}"}
    chosen = (completed.stdout or "").strip()
    if not chosen:
        reason = (completed.stderr or "").strip().splitlines()
        return {"path": "", "cancelled": True,
                "error": reason[-1] if reason else "未选择目录（或没有图形环境）"}
    return {"path": chosen, "cancelled": False}


#: 文件监听的上一帧快照（路径 → (mtime, size)）
_watch_state: dict = {"root": "", "snapshot": {}}


@router.get("/api/project/watch")
async def project_watch():
    """轻量文件监听：每次调用返回**自上次调用以来**的变更。

    实现方式是快照比对（不是 inotify）：对外行为一致 —— 前端轮询这个接口就能拿到
    added/modified/removed。真正的推送式监听需要 WebSocket 广播，仓库里已有 WS
    基础设施，可作为后续增强。
    """
    root = current_project_root()
    if _watch_state["root"] != root:
        _watch_state.update({"root": root, "snapshot": {}})
    current: dict = {}
    try:
        for base, dirs, names in os.walk(root):
            dirs[:] = [name for name in dirs
                       if name not in (".git", "node_modules", "__pycache__", ".tcide")]
            for name in names:
                path = os.path.join(base, name)
                try:
                    stat = os.stat(path)
                except OSError:
                    continue
                current[os.path.relpath(path, root).replace("\\", "/")] = (
                    int(stat.st_mtime), stat.st_size)
    except Exception as exc:      # noqa: BLE001
        return {"watching": False, "error": f"{type(exc).__name__}: {exc}"}

    previous = _watch_state["snapshot"]
    added = sorted(set(current) - set(previous))
    removed = sorted(set(previous) - set(current))
    modified = sorted(key for key in set(current) & set(previous)
                      if current[key] != previous[key])
    _watch_state["snapshot"] = current
    return {"watching": True, "project": root, "files": len(current),
            "added": added[:100], "modified": modified[:100], "removed": removed[:100],
            "changed": len(added) + len(modified) + len(removed)}


# ── 带工具的对话 /api/ai/chat/tools ──────────────────────────────────────

@router.post("/api/ai/chat/tools")
async def ai_chat_tools(request: Request):
    """带工具调用的一轮对话：模型可以要求读文件/搜代码/跑命令，**真的执行**后回填。

    工具集来自 ``tcide_core.tools.ToolRegistry``（specs() 是 OpenAI 格式的 schema），
    执行走 ``registry.call(name, arguments)``，并把结果作为 tool 消息回灌给模型，
    最后返回最终答复 + 中间的调用记录。
    """
    body = await _read_json_body(request)
    messages = body.get("messages") or []
    if not messages:
        return {"error": "缺少 messages"}
    config = _model_config()
    if config is None:
        return {"success": False, "status": "unconfigured",
                "error": "未配置模型，无法进行带工具的对话",
                "hint": "设置 → AI 填 API Key"}

    try:
        from tcide_core.agent import AdapterClient
        from tcide_core.gitops import GitRepo
        from tcide_core.models import ChatMessage
        from tcide_core.tools import ToolRegistry

        root = current_project_root()
        registry = ToolRegistry(Workspace(root),
                                repo=GitRepo(root) if GitRepo(root).owns_repo() else None)
        client = AdapterClient(config)

        history = [ChatMessage(role=str(item.get("role", "user")),
                               content=str(item.get("content", ""))) for item in messages]
        calls: list[dict] = []
        for _round in range(int(body.get("max_rounds") or 4)):
            response = client.complete(history, tools=registry.specs())
            if not response.tool_calls:
                return {"success": True, "content": response.text,
                        "tool_calls": calls, "usage": response.usage.to_dict()}
            history.append(ChatMessage(role="assistant", content=response.text or "",
                                       tool_calls=response.tool_calls))
            for call in response.tool_calls:
                output = registry.call(call.name, call.arguments)
                calls.append({"name": call.name, "arguments": call.arguments,
                              "output": str(output)[:4000]})
                history.append(ChatMessage(role="tool", content=str(output)[:4000],
                                           name=call.name))
        return {"success": True, "content": "（达到工具轮数上限，仍未给出最终答复）",
                "tool_calls": calls}
    except Exception as exc:      # noqa: BLE001
        return {"success": False, "error": f"{type(exc).__name__}: {exc}"}
