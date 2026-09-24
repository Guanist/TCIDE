"""
TCIDE Advanced Features Module
LSP, MCP, Semantic, Entropy, Auto-heal, Warehouse, Git Intelligence,
Snapshot, Usage, Debugger, Privacy — all in one file.
"""
import os, json, time, sqlite3, hashlib, subprocess, re, difflib, threading
from pathlib import Path
from typing import Dict, List, Optional, Any
from collections import Counter, defaultdict
from datetime import datetime, timedelta


# ═══════════════════════════════════════════
# LSP Client
# ═══════════════════════════════════════════
class LSPClient:
    def __init__(self):
        self.servers: Dict[str, Any] = {}
        self.processes: Dict[str, subprocess.Popen] = {}

    def start(self, language: str, project_root: str):
        cmds = {
            "python": ["pyright-langserver", "--stdio"],
            "typescript": ["typescript-language-server", "--stdio"],
            "javascript": ["typescript-language-server", "--stdio"],
        }
        cmd = cmds.get(language)
        if not cmd:
            return {"error": f"No LSP server for {language}"}
        try:
            env = os.environ.copy()
            env["PYTHONIOENCODING"] = "utf-8"
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, cwd=project_root, env=env,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            self.processes[language] = proc
            init_msg = {
                "jsonrpc": "2.0", "id": 0, "method": "initialize",
                "params": {
                    "processId": os.getpid(),
                    "rootUri": Path(project_root).as_uri(),
                    "capabilities": {}
                }
            }
            self._send(language, init_msg)
            resp = self._recv(language)
            self.servers[language] = {"pid": proc.pid, "status": "running"}
            return {"status": "started", "language": language, "pid": proc.pid}
        except FileNotFoundError:
            return {"error": f"LSP server not found for {language}"}
        except Exception as e:
            return {"error": str(e)}

    def stop(self, language: str):
        proc = self.processes.pop(language, None)
        if proc:
            proc.terminate()
            self.servers.pop(language, None)
            return {"status": "stopped", "language": language}
        return {"error": f"No server for {language}"}

    def did_open(self, language: str, uri: str, text: str):
        msg = {"jsonrpc": "2.0", "method": "textDocument/didOpen",
               "params": {"textDocument": {"uri": uri, "languageId": language, "version": 0, "text": text}}}
        return self._send(language, msg)

    def did_change(self, language: str, uri: str, text: str, version: int = 1):
        msg = {"jsonrpc": "2.0", "method": "textDocument/didChange",
               "params": {"textDocument": {"uri": uri, "version": version},
                          "contentChanges": [{"text": text}]}}
        return self._send(language, msg)

    def completion(self, language: str, uri: str, line: int, character: int):
        msg = {"jsonrpc": "2.0", "id": 100, "method": "textDocument/completion",
               "params": {"textDocument": {"uri": uri},
                          "position": {"line": line, "character": character}}}
        self._send(language, msg)
        return self._recv(language) or {"items": []}

    def definition(self, language: str, uri: str, line: int, character: int):
        msg = {"jsonrpc": "2.0", "id": 101, "method": "textDocument/definition",
               "params": {"textDocument": {"uri": uri},
                          "position": {"line": line, "character": character}}}
        self._send(language, msg)
        return self._recv(language) or {"locations": []}

    def references(self, language: str, uri: str, line: int, character: int):
        msg = {"jsonrpc": "2.0", "id": 102, "method": "textDocument/references",
               "params": {"textDocument": {"uri": uri},
                          "position": {"line": line, "character": character},
                          "context": {"includeDeclaration": True}}}
        self._send(language, msg)
        return self._recv(language) or {"locations": []}

    def diagnostics(self, language: str):
        return self.servers.get(language, {}).get("diagnostics", [])

    def list_servers(self):
        return {k: v for k, v in self.servers.items()}

    def _send(self, language, msg):
        proc = self.processes.get(language)
        if not proc or not proc.stdin:
            return {"error": "not connected"}
        try:
            data = json.dumps(msg)
            proc.stdin.write(f"Content-Length: {len(data.encode())}\r\n\r\n{data}".encode())
            proc.stdin.flush()
            return {"ok": True}
        except Exception as e:
            return {"error": str(e)}

    def _recv(self, language):
        proc = self.processes.get(language)
        if not proc or not proc.stdout:
            return None
        try:
            proc.stdout.flush()
            header = b""
            while b"\r\n\r\n" not in header:
                chunk = proc.stdout.read(1)
                if not chunk:
                    return None
                header += chunk
            length = int(header.split(b"Content-Length: ")[1].split(b"\r\n")[0])
            body = proc.stdout.read(length)
            return json.loads(body) if body else None
        except Exception:
            return None


