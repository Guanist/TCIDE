"""
AI 对话 + Agent 编排 API
"""
import asyncio
import json
import os
import time
from dataclasses import asdict

# 复用已有的 agent 和 adapter
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from adapters.llm import LLMConfig, Message, configure_adapter, get_adapter
from agents.builder import build_plan
from agents.coder import execute_task
from agents.reviewer import review_code
from agents.orchestrator import run_pipeline, OrchestratorStep


# ── 配置管理 ──

def configure(config: dict) -> dict:
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


# ── 流式对话 ──

async def chat_stream(messages: list[dict], system_prompt: str = ""):
    """流式返回 AI 对话（async generator）"""
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


# ── Agent 接口 ──

async def agent_build(requirement: str, project_context: str = "") -> dict:
    try:
        tasks = await build_plan(requirement, project_context)
        return {"success": True, "tasks": [asdict(t) for t in tasks]}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def agent_code(task: str, project_context: str = "", file_contents: dict = None) -> dict:
    try:
        result = await execute_task(task, project_context, file_contents or {})
        return {
            "success": result.success,
            "actions": [asdict(a) for a in result.actions],
            "summary": result.summary,
            "error": result.error,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def agent_review(task: str, file_changes: dict = None, build_output: str = "") -> dict:
    try:
        result = await review_code(task, file_changes or {}, build_output)
        return {
            "success": True,
            "approved": result.approved,
            "issues": [asdict(i) for i in result.issues],
            "summary": result.summary,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


async def agent_orchestrate(requirement: str, project_context: str = "", file_contents: dict = None, on_step=None):
    """编排流水线（async generator，流式返回步骤）"""
    try:
        result = await run_pipeline(requirement, project_context, file_contents or {}, on_step)
        yield {"type": "result", **asdict(result)}
    except Exception as e:
        yield {"type": "error", "error": str(e)}
