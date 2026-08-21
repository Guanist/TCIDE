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

from api import files, git_ops, terminal, ai, settings, lsp, mcp, memory, vector, snapshot, usage, debug

# ── 生命周期 ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.init_settings("tcide")
    print(f"[TCIDE] Server starting, project root: {files._project_root}")
    yield
    # 清理终端
    for tid in list(terminal._terminals.keys()):
        terminal.close_terminal(tid)
    # 停止所有 LSP 服务器
    lsp.shutdown_all()
    # 断开所有 MCP 连接
    mcp.disconnect_all()
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
    mcp.set_project_root(path)
    memory.set_project_root(path)
    vector.set_project_root(path)
    snapshot.set_project_root(path)
    usage.set_project_root(path)
    debug.set_project_root(path)
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
    result = files.write_file(body["path"], body["content"])
    # 自动快照
    if result.get("success"):
        snapshot.create_snapshot(body["path"], body["content"])
    return result


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


@app.get("/api/files/search")
async def search_files(query: str, path: str = ""):
    return {"results": files.search_files(query, path)}


@app.get("/api/files/stats")
async def file_stats(path: str):
    return files.get_file_stats(path)


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


@app.post("/api/git/stage/path")
async def git_stage_path(request: Request):
    body = await request.json()
    return git_ops.git_stage_path(body["path"])


@app.post("/api/git/unstage")
async def git_unstage(request: Request):
    body = await request.json()
    return git_ops.git_unstage(body["path"])


@app.post("/api/git/commit")
async def git_commit(request: Request):
    body = await request.json()
    return git_ops.git_commit(body["message"])


@app.post("/api/git/push")
async def git_push(request: Request):
    body = await request.json()
    return git_ops.git_push(body.get("remote", "origin"), body.get("branch", ""))


@app.post("/api/git/pull")
async def git_pull(request: Request):
    body = await request.json()
    return git_ops.git_pull(body.get("remote", "origin"), body.get("branch", ""))


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


@app.post("/api/git/branch")
async def git_create_branch(request: Request):
    body = await request.json()
    return git_ops.git_create_branch(body["name"])


@app.post("/api/git/merge")
async def git_merge(request: Request):
    body = await request.json()
    return git_ops.git_merge(body["branch"])


@app.get("/api/git/remotes")
async def git_remotes():
    return git_ops.git_remotes()


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


@app.post("/api/terminal/resize")
async def resize_terminal(request: Request):
    body = await request.json()
    return terminal.resize_terminal(body["id"], body["cols"], body["rows"])


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


