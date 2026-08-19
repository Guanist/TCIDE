"""
Reviewer Agent - 代码审查 + 质量把关
"""
import json
import re
from dataclasses import dataclass

from adapters.llm import Message, get_adapter


@dataclass
class ReviewIssue:
    severity: str  # error | warning | info
    file: str
    line: int
    message: str
    suggestion: str = ""


@dataclass
class ReviewResult:
    approved: bool
    issues: list[ReviewIssue]
    summary: str


REVIEWER_PROMPT = """你是一个严格的代码审查 Agent。审查代码变更，判断是否可以合并。

输出格式（严格 JSON）:
```json
{
  "approved": true,
  "issues": [
    {
      "severity": "warning",
      "file": "src/foo.ts",
      "line": 42,
      "message": "问题描述",
      "suggestion": "修改建议"
    }
  ],
  "summary": "审查总结"
}
```

审查标准：
1. 代码正确性：逻辑错误、边界条件、空值处理
2. 类型安全：any 滥用、类型断言过多
3. 错误处理：异常是否被正确捕获
4. 性能：明显的性能问题（循环嵌套、大对象复制）
5. 安全性：注入、路径遍历、敏感信息泄露
6. approved: true 表示可以合并，false 表示需要修改"""


async def review_code(
    task_description: str,
    file_changes: dict[str, str],
    build_output: str = "",
) -> ReviewResult:
    """审查代码变更"""
    adapter = get_adapter()
    if not adapter:
        raise RuntimeError("LLM adapter not configured")

    parts = [f"任务：{task_description}"]
    for path, content in file_changes.items():
        parts.append(f"文件 {path} 变更：\n```\n{content[:4000]}\n```")
    if build_output:
        parts.append(f"构建输出：\n```\n{build_output[:2000]}\n```")

    messages = [
        Message(role="system", content=REVIEWER_PROMPT),
        Message(role="user", content="\n\n".join(parts)),
    ]

    response = await adapter.chat(messages)
    return _parse_review(response)


def _parse_review(response: str) -> ReviewResult:
    """解析审查结果"""
    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', response)
    json_str = json_match.group(1).strip() if json_match else response.strip()

    try:
        data = json.loads(json_str)
    except json.JSONDecodeError:
        start = json_str.find('{')
        end = json_str.rfind('}')
        if start >= 0 and end > start:
            try:
                data = json.loads(json_str[start:end + 1])
            except json.JSONDecodeError:
                return ReviewResult(approved=False, issues=[], summary=response[:300])
        else:
            return ReviewResult(approved=False, issues=[], summary=response[:300])

    issues = []
    for item in data.get("issues", []):
        if isinstance(item, dict):
            issues.append(ReviewIssue(
                severity=item.get("severity", "info"),
                file=item.get("file", ""),
                line=item.get("line", 0),
                message=item.get("message", ""),
                suggestion=item.get("suggestion", ""),
            ))

    return ReviewResult(
        approved=data.get("approved", False),
        issues=issues,
        summary=data.get("summary", ""),
    )
