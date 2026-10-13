"""
项目记忆 API
自动检测技术栈/编码风格/目录规范，记录重构/模式/决策，注入 system prompt
"""
import json
import os
import time
from pathlib import Path

_memory_cache = {}
_last_cache_time = 0
CACHE_TTL = 1800000  # 30分钟

def init_memory(project_path: str) -> dict:
    """初始化项目记忆"""
    global _memory_cache, _last_cache_time
    memory_dir = os.path.join(project_path, ".tcide", "memory")
    os.makedirs(memory_dir, exist_ok=True)
    _memory_cache = _load_memory(memory_dir)
    _last_cache_time = 0
    _auto_detect(project_path)
    return {"success": True, "memoryDir": memory_dir}

def _load_memory(memory_dir: str) -> dict:
    """加载记忆文件"""
    fp = os.path.join(memory_dir, "memory.json")
    if os.path.exists(fp):
        try:
            with open(fp, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, Exception):
            pass
    return {}

def _save_memory(project_path: str):
    """保存记忆"""
    memory_dir = os.path.join(project_path, ".tcide", "memory")
    os.makedirs(memory_dir, exist_ok=True)
    fp = os.path.join(memory_dir, "memory.json")
    try:
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(_memory_cache, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

def _auto_detect(project_path: str):
    """自动检测项目特征"""
    global _memory_cache, _last_cache_time
    _memory_cache["techStack"] = _detect_tech_stack(project_path)
    _memory_cache["codingStyle"] = _detect_coding_style(project_path)
    _memory_cache["directoryLayout"] = _detect_directory_layout(project_path)
    _memory_cache["packageManager"] = _detect_package_manager(project_path)
    _save_memory(project_path)
    _last_cache_time = time.time() * 1000

def _detect_tech_stack(root: str) -> dict:
    """检测技术栈"""
    stack = {"languages": [], "frameworks": [], "buildTools": [], "databases": []}
    # 语言检测
    ext_counts = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".git", "__pycache__", "dist", "build", ".venv")]
        for f in filenames:
            ext = os.path.splitext(f)[1].lower()
            ext_counts[ext] = ext_counts.get(ext, 0) + 1
    lang_map = {
        ".py": "Python", ".js": "JavaScript", ".ts": "TypeScript", ".jsx": "React", ".tsx": "React",
        ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".c": "C", ".cpp": "C++",
        ".cs": "C#", ".rb": "Ruby", ".php": "PHP", ".swift": "Swift",
    }
    for ext, count in ext_counts.items():
        if ext in lang_map and count >= 2:
            stack["languages"].append(lang_map[ext])
    # 框架检测
    if os.path.exists(os.path.join(root, "package.json")):
        try:
            pkg = json.loads(Path(os.path.join(root, "package.json")).read_text(encoding="utf-8"))
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            framework_map = {
                "react": "React", "vue": "Vue", "svelte": "Svelte", "next": "Next.js",
                "nuxt": "Nuxt", "express": "Express", "fastify": "Fastify",
                "@nestjs/core": "NestJS", "django": "Django", "flask": "Flask",
            }
            for pkg_name, fw_name in framework_map.items():
                if pkg_name in deps:
                    stack["frameworks"].append(fw_name)
        except Exception:
            pass
    if os.path.exists(os.path.join(root, "requirements.txt")) or os.path.exists(os.path.join(root, "pyproject.toml")):
        stack["frameworks"].append("Python")
    # 构建工具
    build_files = {"webpack.config": "Webpack", "vite.config": "Vite", "tsconfig.json": "TypeScript",
                   "Makefile": "Make", "CMakeLists.txt": "CMake", "Cargo.toml": "Cargo"}
    for fname, tool in build_files.items():
        if os.path.exists(os.path.join(root, fname)):
            stack["buildTools"].append(tool)
    # 数据库
    db_files = {"alembic.ini": "SQLAlchemy", "drizzle.config": "Drizzle",
                "prisma/schema.prisma": "Prisma", "knexfile": "Knex"}
    for fname, db in db_files.items():
        if os.path.exists(os.path.join(root, fname)):
            stack["databases"].append(db)
    return stack

def _detect_coding_style(root: str) -> dict:
    """检测编码风格"""
    style = {"indent": "4 spaces", "quotes": "double", "semicolons": True}
    # .editorconfig
    ec = os.path.join(root, ".editorconfig")
    if os.path.exists(ec):
        try:
            content = Path(ec).read_text(encoding="utf-8")
            for line in content.split("\n"):
                line = line.strip()
                if line.startswith("indent_style"):
                    val = line.split("=", 1)[1].strip()
                    style["indent"] = "tabs" if val == "tab" else "spaces"
                elif line.startswith("indent_size"):
                    size = line.split("=", 1)[1].strip()
                    if style["indent"] == "spaces":
                        style["indent"] = f"{size} spaces"
                elif line.startswith("max_line_length"):
                    style["maxLineLength"] = int(line.split("=", 1)[1].strip())
        except Exception:
            pass
    # .prettierrc
    pr = os.path.join(root, ".prettierrc")
    if os.path.exists(pr):
        try:
            cfg = json.loads(Path(pr).read_text(encoding="utf-8"))
            if "singleQuote" in cfg:
                style["quotes"] = "single" if cfg["singleQuote"] else "double"
            if "semi" in cfg:
                style["semicolons"] = cfg["semi"]
        except Exception:
            pass
    return style

