"""
AI 对话 + Agent 编排 API
增强: chat_stream_with_tools / agent_orchestrate_stream
内置工具: read_file, write_file, list_files, search_code, run_command, git_status, git_diff
"""
import asyncio
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adapters.llm import LLMConfig, Message, configure_adapter, get_adapter
from agents.builder import build_plan
from agents.coder import execute_task
from agents.reviewer import review_code
from agents.orchestrator import run_pipeline, OrchestratorStep

_project_root: str = ""

def set_project_root(root: str):
    global _project_root
    _project_root = os.path.abspath(root)

def configure(config: dict) -> dict:
    """配置 LLM adapter"""
    llm_config = LLMConfig(
        provider=config.get("provider", "openai-compatible"),
        base_url=config.get("base_url", ""),
        api_key=config.get("api_key", ""),
        model=config.get("model", ""),
        max_tokens=config.get("max_tokens", 4096),
        temperature=config.get("temperature", 0.7),
        system_prompt=config.get("system_prompt", ""),
    )
    configure_adapter(llm_config)
    return {"status": "configured", "provider": llm_config.provider, "model": llm_config.model}

BUILTIN_TOOLS = [
    {"name": "read_file", "description": "Read file contents", "parameters": {"path": "string"}},
    {"name": "write_file", "description": "Write content to file", "parameters": {"path": "string", "content": "string"}},
    {"name": "list_files", "description": "List files in directory", "parameters": {"path": "string"}},
    {"name": "search_code", "description": "Search code in project", "parameters": {"query": "string", "pattern": "string"}},
    {"name": "run_command", "description": "Run shell command", "parameters": {"command": "string"}},
    {"name": "git_status", "description": "Get git status", "parameters": {}},
    {"name": "git_diff", "description": "Get git diff", "parameters": {"file_path": "string"}},
]

def _exec_builtin_tool(name: str, args: dict) -> str:
    """执行内置工具"""
    try:
        if name == "read_file":
            fp = os.path.join(_project_root, args.get("path", ""))
            if not os.path.exists(fp):
                return f"File not found: {args.get('path')}"
            with open(fp, "r", encoding="utf-8", errors="replace") as f:
                return f.read()[:8000]
        elif name == "write_file":
            fp = os.path.join(_project_root, args.get("path", ""))
            os.makedirs(os.path.dirname(fp), exist_ok=True)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(args.get("content", ""))
            return f"Written {len(args.get('content', ''))} chars"
        elif name == "list_files":
            d = os.path.join(_project_root, args.get("path", "."))
            if not os.path.isdir(d):
                return f"Not a directory: {args.get('path')}"
            skip = {".git", "node_modules", "__pycache__", ".venv", "dist", ".next"}
            entries = []
            for e in sorted(os.listdir(d)):
                if (e.startswith(".") and e not in (".env", ".gitignore")) or e in skip:
                    continue
                prefix = "D" if os.path.isdir(os.path.join(d, e)) else "F"
                entries.append(f"[{prefix}] {e}")
            return "\n".join(entries[:100]) or "Empty directory"
        elif name == "search_code":
            query = args.get("query", "")
            if not query:
                return "Query is empty"
            if os.name == "nt":
                cmd = f'findstr /s /i /n /c:"{query}" "{args.get("pattern", "*")}" 2>nul'
            else:
                cmd = f"grep -rn --include='{args.get('pattern', '*')}' '{query}' . 2>/dev/null"
            r = subprocess.run(cmd, shell=True, cwd=_project_root, capture_output=True, text=True,
                               timeout=10, encoding="utf-8", errors="replace")
            lines = [l for l in r.stdout.split("\n") if l.strip()][:30]
            return "\n".join(lines) or "No matches"
        elif name == "run_command":
            cmd = args.get("command", "")
            r = subprocess.run(cmd, shell=True, cwd=_project_root, capture_output=True, text=True,
                               timeout=30, encoding="utf-8", errors="replace")
            return (r.stdout + r.stderr)[:4000] or f"Exit: {r.returncode}"
        elif name == "git_status":
            r = subprocess.run(["git", "status", "--short"], cwd=_project_root, capture_output=True, text=True,
                               timeout=10, encoding="utf-8", errors="replace")
            return r.stdout.strip() or "Clean"
        elif name == "git_diff":
            cmd = ["git", "diff", "HEAD"]
            fp = args.get("file_path", "")
            if fp:
                cmd.extend(["--", fp])
            r = subprocess.run(cmd, cwd=_project_root, capture_output=True, text=True,
                               timeout=10, encoding="utf-8", errors="replace")
            return r.stdout.strip()[:4000] or "No changes"
        return f"Unknown tool: {name}"
    except Exception as e:
        return f"Tool error: {e}"

def _detect_test_command(project_root: str) -> str:
    """自动检测验证命令"""
    checks = [
        ("package.json", "npm test"), ("pytest.ini", "pytest"),
        ("setup.py", "pytest"), ("pyproject.toml", "pytest"),
        ("go.mod", "go test ./..."), ("Cargo.toml", "cargo test"), ("Makefile", "make test"),
    ]
    for fname, cmd in checks:
        if os.path.exists(os.path.join(project_root, fname)):
            return cmd
    return ""