# ═══════════════════════════════════════════
# MCP Tools
# ═══════════════════════════════════════════
class MCPManager:
    def __init__(self):
        self.servers: Dict[str, Any] = {}
        self.tools: Dict[str, Any] = {}

    def connect(self, name: str, command: str, args: List[str] = None, env: Dict = None):
        try:
            cmd = [command] + (args or [])
            merged_env = os.environ.copy()
            if env:
                merged_env.update(env)
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, env=merged_env,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            self.servers[name] = {"command": command, "pid": proc.pid, "status": "connected"}
            self._discover_tools(name)
            return {"status": "connected", "name": name, "pid": proc.pid}
        except Exception as e:
            return {"error": str(e)}

    def disconnect(self, name: str):
        if name in self.servers:
            del self.servers[name]
            return {"status": "disconnected", "name": name}
        return {"error": f"Server {name} not found"}

    def list_servers(self):
        return [{"name": k, **v} for k, v in self.servers.items()]

    def list_tools(self):
        return [{"server": s, **t} for s, tools in self.tools.items() for t in tools]

    def call_tool(self, name: str, arguments: Dict):
        for server, tools in self.tools.items():
            for tool in tools:
                if tool["name"] == name:
                    return {"result": f"Tool {name} executed", "arguments": arguments}
        return {"error": f"Tool {name} not found"}

    def _discover_tools(self, server_name):
        self.tools[server_name] = [
            {"name": "read_file", "description": "Read file contents", "parameters": {"path": "string"}},
            {"name": "write_file", "description": "Write file contents", "parameters": {"path": "string", "content": "string"}},
            {"name": "list_directory", "description": "List directory", "parameters": {"path": "string"}},
            {"name": "search_files", "description": "Search files by pattern", "parameters": {"pattern": "string"}},
            {"name": "execute_command", "description": "Execute shell command", "parameters": {"command": "string"}},
        ]


# ═══════════════════════════════════════════
# Semantic Analysis
# ═══════════════════════════════════════════
class SemanticCompleter:
    def __init__(self):
        self.index: Dict[str, List] = {}

    def index_file(self, path: str, content: str):
        tokens = re.findall(r'\b\w+\b', content)
        for i, token in enumerate(tokens):
            context = tokens[max(0, i-3):i+4]
            if token not in self.index:
                self.index[token] = []
            self.index[token].append({"file": path, "context": context, "position": i})

    def complete(self, prefix: str, context: List[str] = None):
        candidates = []
        for token, entries in self.index.items():
            if token.startswith(prefix):
                score = len(entries)
                if context:
                    common = len(set(token_context(entry["context"]) for entry in entries) & set(context))
                    score += common * 2
                candidates.append({"text": token, "score": score, "source": entries[0]["file"]})
        candidates.sort(key=lambda x: -x["score"])
        return candidates[:20]


def token_context(tokens):
    return " ".join(tokens[:3])


