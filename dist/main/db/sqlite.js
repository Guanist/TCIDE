"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDatabase = initDatabase;
exports.saveDatabase = saveDatabase;
exports.queryDb = queryDb;
exports.runDb = runDb;
exports.closeDatabase = closeDatabase;
exports.insertUsage = insertUsage;
exports.queryUsage = queryUsage;
exports.saveSnapshot = saveSnapshot;
exports.getSnapshots = getSnapshots;
exports.markSnapshotRestored = markSnapshotRestored;
exports.saveTaskSession = saveTaskSession;
exports.getTaskSession = getTaskSession;
exports.clearTaskSession = clearTaskSession;
/**
 * PersonalIDE - SQLite via sql.js (pure JS, no native compilation)
 */
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
const sql_js_1 = __importDefault(require("sql.js"));
let db = null;
let dbPath = '';
async function initDatabase() {
    const userDataPath = electron_1.app.getPath('userData');
    dbPath = path.join(userDataPath, 'personal-ide.db');
    // 生产环境（asar 打包），wasm 文件在 extraResources 中
    const wasmPath = electron_1.app.isPackaged
        ? path.join(process.resourcesPath, 'sql-wasm.wasm')
        : undefined;
    const SQL = wasmPath ? await (0, sql_js_1.default)({ locateFile: () => wasmPath }) : await (0, sql_js_1.default)();
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    }
    else {
        db = new SQL.Database();
    }
    db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      dependencies TEXT,
      files TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
    db.run(`
    CREATE TABLE IF NOT EXISTS symbol_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      symbol_name TEXT NOT NULL,
      symbol_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      line_number INTEGER,
      UNIQUE(project_path, file_path, symbol_name)
    )
  `);
    // ── Token 用量追踪表 ──
    db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp     INTEGER NOT NULL,
      project_path  TEXT    NOT NULL DEFAULT '',
      project_name  TEXT    NOT NULL DEFAULT '',
      model         TEXT    NOT NULL,
      provider      TEXT    NOT NULL DEFAULT '',
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cost_rmb      REAL    NOT NULL DEFAULT 0,
      duration_ms    INTEGER NOT NULL DEFAULT 0,
      session_id    TEXT    NOT NULL DEFAULT '',
      task_id       TEXT    NOT NULL DEFAULT '',
      role          TEXT    NOT NULL DEFAULT 'chat'
    )
  `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON token_usage(timestamp)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_usage_project  ON token_usage(project_path)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_usage_session  ON token_usage(session_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_path)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_path)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_symbols_project ON symbol_index(project_path)`);
    // ── 文件快照表（.ide-snapshots 替代） ──
    db.run(`
    CREATE TABLE IF NOT EXISTS file_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL,
      task_id TEXT NOT NULL DEFAULT '',
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      restored INTEGER NOT NULL DEFAULT 0
    )
  `);
    db.run(`CREATE INDEX IF NOT EXISTS idx_snapshots_project ON file_snapshots(project_path, file_path)`);
    // ── 任务状态快照（断点续做） ──
    db.run(`
    CREATE TABLE IF NOT EXISTS task_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_path TEXT NOT NULL UNIQUE,
      tasks_json TEXT NOT NULL,
      current_index INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      updated_at INTEGER NOT NULL
    )
  `);
    saveDatabase();
}
function saveDatabase() {
    if (!db)
        return;
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}
function queryDb(sql, params) {
    if (!db)
        return [];
    try {
        const stmt = db.prepare(sql);
        if (params && params.length > 0)
            stmt.bind(params);
        const rows = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            rows.push(row);
        }
        stmt.free();
        return rows;
    }
    catch (err) {
        console.error('[DB] Query error:', err);
        return [];
    }
}
function runDb(sql, params) {
    if (!db)
        return { changes: 0, lastInsertRowid: 0 };
    try {
        if (params && params.length > 0) {
            db.run(sql, params);
        }
        else {
            db.run(sql);
        }
        const changes = db.getRowsModified();
        const result = db.exec('SELECT last_insert_rowid() as id');
        const lastId = result.length > 0 && result[0].values.length > 0 ? Number(result[0].values[0][0]) : 0;
        saveDatabase();
        return { changes, lastInsertRowid: lastId };
    }
    catch (err) {
        console.error('[DB] Run error:', err);
        return { changes: 0, lastInsertRowid: 0 };
    }
}
function closeDatabase() {
    if (db) {
        saveDatabase();
        db.close();
        db = null;
    }
}
function insertUsage(rec) {
    if (!db)
        return;
    db.run(`INSERT INTO token_usage
      (timestamp, project_path, project_name, model, provider,
       input_tokens, output_tokens, cost_rmb, duration_ms,
       session_id, task_id, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        rec.timestamp,
        rec.projectPath,
        rec.projectName,
        rec.model,
        rec.provider,
        rec.inputTokens,
        rec.outputTokens,
        rec.costRmb,
        rec.durationMs,
        rec.sessionId,
        rec.taskId,
        rec.role,
    ]);
    const count = db.getRowsModified();
    if (count % 10 === 0)
        saveDatabase();
}
// ─────────────────────────────────────────
// 用量查询（由 IPC 调用，直接传 SQL）
// ─────────────────────────────────────────
function queryUsage(sql, params = []) {
    return queryDb(sql, params);
}
// ─────────────────────────────────────────
// 文件快照（.ide-snapshots）
// ─────────────────────────────────────────
function saveSnapshot(projectPath, taskId, filePath, content) {
    if (!db)
        return;
    db.run(`INSERT INTO file_snapshots (project_path, task_id, file_path, content, timestamp) VALUES (?, ?, ?, ?, ?)`, [projectPath, taskId, filePath, content, Date.now()]);
    saveDatabase();
}
function getSnapshots(projectPath, filePath) {
    return queryDb(`SELECT id, task_id AS taskId, content, timestamp FROM file_snapshots WHERE project_path = ? AND file_path = ? AND restored = 0 ORDER BY timestamp DESC`, [projectPath, filePath]);
}
function markSnapshotRestored(id) {
    if (!db)
        return;
    db.run(`UPDATE file_snapshots SET restored = 1 WHERE id = ?`, [id]);
    saveDatabase();
}
// ─────────────────────────────────────────
// 任务会话（断点续做）
// ─────────────────────────────────────────
function saveTaskSession(projectPath, tasksJson, currentIndex) {
    if (!db)
        return;
    db.run(`INSERT OR REPLACE INTO task_sessions (project_path, tasks_json, current_index, status, updated_at) VALUES (?, ?, ?, 'active', ?)`, [projectPath, tasksJson, currentIndex, Date.now()]);
    saveDatabase();
}
function getTaskSession(projectPath) {
    const rows = queryDb(`SELECT tasks_json AS tasksJson, current_index AS currentIndex, updated_at AS updatedAt FROM task_sessions WHERE project_path = ? AND status = 'active'`, [projectPath]);
    return rows.length > 0 ? rows[0] : null;
}
function clearTaskSession(projectPath) {
    if (!db)
        return;
    db.run(`DELETE FROM task_sessions WHERE project_path = ?`, [projectPath]);
    saveDatabase();
}