async def chat_stream(messages: list, system_prompt: str = ""):
    """流式返回 AI 对话"""
    adapter = get_adapter()
    if not adapter:
        yield {"error": "LLM adapter not configured"}
        return
    llm_messages = []
    if system_prompt:
        llm_messages.append(Message(role="system", content=system_prompt))
    for m in messages:
        llm_messages.append(Message(role=m["role"], content=m["content"]))
    async for chunk in adapter.chat_stream(llm_messages):
        yield {"delta": chunk.delta, "finish_reason": chunk.finish_reason}

async def chat_stream_with_tools(messages: list, system_prompt: str = ""):
    """带工具调用的流式对话，最多8轮"""
    adapter = get_adapter()
    if not adapter:
        yield json.dumps({"type": "error", "error": "LLM adapter not configured"})
        return

    tools_text = "\n".join([f"- {t['name']}: {t['description']}" for t in BUILTIN_TOOLS])
    tool_system = (system_prompt + "\n\n" if system_prompt else "") + (
        f"You have access to tools. To call a tool, output a JSON line:\n"
        f'{{"tool_call": {{"name": "tool_name", "args": {{"key": "value"}}}}}}\n'
        f"Tools:\n{tools_text}\n"
        f"When done, output final answer. Max 8 tool turns."
    )
    llm_messages = [Message(role="system", content=tool_system)]
    for m in messages:
        llm_messages.append(Message(role=m["role"], content=m["content"]))

    full_response = ""
    for _turn in range(8):
        chunk_text = ""
        async for chunk in adapter.chat_stream(llm_messages):
            if hasattr(chunk, "delta") and chunk.delta:
                chunk_text += chunk.delta
                yield json.dumps({"type": "delta", "content": chunk.delta})
        full_response += chunk_text

        tool_call = None
        for m in re.finditer(r'\{"tool_call"\s*:\s*\{[^}]+\}\}', full_response):
            try:
                obj = json.loads(m.group())
                tool_call = obj["tool_call"]
            except json.JSONDecodeError:
                pass
        if not tool_call:
            yield json.dumps({"type": "done", "content": full_response})
            return

        tool_name = tool_call.get("name", "")
        tool_args = tool_call.get("args", {})
        yield json.dumps({"type": "tool_call", "name": tool_name, "args": tool_args})
        result = _exec_builtin_tool(tool_name, tool_args)
        yield json.dumps({"type": "tool_result", "name": tool_name, "result": result[:3000]})

        llm_messages.append(Message(role="assistant", content=full_response))
        llm_messages.append(Message(role="user", content=f"Tool {tool_name} result:\n{result[:3000]}"))
        full_response = ""

    yield json.dumps({"type": "done", "content": full_response or "Max tool turns reached"})

async def agent_build(requirement: str, project_context: str = "") -> dict:
    """Builder Agent"""
    try:
        tasks = await build_plan(requirement, project_context)
        return {"success": True, "tasks": [asdict(t) for t in tasks]}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def agent_code(task: str, project_context: str = "", file_contents: dict = None) -> dict:
    """Coder Agent"""
    try:
        result = await execute_task(task, project_context, file_contents or {})
        return {"success": result.success, "actions": [asdict(a) for a in result.actions],
                "summary": result.summary, "error": result.error}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def agent_review(task: str, file_changes: dict = None, build_output: str = "") -> dict:
    """Reviewer Agent"""
    try:
        result = await review_code(task, file_changes or {}, build_output)
        return {"success": True, "approved": result.approved,
                "issues": [asdict(i) for i in result.issues], "summary": result.summary}
    except Exception as e:
        return {"success": False, "error": str(e)}

async def agent_orchestrate(requirement: str, project_context: str = "", file_contents: dict = None, on_step=None):
    """编排流水线"""
    try:
        result = await run_pipeline(requirement, project_context, file_contents or {}, on_step)
        yield {"type": "result", **asdict(result)}
    except Exception as e:
        yield {"type": "error", "error": str(e)}

async def agent_orchestrate_stream(requirement: str, project_context: str = ""):
    """Agent 流水线流式输出，内置工具 + 自动验证"""
    phases = [
        ("analyze", "分析需求"), ("plan", "制定计划"),
        ("code", "编写代码"), ("verify", "验证构建"), ("review", "代码审查"),
    ]
    for phase, name in phases:
        yield json.dumps({"type": "phase_start", "phase": phase, "name": name})
        adapter = get_adapter()
        if adapter:
            msgs = [
                Message(role="system", content=f"You are the {name} phase."),
                Message(role="user", content=f"Requirement: {requirement}\nContext: {project_context[:2000]}"),
            ]
            text = ""
            async for chunk in adapter.chat_stream(msgs):
                if hasattr(chunk, "delta") and chunk.delta:
                    text += chunk.delta
                    yield json.dumps({"type": "delta", "phase": phase, "content": chunk.delta})
            yield json.dumps({"type": "phase_done", "phase": phase, "summary": text[:500]})
        else:
            yield json.dumps({"type": "phase_done", "phase": phase, "summary": "Skipped"})

    test_cmd = _detect_test_command(_project_root)
    if test_cmd:
        yield json.dumps({"type": "verify_start", "command": test_cmd})
        try:
            r = subprocess.run(test_cmd, shell=True, cwd=_project_root, capture_output=True, text=True,
                               timeout=60, encoding="utf-8", errors="replace")
            yield json.dumps({"type": "verify_done", "success": r.returncode == 0, "output": r.stdout[:2000]})
        except subprocess.TimeoutExpired:
            yield json.dumps({"type": "verify_done", "success": False, "output": "Timed out"})
    yield json.dumps({"type": "pipeline_done"})