# ═══════════════════════════════════════════
# Entropy Evaluator
# ═══════════════════════════════════════════
class EntropyEvaluator:
    def __init__(self):
        self.history: List[Dict] = []

    def evaluate(self, file_path: str, content: str) -> Dict:
        lines = content.split('\n')
        total_lines = len(lines)
        blank_lines = sum(1 for l in lines if not l.strip())
        comment_lines = sum(1 for l in lines if l.strip().startswith(('#', '//', '/*', '*', '<!--')))
        code_lines = total_lines - blank_lines - comment_lines

        unique_tokens = len(set(re.findall(r'\b\w+\b', content)))
        total_tokens = len(re.findall(r'\b\w+\b', content))
        lexical_diversity = unique_tokens / max(total_tokens, 1)

        nesting_depth = 0
        max_depth = 0
        for char in content:
            if char in '({[':
                nesting_depth += 1
                max_depth = max(max_depth, nesting_depth)
            elif char in ')}]':
                nesting_depth -= 1

        long_lines = sum(1 for l in lines if len(l) > 120)
        complexity_score = min(100, (code_lines / max(total_lines, 1) * 50 +
                                     max_depth * 5 + long_lines * 2 +
                                     (1 - lexical_diversity) * 50))

        result = {
            "file": file_path,
            "total_lines": total_lines,
            "code_lines": code_lines,
            "blank_lines": blank_lines,
            "comment_lines": comment_lines,
            "lexical_diversity": round(lexical_diversity, 3),
            "max_nesting": max_depth,
            "long_lines": long_lines,
            "complexity_score": round(complexity_score, 1),
            "rating": "low" if complexity_score < 30 else "medium" if complexity_score < 60 else "high"
        }
        self.history.append(result)
        return result

    def evaluate_project(self, project_root: str) -> Dict:
        results = []
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '__pycache__', '.git', 'dist', 'build')]
            for f in files:
                if f.endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.rs', '.go')):
                    fp = os.path.join(root, f)
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                            results.append(self.evaluate(fp, fh.read()))
                    except Exception:
                        pass

        avg_complexity = sum(r["complexity_score"] for r in results) / max(len(results), 1)
        total_code = sum(r["code_lines"] for r in results)
        return {
            "files_analyzed": len(results),
            "total_code_lines": total_code,
            "avg_complexity": round(avg_complexity, 1),
            "rating": "low" if avg_complexity < 30 else "medium" if avg_complexity < 60 else "high",
            "files": sorted(results, key=lambda x: -x["complexity_score"])[:10]
        }


# ═══════════════════════════════════════════
# Smart Context Trimmer
# ═══════════════════════════════════════════
class ContextTrimmer:
    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens

    def trim(self, messages: List[Dict], project_context: str = "") -> List[Dict]:
        total = 0
        result = []
        for msg in reversed(messages):
            msg_tokens = len(msg.get("content", "").split())
            if total + msg_tokens > self.max_tokens:
                break
            result.insert(0, msg)
            total += msg_tokens
        if project_context:
            ctx_tokens = len(project_context.split())
            if ctx_tokens < self.max_tokens * 0.3:
                result.insert(0, {"role": "system", "content": project_context})
        return result

    def summarize(self, text: str, max_sentences: int = 3) -> str:
        sentences = re.split(r'[.!?]+', text)
        sentences = [s.strip() for s in sentences if s.strip()]
        return '. '.join(sentences[:max_sentences]) + '.' if sentences else text


# ═══════════════════════════════════════════
# Auto-heal Manager
# ═══════════════════════════════════════════
class AutoHealManager:
    def __init__(self):
        self.healing_history: List[Dict] = []

    def diagnose(self, error_output: str, file_content: str = None) -> Dict:
        suggestions = []
        error_lower = error_output.lower()

        if "ModuleNotFoundError" in error_output:
            module = re.search(r"No module named '(\w+)'", error_output)
            if module:
                suggestions.append({"type": "install", "action": f"pip install {module.group(1)}",
                                    "confidence": 0.9})
        elif "ImportError" in error_output:
            suggestions.append({"type": "import_fix", "action": "Check import paths", "confidence": 0.7})
        elif "SyntaxError" in error_output:
            line = re.search(r"line (\d+)", error_output)
            if line and file_content:
                suggestions.append({"type": "syntax", "action": f"Fix syntax at line {line.group(1)}",
                                    "confidence": 0.8})
        elif "IndentationError" in error_output:
            suggestions.append({"type": "indentation", "action": "Fix indentation", "confidence": 0.85})
        elif "TypeError" in error_output:
            suggestions.append({"type": "type", "action": "Check argument types", "confidence": 0.6})
        elif "AttributeError" in error_output:
            suggestions.append({"type": "attribute", "action": "Check object attributes", "confidence": 0.65})
        elif "FileNotFoundError" in error_output:
            suggestions.append({"type": "file", "action": "Check file path exists", "confidence": 0.8})
        elif "PermissionError" in error_output:
            suggestions.append({"type": "permission", "action": "Check file permissions", "confidence": 0.75})

        result = {"error": error_output, "suggestions": suggestions, "auto_healable": len(suggestions) > 0}
        self.healing_history.append(result)
        return result

    def get_stats(self):
        return {"total_heals": len(self.healing_history),
                "healable": sum(1 for h in self.healing_history if h["auto_healable"])}


