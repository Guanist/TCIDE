"""
Builder Agent - 需求分析 + 任务拆解
"""
import json
import re
from dataclasses import dataclass

from adapters.llm import Message, get_adapter


@dataclass
class Task:
    id: str
    description: str
    files: list[str]
    priority: int = 1
    dependencies: list[str] = None

    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = []


BUILDER_SYSTEM_PROMPT = """你是一个高级架构师 Agent。你的职责是分析用户需求并拆解为可执行的任务列表。

输出格式要求（严格 JSON 数组）:
```json
[
  {
    "id": "task-1",
    "description": "任务描述",
    "files": ["涉及的文件路径"],
    "priority": 1,
    "dependencies": []
  }
]
```

规则：
1. 每个任务应该是一个独立可验证的工作单元
2. 任务描述要具体，包含要修改什么、怎么修改
3. files 列出需要创建或修改的文件
4. priority: 1=高 2=中 3=低
5. dependencies: 列出前置任务的 id
6. 只输出 JSON，不要其他内容"""


async def build_plan(requirement: str, project_context: str = "") -> list[Task]:
    """分析需求，生成任务计划"""
    adapter = get_adapter()
    if not adapter:
        raise RuntimeError("LLM adapter not configured")

    user_msg = f"需求：{requirement}"
    if project_context:
        user_msg += f"\n\n项目上下文：\n{project_context}"

    messages = [
        Message(role="system", content=BUILDER_SYSTEM_PROMPT),
        Message(role="user", content=user_msg),
    ]

    response = await adapter.chat(messages)
    tasks = _parse_tasks(response)
    return tasks


def _parse_tasks(response: str) -> list[Task]:
    """从 LLM 响应中解析任务列表"""
    # 尝试提取 JSON 块
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
    if json_match:
        json_str = json_match.group(1).strip()
    else:
        # 尝试直接解析整个响应
        json_str = response.strip()

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        # 尝试找到第一个 [ 和最后一个 ]
        start = json_str.find('[')
        end = json_str.rfind(']')
        if start >= 0 and end > start:
            try:
                data = json.loads(json_str[start:end + 1])
            except json.JSONDecodeError:
                return [Task(id="task-1", description=response.strip(), files=[])]
        else:
            return [Task(id="task-1", description=response.strip(), files=[])]

    if not isinstance(data, list):
        data = [data]

    tasks = []
    for i, item in enumerate(data):
        if isinstance(item, dict):
            tasks.append(Task(
                id=item.get("id", f"task-{i + 1}"),
                description=item.get("description", ""),
                files=item.get("files", []),
                priority=item.get("priority", 2),
                dependencies=item.get("dependencies", []),
            ))
    return tasks
