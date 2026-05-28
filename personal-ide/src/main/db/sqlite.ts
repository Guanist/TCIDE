/**
 * PersonalIDE - SQLite via sql.js (pure JS, no native compilation)
 */
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';

let db: Database | null = null;
let dbPath: string = '';

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData');
  dbPath = path.join(userDataPath, 'personal-ide.db');

  // 生产环境（asar 打包），wasm 文件在 extraResources 中
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'sql-wasm.wasm')
    : undefined;

  const SQL = wasmPath ? await initSqlJs({ locateFile: () => wasmPath }) : await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
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

export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

export function queryDb(sql: string, params?: unknown[]): unknown[] {
  if (!db) return [];
  try {
    const stmt = db.prepare(sql);
    if (params && params.length > 0) stmt.bind(params);
    const rows: unknown[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      rows.push(row);
    }
    stmt.free();
    return rows;
  } catch (err) {
    console.error('[DB] Query error:', err);
    return [];
  }
}

export function runDb(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number } {
  if (!db) return { changes: 0, lastInsertRowid: 0 };
  try {
    if (params && params.length > 0) {
      db.run(sql, params);
    } else {
      db.run(sql);
    }
    const changes = db.getRowsModified();
    const result = db.exec('SELECT last_insert_rowid() as id');
    const lastId = result.length > 0 && result[0].values.length > 0 ? Number(result[0].values[0][0]) : 0;
    saveDatabase();
    return { changes, lastInsertRowid: lastId };
  } catch (err) {
    console.error('[DB] Run error:', err);
    return { changes: 0, lastInsertRowid: 0 };
  }
}

export function closeDatabase(): void {
  if (db) {
    saveDatabase();
    db.close();
    db = null;
  }
}

// ─────────────────────────────────────────
// Token 用量写入（由 IPC 调用）
// ─────────────────────────────────────────
export interface UsageRecord {
  timestamp: number;
  projectPath: string;
  projectName: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  costRmb: number;
  durationMs: number;
  sessionId: string;
  taskId: string;
  role: string;
}

export function insertUsage(rec: UsageRecord): void {
  if (!db) return;
  db.run(
    `INSERT INTO token_usage
      (timestamp, project_path, project_name, model, provider,
       input_tokens, output_tokens, cost_rmb, duration_ms,
       session_id, task_id, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
    ]
  );
  const count = db.getRowsModified();
  if (count % 10 === 0) saveDatabase();
}

// ─────────────────────────────────────────
// 用量查询（由 IPC 调用，直接传 SQL）
// ─────────────────────────────────────────
export function queryUsage(sql: string, params: unknown[] = []): unknown[] {
  return queryDb(sql, params);
}

// ─────────────────────────────────────────
// 文件快照（.ide-snapshots）
// ─────────────────────────────────────────
export function saveSnapshot(projectPath: string, taskId: string, filePath: string, content: string): void {
  if (!db) return;
  db.run(
    `INSERT INTO file_snapshots (project_path, task_id, file_path, content, timestamp) VALUES (?, ?, ?, ?, ?)`,
    [projectPath, taskId, filePath, content, Date.now()]
  );
  saveDatabase();
}

export function getSnapshots(projectPath: string, filePath: string): Array<{ id: number; taskId: string; content: string; timestamp: number }> {
  return queryDb(
    `SELECT id, task_id AS taskId, content, timestamp FROM file_snapshots WHERE project_path = ? AND file_path = ? AND restored = 0 ORDER BY timestamp DESC`,
    [projectPath, filePath]
  ) as Array<{ id: number; taskId: string; content: string; timestamp: number }>;
}

export function markSnapshotRestored(id: number): void {
  if (!db) return;
  db.run(`UPDATE file_snapshots SET restored = 1 WHERE id = ?`, [id]);
  saveDatabase();
}

// ─────────────────────────────────────────
// 任务会话（断点续做）
// ─────────────────────────────────────────
export function saveTaskSession(projectPath: string, tasksJson: string, currentIndex: number): void {
  if (!db) return;
  db.run(
    `INSERT OR REPLACE INTO task_sessions (project_path, tasks_json, current_index, status, updated_at) VALUES (?, ?, ?, 'active', ?)`,
    [projectPath, tasksJson, currentIndex, Date.now()]
  );
  saveDatabase();
}

export function getTaskSession(projectPath: string): { tasksJson: string; currentIndex: number; updatedAt: number } | null {
  const rows = queryDb(
    `SELECT tasks_json AS tasksJson, current_index AS currentIndex, updated_at AS updatedAt FROM task_sessions WHERE project_path = ? AND status = 'active'`,
    [projectPath]
  ) as Array<{ tasksJson: string; currentIndex: number; updatedAt: number }>;
  return rows.length > 0 ? rows[0] : null;
}

export function clearTaskSession(projectPath: string): void {
  if (!db) return;
  db.run(`DELETE FROM task_sessions WHERE project_path = ?`, [projectPath]);
  saveDatabase();
}