# ═══════════════════════════════════════════
# Warehouse Analyzer
# ═══════════════════════════════════════════
class WarehouseAnalyzer:
    def __init__(self):
        self.cache: Dict[str, Any] = {}

    def analyze(self, project_root: str) -> Dict:
        file_stats = {}
        total_size = 0
        total_lines = 0
        lang_stats = defaultdict(lambda: {"files": 0, "lines": 0, "size": 0})

        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '__pycache__', '.git', 'dist', 'build', '.venv')]
            for f in files:
                fp = os.path.join(root, f)
                try:
                    size = os.path.getsize(fp)
                    total_size += size
                    ext = os.path.splitext(f)[1].lower() or '.unknown'
                    lang = self._ext_to_lang(ext)
                    lang_stats[lang]["files"] += 1
                    lang_stats[lang]["size"] += size
                    if ext in ('.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.rs', '.go', '.md', '.json', '.yaml', '.yml'):
                        with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                            lines = len(fh.readlines())
                            total_lines += lines
                            lang_stats[lang]["lines"] += lines
                except Exception:
                    pass

        structure = self._get_structure(project_root)
        result = {
            "total_files": sum(v["files"] for v in lang_stats.values()),
            "total_size": total_size,
            "total_lines": total_lines,
            "languages": dict(lang_stats),
            "structure": structure,
            "health_score": self._health_score(lang_stats, total_lines)
        }
        self.cache[project_root] = result
        return result

    def _ext_to_lang(self, ext):
        mapping = {'.py': 'Python', '.js': 'JavaScript', '.ts': 'TypeScript',
                   '.tsx': 'TypeScript JSX', '.jsx': 'JavaScript JSX',
                   '.java': 'Java', '.c': 'C', '.cpp': 'C++', '.rs': 'Rust',
                   '.go': 'Go', '.rb': 'Ruby', '.php': 'PHP',
                   '.md': 'Markdown', '.json': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
                   '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
                   '.sql': 'SQL', '.sh': 'Shell', '.bat': 'Batch'}
        return mapping.get(ext, ext.lstrip('.').upper() or 'Unknown')

    def _get_structure(self, root, max_depth=3):
        structure = []
        for item in sorted(os.listdir(root)):
            if item.startswith('.') or item in ('node_modules', '__pycache__', '.git', 'dist', 'build', '.venv'):
                continue
            fp = os.path.join(root, item)
            entry = {"name": item, "type": "dir" if os.path.isdir(fp) else "file"}
            if os.path.isdir(fp) and max_depth > 0:
                entry["children"] = self._get_structure(fp, max_depth - 1)
            structure.append(entry)
        return structure

    def _health_score(self, lang_stats, total_lines):
        score = 100
        if total_lines > 50000:
            score -= 10
        if len(lang_stats) > 5:
            score -= 5
        return max(0, score)


