"""
Coder Agent - 代码生成 + 编译验证 + 错误修复
"""
import json
import re
from dataclasses import dataclass

from adapters.llm import Message, get_adapter


@dataclass
class CodeAction:
    action: str  # read_file | write_file | run_command
    path: str = ""
    content: str = ""
    command: str = ""


@dataclass
class CoderResult:
    success: bool
    actions: list[CodeAction]
    summary: str
    error: str = ""


CODER_SYSTEM_PROMPT = """你是一个高级代码工程师 Agent。你的职责是根据任务描述生成具体的代码修改。

你可以使用以下工具：
- read_file(path): 读取文件内容
- write_file(path, content): 写入文件
- run_command(command): 执行终端命令

输出格式要求（严格 JSON）:
```json
{
  "actions": [
    {"action": "read_file", "path": "src/foo.ts"},
    {"action": "write_file", "path": "src/foo.ts", "content": "..."},
    {"action": "run_command", "command": "npm run build"}
  ],
  "summary": "修改说明"
}
```

规则：
1. 先 read_file 了解现有代码，再 write_file 修改
2. write_file 必须提供完整文件内容
3. 修改完成后 run_command 验证（如 npm run build / npm test）
4. 只输出 JSON"""


CODER_FIX_PROMPT = """你是一个代码修复 Agent。之前的修改导致了错误，请分析并修复。

输出格式同上（JSON actions 数组 + summary）。"""


async def execute_task(
    task_description: str,
    project_context: str = "",
    file_contents: dict[str, str] = None,
    max_retries: int = 2,
) -> CoderResult:
    """执行单个编码任务，支持自动重试修复"""
    adapter = get_adapter()
    if not adapter:
        raise RuntimeError("LLM adapter not configured")

    file_contents = file_contents or {}
    context_parts = [f"任务：{task_description}"]
    if project_context:
        context_parts.append(f"项目上下文：\n{project_context}")
    for path, content in file_contents.items():
        context_parts.append(f"文件 {path}：\n```\n{content[:3000]}\n```")

    messages = [
        Message(role="system", content=CODER_SYSTEM_PROMPT),
        Message(role="user", content="\n\n".join(context_parts)),
    ]

    for attempt in range(max_retries + 1):
        response = await adapter.chat(messages)
        result = _parse_coder_response(response)

        # 如果有 build 错误且还有重试次数，让 LLM 修复
        if not result.success and attempt < max_retries:
            messages.append(Message(role="assistant", content=response))
            messages.append(Message(
                role="user",
                content=f"上一次修改后出现错误：{result.error}\n\n请分析错误并修复。",
            ))
            continue

        return result

    return result


def _parse_coder_response(response: str) -> CoderResult:
    """解析 Coder Agent 的输出"""
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
    if json_match:
        json_str = json_match.group(1).strip()
    else:
        json_str = response.strip()

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        start = json_str.find('{')
        end = json_str.rfind('}')
        if start >= 0 and end > start:
            try:
                data = json.loads(json_str[start:end + 1])
            except json.JSONDecodeError:
                return CoderResult(success=False, actions=[], summary=response[:200], error="JSON parse failed")
        else:
            return CoderResult(success=False, actions=[], summary=response[:200], error="No JSON found")

    actions = []
    for a in data.get("actions", []):
        if isinstance(a, dict):
            actions.append(CodeAction(
                action=a.get("action", ""),
                path=a.get("path", ""),
                content=a.get("content", ""),
                command=a.get("command", ""),
            ))

    return CoderResult(
        success=True,
        actions=actions,
        summary=data.get("summary", ""),
    )