def _detect_directory_layout(root: str) -> dict:
    """检测目录结构"""
    layout = {"topLevel": [], "hasSrc": False, "hasTests": False, "hasMonorepo": False}
    try:
        entries = os.listdir(root)
        layout["topLevel"] = [e for e in entries if os.path.isdir(os.path.join(root, e)) and not e.startswith(".")]
        layout["hasSrc"] = "src" in layout["topLevel"]
        layout["hasTests"] = any(d in layout["topLevel"] for d in ("test", "tests", "__tests__"))
        layout["hasMonorepo"] = "packages" in layout["topLevel"] or "apps" in layout["topLevel"]
    except Exception:
        pass
    return layout

def _detect_package_manager(root: str) -> str:
    """检测包管理器"""
    checks = [("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"),
              ("package-lock.json", "npm"), ("bun.lockb", "bun"),
              ("Cargo.lock", "cargo"), ("go.sum", "go mod"),
              ("poetry.lock", "poetry"), ("Pipfile.lock", "pipenv")]
    for fname, mgr in checks:
        if os.path.exists(os.path.join(root, fname)):
            return mgr
    return "unknown"

def get_injection(project_path: str = "") -> dict:
    """获取记忆注入文本，用于 system prompt"""
    global _memory_cache, _last_cache_time
    now = time.time() * 1000
    if project_path and (now - _last_cache_time > CACHE_TTL or not _memory_cache):
        _auto_detect(project_path)
    injection = _format_injection()
    return {"injection": injection}

def _format_injection() -> str:
    """格式化记忆为可注入文本"""
    m = _memory_cache
    if not m:
        return ""
    parts = ["【项目记忆 - Project Memory】"]
    ts = m.get("techStack", {})
    if ts.get("languages"):
        parts.append(f"\n## 技术栈\n- 语言: {', '.join(ts['languages'])}")
    if ts.get("frameworks"):
        parts.append(f"- 框架: {', '.join(ts['frameworks'])}")
    if ts.get("buildTools"):
        parts.append(f"- 构建工具: {', '.join(ts['buildTools'])}")
    pm = m.get("packageManager", "")
    if pm and pm != "unknown":
        parts.append(f"\n- 包管理器: {pm}")
    cs = m.get("codingStyle", {})
    if cs:
        parts.append(f"\n## 编码风格\n- 缩进: {cs.get('indent', 'unknown')}\n- 引号: {cs.get('quotes', 'double')}")
    dl = m.get("directoryLayout", {})
    if dl:
        parts.append(f"\n## 项目结构\n- 顶层: {', '.join(dl.get('topLevel', [])[:8])}")
    # 常用模式
    patterns = m.get("patterns", [])
    frequent = sorted([p for p in patterns if p.get("count", 0) >= 2], key=lambda x: -x.get("count", 0))[:5]
    if frequent:
        parts.append("\n## 常用修复模式")
        for p in frequent:
            parts.append(f"- {p.get('trigger', '')[:50]} -> {p.get('solution', '')[:60]}")
    # 近期决策
    decisions = m.get("decisions", [])[-5:]
    if decisions:
        parts.append("\n## 近期技术决策")
        for d in reversed(decisions):
            parts.append(f"- {d.get('topic', '')}: {d.get('decision', '')[:60]}")
    parts.append("\n【项目记忆结束】")
    return "\n".join(parts)

def search_patterns(query: str, project_path: str = "") -> dict:
    """搜索修复模式"""
    if not _memory_cache:
        if project_path:
            _auto_detect(project_path)
    patterns = _memory_cache.get("patterns", [])
    if not query:
        return {"patterns": patterns[:20]}
    q = query.lower()
    results = [p for p in patterns if q in (p.get("trigger", "") + p.get("solution", "")).lower()]
    return {"patterns": results[:20], "total": len(results)}

def search_decisions(query: str, project_path: str = "") -> dict:
    """搜索技术决策"""
    if not _memory_cache:
        if project_path:
            _auto_detect(project_path)
    decisions = _memory_cache.get("decisions", [])
    if not query:
        return {"decisions": decisions[:20]}
    q = query.lower()
    results = [d for d in decisions if q in (d.get("topic", "") + d.get("decision", "")).lower()]
    return {"decisions": results[:20], "total": len(results)}

def record_pattern(project_path: str, trigger: str, solution: str, context: str = "", source: str = "conversation") -> dict:
    """记录修复模式"""
    patterns = _memory_cache.setdefault("patterns", [])
    # 去重
    for p in patterns:
        if p.get("trigger") == trigger or (solution and p.get("solution", "")[:100] == solution[:100]):
            p["count"] = p.get("count", 0) + 1
            p["lastUsed"] = time.time() * 1000
            _save_memory(project_path)
            return {"success": True, "updated": True}
    patterns.append({
        "trigger": trigger, "solution": solution[:1000], "context": context[:500],
        "source": source, "count": 1, "createdAt": time.time() * 1000, "lastUsed": time.time() * 1000,
    })
    if len(patterns) > 100:
        _memory_cache["patterns"] = patterns[-100:]
    _save_memory(project_path)
    return {"success": True}

def record_decision(project_path: str, topic: str, decision: str, alternatives: list = None, rationale: str = "") -> dict:
    """记录技术决策"""
    decisions = _memory_cache.setdefault("decisions", [])
    decisions.append({
        "topic": topic, "decision": decision[:500],
        "alternatives": alternatives or [], "rationale": rationale[:500],
        "timestamp": time.time() * 1000,
    })
    if len(decisions) > 30:
        _memory_cache["decisions"] = decisions[-30:]
    _save_memory(project_path)
    return {"success": True}