# ═══════════════════════════════════════════
# Git Intelligence
# ═══════════════════════════════════════════
class GitIntelligence:
    def __init__(self):
        pass

    def analyze(self, project_root: str) -> Dict:
        try:
            result = subprocess.run(
                ["git", "log", "--oneline", "-50", "--format=%H|%an|%ae|%ai|%s"],
                cwd=project_root, capture_output=True, text=True, timeout=10,
                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            )
            commits = []
            for line in result.stdout.strip().split('\n'):
                if '|' in line:
                    parts = line.split('|', 4)
                    if len(parts) == 5:
                        commits.append({
                            "hash": parts[0][:8], "author": parts[1],
                            "email": parts[2], "date": parts[3], "message": parts[4]
                        })

            authors = Counter(c["author"] for c in commits)
            recent = [c for c in commits if self._is_recent(c["date"], 7)]

            return {
                "total_commits": len(commits),
                "unique_authors": len(authors),
                "top_authors": authors.most_common(5),
                "recent_commits_7d": len(recent),
                "health_score": self._health(commits, authors, recent)
            }
        except Exception as e:
            return {"error": str(e)}

    def _is_recent(self, date_str: str, days: int) -> bool:
        try:
            dt = datetime.fromisoformat(date_str.replace(' +', '+').replace(' -', '-'))
            return (datetime.now(dt.tzinfo) - dt).days <= days
        except Exception:
            return False

    def _health(self, commits, authors, recent):
        score = 50
        if recent:
            score += min(25, len(recent) * 5)
        if len(authors) > 1:
            score += 10
        if commits:
            score += min(15, len(commits) * 0.5)
        return min(100, int(score))


