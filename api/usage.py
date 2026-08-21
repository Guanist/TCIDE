"""
用量统计 API
记录/查询 token 用量、请求次数、项目维度统计
"""
import json
import os
import time
from collections import defaultdict
from pathlib import Path

_project_root = ""
_usage_file = ""
_records: list = []

def init_usage(project_path: str) -> dict:
    """初始化用量统计"""
    global _project_root, _usage_file, _records
    _project_root = os.path.abspath(project_path)
    usage_dir = os.path.join(_project_root, ".tcide")
    os.makedirs(usage_dir, exist_ok=True)
    _usage_file = os.path.join(usage_dir, "usage.json")
    _load()
    return {"success": True}

def _load():
    """加载记录"""
    global _records
    if _usage_file and os.path.exists(_usage_file):
        try:
            with open(_usage_file, "r", encoding="utf-8") as f:
                _records = json.load(f)
        except Exception:
            _records = []
    else:
        _records = []

def _save():
    """保存记录"""
    if not _usage_file:
        return
    try:
        with open(_usage_file, "w", encoding="utf-8") as f:
            json.dump(_records, f, ensure_ascii=False)
    except Exception:
        pass

def record_usage(rec: dict) -> dict:
    """记录一条用量"""
    entry = {
        "timestamp": rec.get("timestamp", int(time.time() * 1000)),
        "model": rec.get("model", "unknown"),
        "provider": rec.get("provider", "unknown"),
        "promptTokens": rec.get("promptTokens", 0),
        "completionTokens": rec.get("completionTokens", 0),
        "totalTokens": rec.get("totalTokens", 0) or (rec.get("promptTokens", 0) + rec.get("completionTokens", 0)),
        "cost": rec.get("cost", 0),
        "project": rec.get("project", _project_root),
        "operation": rec.get("operation", "chat"),
        "success": rec.get("success", True),
        "latencyMs": rec.get("latencyMs", 0),
    }
    _records.append(entry)
    # 保留最近 10000 条
    if len(_records) > 10000:
        _records[:] = _records[-10000:]
    _save()
    return {"success": True, "total": len(_records)}

def get_today() -> dict:
    """获取今日用量"""
    now = time.time() * 1000
    today_start = now - (now % 86400000) - (time.timezone * 1000 if time.daylight == 0 else (time.altzone * 1000))
    today_records = [r for r in _records if r.get("timestamp", 0) >= today_start]
    return _aggregate(today_records, "today")

def get_total() -> dict:
    """获取总用量"""
    return _aggregate(_records, "total")

def get_by_project(project: str = None) -> dict:
    """按项目统计"""
    if project:
        records = [r for r in _records if r.get("project") == project]
        return _aggregate(records, project)
    # 按项目分组
    grouped = defaultdict(list)
    for r in _records:
        p = r.get("project", "unknown")
        grouped[p].append(r)
    result = {}
    for p, recs in grouped.items():
        result[p] = _aggregate_raw(recs)
    return {"projects": result}

def get_by_date(days: int = 7) -> dict:
    """按日期统计"""
    now = time.time() * 1000
    grouped = defaultdict(list)
    for r in _records:
        ts = r.get("timestamp", 0)
        if now - ts > days * 86400000:
            continue
        # 日期字符串
        import datetime
        dt = datetime.datetime.fromtimestamp(ts / 1000)
        date_str = dt.strftime("%Y-%m-%d")
        grouped[date_str].append(r)
    result = {}
    for date_str, recs in sorted(grouped.items()):
        result[date_str] = _aggregate_raw(recs)
    return {"days": days, "data": result}

def _aggregate(records: list, label: str) -> dict:
    """聚合统计"""
    raw = _aggregate_raw(records)
    raw["label"] = label
    raw["recordCount"] = len(records)
    return raw

def _aggregate_raw(records: list) -> dict:
    """原始聚合"""
    total_prompt = sum(r.get("promptTokens", 0) for r in records)
    total_completion = sum(r.get("completionTokens", 0) for r in records)
    total_tokens = sum(r.get("totalTokens", 0) for r in records)
    total_cost = sum(r.get("cost", 0) for r in records)
    total_latency = sum(r.get("latencyMs", 0) for r in records)
    success_count = sum(1 for r in records if r.get("success", True))
    # 按模型分组
    by_model = defaultdict(lambda: {"tokens": 0, "count": 0})
    for r in records:
        m = r.get("model", "unknown")
        by_model[m]["tokens"] += r.get("totalTokens", 0)
        by_model[m]["count"] += 1
    return {
        "promptTokens": total_prompt,
        "completionTokens": total_completion,
        "totalTokens": total_tokens,
        "cost": round(total_cost, 6),
        "avgLatencyMs": round(total_latency / max(len(records), 1)),
        "successRate": round(success_count / max(len(records), 1) * 100, 1),
        "byModel": dict(by_model),
    }
