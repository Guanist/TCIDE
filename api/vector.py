"""
向量搜索 API
TF-IDF + BM25 语义搜索，零外部依赖
"""
import hashlib
import json
import math
import os
import re
import time
from pathlib import Path

SKIP_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv",
             ".idea", ".vscode", "target", "out", ".tcide"}
INDEX_EXTENSIONS = {
    ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".py", ".pyw", ".go", ".rs",
    ".java", ".kt", ".kts", ".swift", ".c", ".cpp", ".cc", ".h", ".hpp", ".vue", ".svelte",
    ".cs", ".rb", ".php", ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
}

_project_root = ""
_index_path = ""
_documents = {}      # docId -> {type, file, symbol, text, tokens}
_inverted_index = {}  # token -> [{docId, tf, positions}]
_idf_values = {}      # token -> idf
_file_hashes = {}     # filePath -> hash
_doc_count = 0
_is_indexing = False

def init_index(project_path: str) -> dict:
    """初始化索引目录"""
    global _project_root, _index_path, _documents, _inverted_index, _file_hashes, _doc_count
    _project_root = os.path.abspath(project_path)
    _index_dir = os.path.join(_project_root, ".tcide", "index")
    os.makedirs(_index_dir, exist_ok=True)
    _index_path = os.path.join(_index_dir, "vector.json")
    _load_index()
    return {"success": True, "docCount": len(_documents), "indexPath": _index_path}

def _load_index():
    """加载已有索引"""
    global _documents, _inverted_index, _file_hashes, _doc_count
    if not _index_path or not os.path.exists(_index_path):
        return
    try:
        with open(_index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("version") != 1:
            return
        _documents = {k: v for k, v in data.get("documents", [])}
        _inverted_index = {k: v for k, v in data.get("invertedIndex", [])}
        _file_hashes = {k: v for k, v in data.get("fileHashes", [])}
        _doc_count = data.get("docCount", len(_documents))
        _compute_idf()
    except Exception:
        _documents, _inverted_index, _file_hashes, _doc_count = {}, {}, {}, 0

def _save_index():
    """持久化索引"""
    if not _index_path:
        return
    try:
        data = {
            "version": 1, "updatedAt": int(time.time() * 1000),
            "projectRoot": _project_root, "docCount": _doc_count,
            "documents": list(_documents.items()),
            "invertedIndex": list(_inverted_index.items()),
            "fileHashes": list(_file_hashes.items()),
        }
        with open(_index_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
    except Exception:
        pass

def index_all() -> dict:
    """索引所有文件"""
    global _is_indexing, _doc_count
    if _is_indexing:
        return {"indexed": 0, "skipped": 0, "error": "Already indexing"}
    _is_indexing = True
    try:
        files = _collect_files()
        indexed, skipped = 0, 0
        for fp in files:
            file_hash = _hash_file(fp)
            if _file_hashes.get(fp) == file_hash:
                skipped += 1
                continue
            try:
                _remove_file_docs(fp)
                docs = _parse_file(fp)
                for doc in docs:
                    doc_id = f"doc_{_doc_count}"
                    _doc_count += 1
                    _documents[doc_id] = doc
                    _index_doc(doc_id, doc)
                _file_hashes[fp] = file_hash
                indexed += 1
            except Exception:
                pass
        _compute_idf()
        _save_index()
        return {"indexed": indexed, "skipped": skipped, "total": len(_documents)}
    finally:
        _is_indexing = False

def search(query: str, options: dict = None) -> dict:
    """BM25 语义搜索"""
    opts = options or {}
    top_k = opts.get("topK", 20)
    filter_type = opts.get("filterType")
    min_score = opts.get("minScore", 0.1)
    query_tokens = _tokenize(query)
    if not query_tokens:
        return {"results": [], "total": 0}

    scores = {}
    avg_len = _avg_doc_length()
    k1, b = 1.2, 0.75

    for token in query_tokens:
        idf = _idf_values.get(token, 0)
        if idf <= 0:
            continue
        postings = _inverted_index.get(token, [])
        for p in postings:
            doc = _documents.get(p["docId"])
            if not doc:
                continue
            if filter_type and doc.get("type") != filter_type:
                continue
            tf = p.get("tf", 1)
            doc_len = len(doc.get("tokens", []))
            bm25 = idf * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc_len / max(avg_len, 1)))
            scores[p["docId"]] = scores.get(p["docId"], 0) + bm25

    ranked = sorted(scores.items(), key=lambda x: -x[1])[:top_k]
    results = []
    for doc_id, score in ranked:
        if score < min_score:
            continue
        doc = _documents.get(doc_id, {})
        text = doc.get("text", "")
        if len(text) > 200:
            text = text[:200] + "..."
        results.append({
            "docId": doc_id, "type": doc.get("type"), "file": doc.get("file"),
            "symbol": doc.get("symbol"), "text": text, "score": round(score, 4),
        })
    return {"results": results, "total": len(results)}