# ═══════════════════════════════════════════
# Snapshot Manager
# ═══════════════════════════════════════════
class SnapshotManager:
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        if not self.db_path:
            return
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('''CREATE TABLE IF NOT EXISTS snapshots
                (id INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT, task_id TEXT,
                 file_path TEXT, content TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            conn.commit()
            conn.close()
        except Exception:
            pass

    def save(self, project_path: str, task_id: str, file_path: str, content: str) -> Dict:
        if not self.db_path:
            return {"status": "no_db"}
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("INSERT INTO snapshots (project_path, task_id, file_path, content) VALUES (?, ?, ?, ?)",
                         (project_path, task_id, file_path, content))
            conn.commit()
            conn.close()
            return {"status": "saved", "file": file_path}
        except Exception as e:
            return {"error": str(e)}

    def list_snapshots(self, project_path: str, limit: int = 50) -> List[Dict]:
        if not self.db_path:
            return []
        try:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                "SELECT id, task_id, file_path, created_at FROM snapshots WHERE project_path = ? ORDER BY created_at DESC LIMIT ?",
                (project_path, limit)).fetchall()
            conn.close()
            return [{"id": r[0], "task_id": r[1], "file_path": r[2], "created_at": r[3]} for r in rows]
        except Exception:
            return []

    def restore(self, snapshot_id: int) -> Dict:
        if not self.db_path:
            return {"error": "no_db"}
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute("SELECT file_path, content FROM snapshots WHERE id = ?", (snapshot_id,)).fetchone()
            conn.close()
            if row:
                with open(row[0], 'w', encoding='utf-8') as f:
                    f.write(row[1])
                return {"status": "restored", "file": row[0]}
            return {"error": "snapshot not found"}
        except Exception as e:
            return {"error": str(e)}


# ═══════════════════════════════════════════
# Usage Tracker
# ═══════════════════════════════════════════
class UsageTracker:
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        if not self.db_path:
            return
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('''CREATE TABLE IF NOT EXISTS usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp INTEGER, project_path TEXT,
                model TEXT, provider TEXT, input_tokens INTEGER, output_tokens INTEGER,
                cost_rmb REAL, duration_ms INTEGER, session_id TEXT)''')
            conn.commit()
            conn.close()
        except Exception:
            pass

    def track(self, project_path: str, model: str, provider: str,
              input_tokens: int, output_tokens: int, cost_rmb: float = 0,
              duration_ms: int = 0, session_id: str = "") -> Dict:
        if not self.db_path:
            return {"status": "no_db"}
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute(
                "INSERT INTO usage (timestamp, project_path, model, provider, input_tokens, output_tokens, cost_rmb, duration_ms, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (int(time.time()), project_path, model, provider, input_tokens, output_tokens, cost_rmb, duration_ms, session_id))
            conn.commit()
            conn.close()
            return {"status": "tracked"}
        except Exception as e:
            return {"error": str(e)}

    def stats(self, project_path: str) -> Dict:
        if not self.db_path:
            return {"total_calls": 0, "total_tokens": 0, "total_cost": 0}
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute(
                "SELECT COUNT(*), COALESCE(SUM(input_tokens + output_tokens), 0), COALESCE(SUM(cost_rmb), 0) FROM usage WHERE project_path = ?",
                (project_path,)).fetchone()
            conn.close()
            return {"total_calls": row[0], "total_tokens": row[1], "total_cost": round(row[2], 4)}
        except Exception:
            return {"total_calls": 0, "total_tokens": 0, "total_cost": 0}

    def history(self, project_path: str, limit: int = 100) -> List[Dict]:
        if not self.db_path:
            return []
        try:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                "SELECT timestamp, model, provider, input_tokens, output_tokens, cost_rmb, duration_ms FROM usage WHERE project_path = ? ORDER BY timestamp DESC LIMIT ?",
                (project_path, limit)).fetchall()
            conn.close()
            return [{"timestamp": r[0], "model": r[1], "provider": r[2],
                     "input_tokens": r[3], "output_tokens": r[4],
                     "cost_rmb": r[5], "duration_ms": r[6]} for r in rows]
        except Exception:
            return []


# ═══════════════════════════════════════════
# Debug Manager
# ═══════════════════════════════════════════
class DebugManager:
    def __init__(self):
        self.breakpoints: Dict[str, List[int]] = {}
        self.variables: Dict[str, Any] = {}

    def set_breakpoint(self, file_path: str, line: int):
        if file_path not in self.breakpoints:
            self.breakpoints[file_path] = []
        if line not in self.breakpoints[file_path]:
            self.breakpoints[file_path].append(line)
        return {"status": "set", "file": file_path, "line": line}

    def remove_breakpoint(self, file_path: str, line: int):
        if file_path in self.breakpoints:
            self.breakpoints[file_path] = [l for l in self.breakpoints[file_path] if l != line]
        return {"status": "removed", "file": file_path, "line": line}

    def list_breakpoints(self) -> List[Dict]:
        result = []
        for fp, lines in self.breakpoints.items():
            for line in lines:
                result.append({"file": fp, "line": line})
        return result

    def evaluate(self, expression: str, scope: Dict = None) -> Dict:
        try:
            local_vars = scope or {}
            result = eval(expression, {"__builtins__": {}}, local_vars)
            return {"result": str(result), "type": type(result).__name__}
        except Exception as e:
            return {"error": str(e)}


# ═══════════════════════════════════════════
# Privacy Net
# ═══════════════════════════════════════════
class PrivacyNet:
    def __init__(self):
        self.blocked: List[str] = []
        self.allowed: List[str] = []

    def check(self, url: str) -> Dict:
        for pattern in self.blocked:
            if pattern in url:
                return {"allowed": False, "reason": f"Blocked by rule: {pattern}"}
        return {"allowed": True}

    def add_block(self, pattern: str):
        if pattern not in self.blocked:
            self.blocked.append(pattern)

    def add_allow(self, pattern: str):
        if pattern not in self.allowed:
            self.allowed.append(pattern)

    def list_rules(self):
        return {"blocked": self.blocked, "allowed": self.allowed}


# ═══════════════════════════════════════════
# Project Compat
# ═══════════════════════════════════════════
class ProjectCompatManager:
    def __init__(self):
        self.detectors = [
            {"name": "Python", "files": ["requirements.txt", "setup.py", "pyproject.toml", "Pipfile"],
             "extensions": [".py"]},
            {"name": "Node.js", "files": ["package.json", "tsconfig.json"],
             "extensions": [".js", ".ts", ".tsx", ".jsx"]},
            {"name": "Rust", "files": ["Cargo.toml"],
             "extensions": [".rs"]},
            {"name": "Go", "files": ["go.mod"],
             "extensions": [".go"]},
            {"name": "Java", "files": ["pom.xml", "build.gradle"],
             "extensions": [".java"]},
        ]

    def detect(self, project_root: str) -> Dict:
        detected = []
        for detector in self.detectors:
            found_files = [f for f in detector["files"] if os.path.exists(os.path.join(project_root, f))]
            if found_files:
                detected.append({"name": detector["name"], "config_files": found_files})
        return {"detected": detected, "primary": detected[0]["name"] if detected else "Unknown"}


# ═══════════════════════════════════════════
# Semantic Chunker
# ═══════════════════════════════════════════
class SemanticChunker:
    def __init__(self, chunk_size: int = 512):
        self.chunk_size = chunk_size

    def chunk_file(self, content: str, file_path: str) -> List[Dict]:
        lines = content.split('\n')
        chunks = []
        current_chunk = []
        current_size = 0
        chunk_start = 1

        for i, line in enumerate(lines, 1):
            tokens = len(line.split())
            if current_size + tokens > self.chunk_size and current_chunk:
                chunks.append({
                    "file": file_path, "start_line": chunk_start, "end_line": i - 1,
                    "content": '\n'.join(current_chunk), "tokens": current_size
                })
                current_chunk = [line]
                current_size = tokens
                chunk_start = i
            else:
                current_chunk.append(line)
                current_size += tokens

        if current_chunk:
            chunks.append({
                "file": file_path, "start_line": chunk_start, "end_line": len(lines),
                "content": '\n'.join(current_chunk), "tokens": current_size
            })
        return chunks

    def chunk_project(self, project_root: str) -> List[Dict]:
        all_chunks = []
        for root, dirs, files in os.walk(project_root):
            dirs[:] = [d for d in dirs if d not in ('node_modules', '__pycache__', '.git', 'dist', 'build', '.venv')]
            for f in files:
                if f.endswith(('.py', '.js', '.ts', '.tsx', '.jsx', '.java', '.c', '.cpp', '.rs', '.go')):
                    fp = os.path.join(root, f)
                    try:
                        with open(fp, 'r', encoding='utf-8', errors='replace') as fh:
                            all_chunks.extend(self.chunk_file(fh.read(), fp))
                    except Exception:
                        pass
        return all_chunks


# ═══════════════════════════════════════════
# Perf Optimizer
# ═══════════════════════════════════════════
class PerfOptimizer:
    def __init__(self):
        self.metrics: Dict[str, List[float]] = defaultdict(list)

    def record(self, operation: str, duration_ms: float):
        self.metrics[operation].append(duration_ms)

    def stats(self, operation: str = None) -> Dict:
        if operation:
            times = self.metrics.get(operation, [])
            if not times:
                return {"operation": operation, "count": 0}
            return {
                "operation": operation, "count": len(times),
                "avg_ms": round(sum(times) / len(times), 2),
                "min_ms": round(min(times), 2), "max_ms": round(max(times), 2),
                "total_ms": round(sum(times), 2)
            }
        return {op: self.stats(op) for op in self.metrics}

    def slow_operations(self, threshold_ms: float = 1000) -> List[Dict]:
        result = []
        for op, times in self.metrics.items():
            avg = sum(times) / len(times) if times else 0
            if avg > threshold_ms:
                result.append({"operation": op, "avg_ms": round(avg, 2), "count": len(times)})
        return sorted(result, key=lambda x: -x["avg_ms"])


# ═══════════════════════════════════════════
# Memory Manager
# ═══════════════════════════════════════════
class ProjectMemory:
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        if not self.db_path:
            return
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute('''CREATE TABLE IF NOT EXISTS project_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT, project_path TEXT,
                key TEXT, value TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
            conn.commit()
            conn.close()
        except Exception:
            pass

    def add(self, project_path: str, key: str, value: str) -> Dict:
        if not self.db_path:
            return {"status": "no_db"}
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("INSERT INTO project_memory (project_path, key, value) VALUES (?, ?, ?)",
                         (project_path, key, value))
            conn.commit()
            conn.close()
            return {"status": "added", "key": key}
        except Exception as e:
            return {"error": str(e)}

    def get_context(self, project_path: str) -> str:
        if not self.db_path:
            return ""
        try:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                "SELECT key, value FROM project_memory WHERE project_path = ? ORDER BY created_at DESC LIMIT 50",
                (project_path,)).fetchall()
            conn.close()
            return "\n".join(f"{r[0]}: {r[1]}" for r in rows)
        except Exception:
            return ""

    def search(self, project_path: str, query: str) -> List[Dict]:
        if not self.db_path:
            return []
        try:
            conn = sqlite3.connect(self.db_path)
            rows = conn.execute(
                "SELECT id, key, value, created_at FROM project_memory WHERE project_path = ? AND (key LIKE ? OR value LIKE ?) ORDER BY created_at DESC LIMIT 20",
                (project_path, f"%{query}%", f"%{query}%")).fetchall()
            conn.close()
            return [{"id": r[0], "key": r[1], "value": r[2], "created_at": r[3]} for r in rows]
        except Exception:
            return []

    def clear(self, project_path: str) -> Dict:
        if not self.db_path:
            return {"status": "no_db"}
        try:
            conn = sqlite3.connect(self.db_path)
            conn.execute("DELETE FROM project_memory WHERE project_path = ?", (project_path,))
            conn.commit()
            conn.close()
            return {"status": "cleared"}
        except Exception as e:
            return {"error": str(e)}

    def summary(self, project_path: str) -> Dict:
        if not self.db_path:
            return {"total_entries": 0}
        try:
            conn = sqlite3.connect(self.db_path)
            row = conn.execute(
                "SELECT COUNT(*) FROM project_memory WHERE project_path = ?", (project_path,)).fetchone()
            conn.close()
            return {"total_entries": row[0]}
        except Exception:
            return {"total_entries": 0}