@app.post("/api/ai/chat")
async def ai_chat(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    system_prompt = body.get("system_prompt", "")
    return await ai.chat(messages, system_prompt)


@app.post("/api/ai/chat/stream")
async def ai_chat_stream(request: Request):
    body = await request.json()
    messages = body.get("messages", [])
    system_prompt = body.get("system_prompt", "")

    async def generate():
        async for chunk in ai.chat_stream(messages, system_prompt):
            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/api/ai/complete")
async def ai_complete(request: Request):
    body = await request.json()
    return await ai.complete(body["context"], body.get("language", ""))


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


@app.post("/api/ai/review")
async def ai_review(request: Request):
    body = await request.json()
    return await ai.agent_review(body.get("code", ""), body.get("context", ""))


# ── MCP ──

@app.get("/api/mcp/servers")
async def mcp_servers():
    return {"servers": mcp.list_servers()}


@app.post("/api/mcp/connect")
async def mcp_connect(request: Request):
    body = await request.json()
    return mcp.connect_server(body["name"], body["command"], body.get("args", []))


@app.post("/api/mcp/disconnect")
async def mcp_disconnect(request: Request):
    body = await request.json()
    return mcp.disconnect_server(body["name"])


@app.get("/api/mcp/tools")
async def mcp_tools():
    return {"tools": mcp.list_tools()}


@app.post("/api/mcp/call")
async def mcp_call_tool(request: Request):
    body = await request.json()
    return await mcp.call_tool(body["tool_name"], body.get("arguments", {}))


# ── LSP ──

@app.post("/api/lsp/start")
async def lsp_start(request: Request):
    body = await request.json()
    return lsp.start_server(body["language"], body.get("project_path", ""))


@app.post("/api/lsp/stop")
async def lsp_stop(request: Request):
    body = await request.json()
    return lsp.stop_server(body["language"], body.get("project_path", ""))


@app.get("/api/lsp/servers")
async def lsp_servers():
    return {"servers": lsp.list_servers()}


@app.post("/api/lsp/didOpen")
async def lsp_did_open(request: Request):
    body = await request.json()
    return lsp.did_open(body["language"], body["uri"], body["text"], body.get("project_path", ""))


@app.post("/api/lsp/didChange")
async def lsp_did_change(request: Request):
    body = await request.json()
    return lsp.did_change(body["language"], body["uri"], body["text"], body.get("version", 1), body.get("project_path", ""))


@app.get("/api/lsp/diagnostics")
async def lsp_diagnostics(uri: str, language: str = "", project_path: str = ""):
    return {"diagnostics": lsp.get_diagnostics(uri, language, project_path)}


@app.post("/api/lsp/format")
async def lsp_format(request: Request):
    body = await request.json()
    return {"edits": lsp.format_document(body["language"], body["uri"], body["text"], body.get("project_path", ""))}


@app.post("/api/lsp/definition")
async def lsp_definition(request: Request):
    body = await request.json()
    return {"locations": lsp.goto_definition(body["language"], body["uri"], body["line"], body["character"], body.get("project_path", ""))}


@app.post("/api/lsp/references")
async def lsp_references(request: Request):
    body = await request.json()
    return {"locations": lsp.find_references(body["language"], body["uri"], body["line"], body["character"], body.get("project_path", ""))}


@app.post("/api/lsp/completion")
async def lsp_completion(request: Request):
    body = await request.json()
    return {"items": lsp.completion(body["language"], body["uri"], body["line"], body["character"], body.get("project_path", ""))}


# ── Memory ──

@app.get("/api/memory/context")
async def memory_context():
    return {"context": memory.get_context()}


@app.post("/api/memory/add")
async def memory_add(request: Request):
    body = await request.json()
    memory.add_message(body["role"], body["content"], body.get("metadata", {}))
    return {"success": True}


@app.post("/api/memory/clear")
async def memory_clear():
    memory.clear_context()
    return {"success": True}


@app.get("/api/memory/summary")
async def memory_summary():
    return {"summary": memory.get_summary()}


@app.get("/api/memory/export")
async def memory_export():
    return {"data": memory.export_context()}


@app.post("/api/memory/import")
async def memory_import(request: Request):
    body = await request.json()
    memory.import_context(body["data"])
    return {"success": True}


# ── Vector ──

@app.post("/api/vector/index")
async def vector_index(request: Request):
    body = await request.json()
    return vector.index_file(body["path"], body["content"])


@app.post("/api/vector/index/project")
async def vector_index_project():
    return await vector.index_project()


@app.post("/api/vector/search")
async def vector_search(request: Request):
    body = await request.json()
    return {"results": vector.search(body["query"], body.get("limit", 10))}


@app.delete("/api/vector/clear")
async def vector_clear():
    vector.clear_index()
    return {"success": True}


@app.get("/api/vector/stats")
async def vector_stats():
    return vector.get_stats()


# ── Snapshot ──

@app.get("/api/snapshot/list")
async def snapshot_list(path: str = ""):
    return {"snapshots": snapshot.list_snapshots(path)}


@app.get("/api/snapshot/latest")
async def snapshot_latest(path: str):
    return {"snapshot": snapshot.get_latest_snapshot(path)}


@app.get("/api/snapshot/compare")
async def snapshot_compare(path: str, snapshot_id: str):
    return {"diff": snapshot.compare_with_snapshot(path, snapshot_id)}


@app.post("/api/snapshot/restore")
async def snapshot_restore(request: Request):
    body = await request.json()
    return snapshot.restore_snapshot(body["path"], body["snapshot_id"])


@app.delete("/api/snapshot/clear")
async def snapshot_clear(path: str = ""):
    snapshot.clear_snapshots(path)
    return {"success": True}


# ── Usage ──

@app.get("/api/usage/stats")
async def usage_stats():
    return usage.get_stats()


@app.get("/api/usage/history")
async def usage_history(days: int = 7):
    return {"history": usage.get_history(days)}


@app.get("/api/usage/cost")
async def usage_cost():
    return {"cost": usage.estimate_cost()}


@app.post("/api/usage/track")
async def usage_track(request: Request):
    body = await request.json()
    usage.track_request(body["model"], body["tokens_in"], body["tokens_out"], body.get("cost", 0))
    return {"success": True}


@app.post("/api/usage/reset")
async def usage_reset():
    usage.reset_stats()
    return {"success": True}


# ── Debug ──

@app.get("/api/debug/info")
async def debug_info():
    return debug.get_debug_info()


@app.get("/api/debug/logs")
async def debug_logs(count: int = 100):
    return {"logs": debug.get_logs(count)}


@app.post("/api/debug/breakpoint")
async def debug_breakpoint(request: Request):
    body = await request.json()
    return debug.set_breakpoint(body["file"], body["line"], body.get("condition", ""))


@app.delete("/api/debug/breakpoint")
async def debug_remove_breakpoint(request: Request):
    body = await request.json()
    return debug.remove_breakpoint(body["file"], body["line"])


@app.get("/api/debug/breakpoints")
async def debug_breakpoints():
    return {"breakpoints": debug.get_breakpoints()}


@app.post("/api/debug/evaluate")
async def debug_evaluate(request: Request):
    body = await request.json()
    return {"result": debug.evaluate_expression(body["expression"])}


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