def get_stats() -> dict:
    """索引统计"""
    type_counts = {}
    lang_counts = {}
    for doc in _documents.values():
        t = doc.get("type", "unknown")
        type_counts[t] = type_counts.get(t, 0) + 1
        lang = doc.get("language", "")
        if lang:
            lang_counts[lang] = lang_counts.get(lang, 0) + 1
    return {
        "docCount": len(_documents), "fileCount": len(_file_hashes),
        "tokenCount": len(_inverted_index), "byType": type_counts,
        "byLanguage": lang_counts, "isIndexing": _is_indexing,
    }

# ── 内部工具函数 ──

def _collect_files() -> list:
    """收集所有可索引文件"""
    files = []
    for dirpath, dirnames, filenames in os.walk(_project_root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for f in filenames:
            ext = os.path.splitext(f)[1].lower()
            if ext in INDEX_EXTENSIONS:
                files.append(os.path.join(dirpath, f))
    return files

def _parse_file(fp: str) -> list:
    """解析文件为文档"""
    try:
        rel = os.path.relpath(fp, _project_root).replace("\\", "/")
        ext = os.path.splitext(fp)[1].lower()
        lang_map = {".py": "python", ".js": "javascript", ".ts": "typescript",
                    ".go": "go", ".rs": "rust", ".java": "java"}
        lang = lang_map.get(ext, "")
        text = Path(fp).read_text(encoding="utf-8", errors="replace")
        tokens = _tokenize(text)
        docs = [{"type": "file", "file": rel, "symbol": os.path.basename(fp), "text": text[:2000], "tokens": tokens, "language": lang}]
        # 提取符号
        symbol_patterns = {
            "python": [r"(?:class|def|async\s+def)\s+(\w+)", r"^(\w+)\s*="],
            "javascript": [r"(?:class|function|const|let|var)\s+(\w+)", r"export\s+(?:default\s+)?(?:class|function|const)\s+(\w+)"],
            "typescript": [r"(?:class|interface|type|function|const|let)\s+(\w+)", r"export\s+(?:default\s+)?(?:class|interface|type|function|const)\s+(\w+)"],
        }
        patterns = symbol_patterns.get(lang, [])
        for pat in patterns:
            for match in re.finditer(pat, text, re.MULTILINE):
                sym_name = match.group(1)
                start = max(0, match.start() - 50)
                end = min(len(text), match.end() + 200)
                sym_text = text[start:end]
                sym_tokens = _tokenize(sym_text)
                docs.append({"type": "symbol", "file": rel, "symbol": sym_name, "text": sym_text, "tokens": sym_tokens, "language": lang})
        return docs
    except Exception:
        return []

def _index_doc(doc_id: str, doc: dict):
    """索引单个文档"""
    tf_map = {}
    for i, token in enumerate(doc.get("tokens", [])):
        if token not in tf_map:
            tf_map[token] = {"count": 0, "positions": []}
        tf_map[token]["count"] += 1
        tf_map[token]["positions"].append(i)
    for token, info in tf_map.items():
        if token not in _inverted_index:
            _inverted_index[token] = []
        _inverted_index[token].append({"docId": doc_id, "tf": info["count"], "positions": info["positions"]})

def _remove_file_docs(file_path: str):
    """移除文件的所有文档"""
    to_remove = [doc_id for doc_id, doc in _documents.items() if doc.get("file") == file_path]
    for doc_id in to_remove:
        _documents.pop(doc_id, None)
    for token in list(_inverted_index.keys()):
        _inverted_index[token] = [p for p in _inverted_index[token] if p["docId"] not in to_remove]

def _compute_idf():
    """计算 IDF"""
    _idf_values.clear()
    n = len(_documents)
    for token, postings in _inverted_index.items():
        _idf_values[token] = math.log(1 + (n - len(postings) + 0.5) / (len(postings) + 0.5))

def _avg_doc_length() -> float:
    """平均文档长度"""
    total, count = 0, 0
    for doc in _documents.values():
        tokens = doc.get("tokens", [])
        if tokens:
            total += len(tokens)
            count += 1
    return total / count if count > 0 else 10

def _tokenize(text: str) -> list:
    """分词：camelCase 拆分 + 去停用词"""
    if not text:
        return []
    processed = text.lower()
    processed = re.sub(r"([a-z])([A-Z])", r"\1 \2", processed)
    processed = re.sub(r"[_\-./]", " ", processed)
    processed = re.sub(r"[^a-z0-9\u4e00-\u9fff\s]", " ", processed)
    processed = re.sub(r"\s+", " ", processed).strip()
    tokens = [t for t in processed.split() if len(t) > 1]
    # bigrams
    bigrams = [f"{tokens[i]}_{tokens[i+1]}" for i in range(len(tokens) - 1)]
    return tokens + bigrams

def _hash_file(fp: str) -> str:
    """文件内容哈希"""
    try:
        return hashlib.md5(Path(fp).read_bytes()).hexdigest()
    except Exception:
        return "00000000"