# ═══════════════════════════════════════════
# Vector Indexer
# ═══════════════════════════════════════════
class VectorIndexer:
    def __init__(self):
        self.index: Dict[str, List[Dict]] = {}

    def index_file(self, file_path: str, content: str):
        chunks = []
        lines = content.split('\n')
        chunk_size = 50
        for i in range(0, len(lines), chunk_size):
            chunk = '\n'.join(lines[i:i+chunk_size])
            tokens = set(re.findall(r'\b\w+\b', chunk.lower()))
            chunks.append({
                "file": file_path, "start_line": i + 1, "end_line": min(i + chunk_size, len(lines)),
                "content": chunk, "tokens": tokens
            })
        self.index[file_path] = chunks

    def search(self, query: str, top_k: int = 10) -> List[Dict]:
        query_tokens = set(re.findall(r'\b\w+\b', query.lower()))
        results = []
        for file_path, chunks in self.index.items():
            for chunk in chunks:
                common = query_tokens & chunk["tokens"]
                if common:
                    score = len(common) / max(len(query_tokens), 1)
                    results.append({
                        "file": chunk["file"], "start_line": chunk["start_line"],
                        "end_line": chunk["end_line"], "score": round(score, 3),
                        "preview": chunk["content"][:200]
                    })
        results.sort(key=lambda x: -x["score"])
        return results[:top_k]

    def get_stats(self) -> Dict:
        total_chunks = sum(len(chunks) for chunks in self.index.values())
        return {"files_indexed": len(self.index), "total_chunks": total_chunks}


# ═══════════════════════════════════════════
# Unattended Runner
# ═══════════════════════════════════════════
class UnattendedRunner:
    def __init__(self):
        self.running = False
        self.results: List[Dict] = []

    def run_task(self, task: str, adapter=None, max_retries: int = 3) -> Dict:
        self.running = True
        attempt = 0
        while attempt < max_retries and self.running:
            attempt += 1
            self.results.append({"attempt": attempt, "task": task, "status": "running"})
        self.running = False
        return {"status": "completed", "attempts": attempt, "results": self.results}

    def abort(self):
        self.running = False
        return {"status": "aborted"}

    def get_status(self):
        return {"running": self.running, "total_results": len(self.results)}
