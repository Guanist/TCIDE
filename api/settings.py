"""
设置管理 API
"""
import json
import os
from pathlib import Path

_config_dir = ""
_config_file = ""
_settings: dict = {}

DEFAULT_SETTINGS = {
    "theme": "dark",
    "fontSize": 14,
    "tabSize": 4,
    "wordWrap": "on",
    "minimap": False,
    "ai": {
        "provider": "deepseek",
        "baseUrl": "https://api.deepseek.com/v1",
        "apiKey": "",
        "model": "deepseek-chat",
        "maxTokens": 4096,
        "temperature": 0.7,
    },
    "editor": {
        "fontFamily": "Consolas, 'Courier New', monospace",
        "lineHeight": 1.6,
        "cursorBlinking": "smooth",
        "cursorStyle": "line",
        "renderWhitespace": "selection",
    },
}


def init_settings(app_name: str = "tcide"):
    global _config_dir, _config_file, _settings
    if os.name == "nt":
        _config_dir = os.path.join(os.environ.get("APPDATA", ""), app_name)
    else:
        _config_dir = os.path.join(os.path.expanduser("~"), ".config", app_name)
    os.makedirs(_config_dir, exist_ok=True)
    _config_file = os.path.join(_config_dir, "settings.json")
    _load()


def _load():
    global _settings
    if os.path.exists(_config_file):
        try:
            _settings = json.loads(Path(_config_file).read_text(encoding="utf-8"))
        except Exception:
            _settings = {}
    _merge_defaults(_settings, DEFAULT_SETTINGS)


def _merge_defaults(target: dict, defaults: dict):
    for k, v in defaults.items():
        if k not in target:
            target[k] = v
        elif isinstance(v, dict) and isinstance(target[k], dict):
            _merge_defaults(target[k], v)


def _save():
    Path(_config_file).write_text(json.dumps(_settings, indent=2, ensure_ascii=False), encoding="utf-8")


def get_settings() -> dict:
    return _settings


def get_setting(key: str, default=None):
    keys = key.split(".")
    val = _settings
    for k in keys:
        if isinstance(val, dict):
            val = val.get(k)
        else:
            return default
    return val if val is not None else default


def set_setting(key: str, value):
    keys = key.split(".")
    target = _settings
    for k in keys[:-1]:
        if k not in target or not isinstance(target[k], dict):
            target[k] = {}
        target = target[k]
    target[keys[-1]] = value
    _save()


def get_recent_projects() -> list:
    return _settings.get("recentProjects", [])


def add_recent_project(path: str):
    projects = get_recent_projects()
    if path in projects:
        projects.remove(path)
    projects.insert(0, path)
    _settings["recentProjects"] = projects[:20]
    _save()
