"""
TCIDE Python - FastAPI 后端服务
"""
import asyncio
import json
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles

# 确保模块路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from api import files, git_ops, terminal, ai, settings

# ── 生命周期 ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.init_settings("tcide")
    print(f"[TCIDE] Server starting, project root: {files._project_root}")
    yield
    # 清理终端
    for tid in list(terminal._terminals.keys()):
        terminal.close_terminal(tid)
    print("[TCIDE] Server stopped")


app = FastAPI(title="TCIDE", version="1.0.0", lifespan=lifespan)

# 静态文件
static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
if os.path.isdir(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


# ── 页面 ──

@app.get("/")
async def index():
    html_path = os.path.join(static_dir, "index.html")
    if os.path.exists(html_path):
        return FileResponse(html_path, media_type="text/html")
    return HTMLResponse("<h1>TCIDE</h1><p>index.html not found</p>")


# ── 项目 ──

@app.post("/api/project/open")
async def open_project(request: Request):
    body = await request.json()
    path = body.get("path", "")
    if not os.path.isdir(path):
        return {"error": f"Not a directory: {path}"}
    files.set_project_root(path)
    git_ops.set_project_root(path)
    settings.add_recent_project(path)
    return {"success": True, "path": path, "name": os.path.basename(path)}


@app.get("/api/project/recent")
async def recent_projects():
    return {"projects": settings.get_recent_projects()}


# ── 文件操作 ──

@app.get("/api/files/list")
async def list_files(path: str = "", depth: int = 1):
    return {"items": files.read_dir(path, depth)}


@app.get("/api/files/read")
async def read_file(path: str):
    return files.read_file(path)


@app.post("/api/files/write")
async def write_file(request: Request):
    body = await request.json()
    return files.write_file(body["path"], body["content"])


@app.post("/api/files/delete")
async def delete_file(request: Request):
    body = await request.json()
    return files.delete_file(body["path"])


@app.post("/api/files/rename")
async def rename_file(request: Request):
    body = await request.json()
    return files.rename_file(body["oldPath"], body["newPath"])


@app.post("/api/files/mkdir")
async def create_dir(request: Request):
    body = await request.json()
    return files.create_directory(body["path"])


# ── Git ──

@app.get("/api/git/status")
async def git_status():
    return git_ops.git_status()


@app.get("/api/git/diff")
async def git_diff(path: str = ""):
    return git_ops.git_diff(path or None)


@app.post("/api/git/stage")
async def git_stage():
    return git_ops.git_stage_all()


@app.post("/api/git/commit")
async def git_commit(request: Request):
    body = await request.json()
    return git_ops.git_commit(body["message"])


@app.post("/api/git/push")
async def git_push(request: Request):
    body = await request.json()
    return git_ops.git_push(body.get("remote", "origin"), body.get("branch", ""))


@app.get("/api/git/log")
async def git_log(count: int = 20):
    return git_ops.git_log(count)


@app.get("/api/git/branches")
async def git_branches():
    return git_ops.git_branches()


@app.post("/api/git/checkout")
async def git_checkout(request: Request):
    body = await request.json()
    return git_ops.git_checkout(body["branch"])


# ── 终端 ──

@app.post("/api/terminal/create")
async def create_terminal(request: Request):
    body = await request.json()
    return terminal.create_terminal(body.get("cwd", files._project_root or os.getcwd()))


@app.post("/api/terminal/write")
async def write_terminal(request: Request):
    body = await request.json()
    return terminal.write_terminal(body["id"], body["data"])


@app.get("/api/terminal/read/{terminal_id}")
async def read_terminal(terminal_id: str):
    return terminal.read_terminal(terminal_id)


@app.post("/api/terminal/close")
async def close_terminal(request: Request):
    body = await request.json()
    return terminal.close_terminal(body["id"])


@app.get("/api/terminal/list")
async def list_terminals():
    return {"terminals": terminal.list_terminals()}


@app.post("/api/exec")
async def exec_command(request: Request):
    body = await request.json()
    return terminal.exec_command(
        body["command"],
        body.get("cwd", files._project_root or os.getcwd()),
        body.get("timeout", 30),
    )


# ── AI ──

@app.post("/api/ai/configure")
async def ai_configure(request: Request):
    body = await request.json()
    return ai.configure(body)


@app.post("/api/ai/chat/stream")
async def ai_chat_stream(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    system_prompt = body.get("system_prompt", "")

    async def generate():
        async for chunk in ai.chat_stream(messages, system_prompt):
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/ai/orchestrate")
async def ai_orchestrate(request: Request):
    body = await request.json()

    async def generate():
        async for chunk in ai.agent_orchestrate(
            body.get("requirement", ""),
            body.get("project_context", ""),
            body.get("file_contents", {}),
        ):
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/ai/build")
async def ai_build(request: Request):
    body = await request.json()
    return await ai.agent_build(body.get("requirement", ""), body.get("project_context", ""))


@app.post("/api/ai/code")
async def ai_code(request: Request):
    body = await request.json()
    return await ai.agent_code(body.get("task", ""), body.get("project_context", ""), body.get("file_contents", {}))


# ── 设置 ──

@app.get("/api/settings")
async def get_settings():
    return settings.get_settings()


@app.post("/api/settings")
async def set_settings(request: Request):
    body = await request.json()
    for k, v in body.items():
        settings.set_setting(k, v)
    return {"success": True}


@app.get("/api/settings/ai")
async def get_ai_settings():
    return settings.get_setting("ai", {})


@app.post("/api/settings/ai")
async def set_ai_settings(request: Request):
    body = await request.json()
    for k, v in body.items():
        settings.set_setting(f"ai.{k}", v)
    # 自动配置 AI 引擎
    ai_config = settings.get_setting("ai", {})
    ai.configure({
        "provider": ai_config.get("provider", "openai-compatible"),
        "base_url": ai_config.get("baseUrl", ""),
        "api_key": ai_config.get("apiKey", ""),
        "model": ai_config.get("model", ""),
    })
    return {"success": True}


# ── 系统 ──

@app.get("/api/health")
async def health():
    return {"status": "ok", "timestamp": int(time.time() * 1000), "version": "1.0.0"}


# ── 终端 WebSocket ──

@app.websocket("/ws/terminal/{terminal_id}")
async def terminal_ws(websocket: WebSocket, terminal_id: str):
    await websocket.accept()
    term = terminal._terminals.get(terminal_id)
    if not term:
        await websocket.close(code=4004, reason="Terminal not found")
        return

    try:
        while term.is_alive():
            # 读取用户输入
            try:
                data = await asyncio.wait_for(websocket.receive_text(), timeout=0.05)
                term.write(data)
            except asyncio.TimeoutError:
                pass
            except WebSocketDisconnect:
                break

            # 推送输出
            output = term.read_all()
            if output:
                await websocket.send_text(output)

            await asyncio.sleep(0.02)
    except Exception:
        pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
