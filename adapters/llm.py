"""
多提供商 LLM 适配器
支持 OpenAI 兼容 / Anthropic / Ollama，统一 streaming 接口
"""
import asyncio
import json
import time
from dataclasses import dataclass, field
from typing import AsyncIterator, Optional

import httpx


@dataclass
class Message:
    role: str
    content: str


@dataclass
class LLMConfig:
    provider: str  # openai-compatible | anthropic | ollama
    base_url: str
    api_key: str = ""
    model: str = ""
    max_tokens: int = 4096
    temperature: float = 0.7
    system_prompt: str = ""


@dataclass
class StreamChunk:
    delta: str = ""
    finish_reason: str = ""
    usage: dict = field(default_factory=dict)


class LLMAdapter:
    """统一 LLM 调用适配器"""

    def __init__(self, config: LLMConfig):
        self.config = config
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))

    async def close(self):
        await self._client.aclose()

    async def chat_stream(self, messages: list[Message]) -> AsyncIterator[StreamChunk]:
        """统一 streaming 接口"""
        provider = self.config.provider
        if provider == "ollama":
            async for chunk in self._stream_ollama(messages):
                yield chunk
        elif provider == "anthropic":
            async for chunk in self._stream_anthropic(messages):
                yield chunk
        else:
            async for chunk in self._stream_openai(messages):
                yield chunk

    async def chat(self, messages: list[Message]) -> str:
        """非 streaming 调用"""
        chunks = []
        async for chunk in self.chat_stream(messages):
            chunks.append(chunk.delta)
        return "".join(chunks)

    # ── OpenAI 兼容 (DeepSeek / 火山 / 自定义) ──

    async def _stream_openai(self, messages: list[Message]) -> AsyncIterator[StreamChunk]:
        url = f"{self.config.base_url.rstrip('/')}/chat/completions"
        body = {
            "model": self.config.model,
            "messages": self._format_openai_messages(messages),
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}

        async with self._client.stream("POST", url, json=body, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    obj = json.loads(data)
                    delta = obj.get("choices", [{}])[0].get("delta", {}).get("content", "")
                    finish = obj.get("choices", [{}])[0].get("finish_reason", "")
                    usage = obj.get("usage", {})
                    yield StreamChunk(delta=delta, finish_reason=finish, usage=usage or {})
                except json.JSONDecodeError:
                    continue

    # ── Anthropic ──

    async def _stream_anthropic(self, messages: list[Message]) -> AsyncIterator[StreamChunk]:
        url = f"{self.config.base_url.rstrip('/')}/messages"
        system_text = ""
        msgs = []
        for m in messages:
            if m.role == "system":
                system_text = m.content
            else:
                msgs.append({"role": m.role, "content": m.content})

        body = {
            "model": self.config.model,
            "max_tokens": self.config.max_tokens,
            "temperature": self.config.temperature,
            "messages": msgs,
            "stream": True,
        }
        if system_text:
            body["system"] = system_text

        headers = {
            "x-api-key": self.config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

        async with self._client.stream("POST", url, json=body, headers=headers) as resp:
            async for line in resp.aiter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    obj = json.loads(line[6:])
                    if obj["type"] == "content_block_delta":
                        yield StreamChunk(delta=obj["delta"].get("text", ""))
                    elif obj["type"] == "message_delta":
                        yield StreamChunk(
                            delta="",
                            finish_reason=obj.get("delta", {}).get("stop_reason", ""),
                            usage=obj.get("usage", {}),
                        )
                except (json.JSONDecodeError, KeyError):
                    continue

    # ── Ollama ──

    async def _stream_ollama(self, messages: list[Message]) -> AsyncIterator[StreamChunk]:
        url = f"{self.config.base_url.rstrip('/')}/api/chat"
        body = {
            "model": self.config.model,
            "messages": self._format_openai_messages(messages),
            "stream": True,
        }

        async with self._client.stream("POST", url, json=body) as resp:
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    yield StreamChunk(
                        delta=obj.get("message", {}).get("content", ""),
                        finish_reason="stop" if obj.get("done") else "",
                    )
                    if obj.get("done"):
                        break
                except json.JSONDecodeError:
                    continue

    def _format_openai_messages(self, messages: list[Message]) -> list[dict]:
        result = []
        for m in messages:
            result.append({"role": m.role, "content": m.content})
        return result


# ── 全局实例管理 ──

_current_adapter: Optional[LLMAdapter] = None


def get_adapter() -> Optional[LLMAdapter]:
    return _current_adapter


def configure_adapter(config: LLMConfig) -> LLMAdapter:
    global _current_adapter
    if _current_adapter:
        asyncio.get_event_loop().create_task(_current_adapter.close())
    _current_adapter = LLMAdapter(config)
    return _current_adapter
