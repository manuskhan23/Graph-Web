/**
 * Schema migrations. Append-only: never edit a shipped migration, add a new one.
 * Version is tracked in `schema_migrations` so upgrades are idempotent.
 */
import type { SqlDriver } from './driver.js';

export interface Migration {
  version: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'core_schema',
    up: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_indexed_at INTEGER,
      index_version INTEGER NOT NULL DEFAULT 0,
      ignored_globs TEXT NOT NULL DEFAULT '[]',
      settings TEXT NOT NULL DEFAULT '{}'
    );
    CREATE UNIQUE INDEX idx_projects_root ON projects(root_path);

    CREATE TABLE project_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'unknown',
      size INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL,
      lines INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_project_files_unique ON project_files(project_id, rel_path);
    CREATE INDEX idx_project_files_lang ON project_files(project_id, language);

    CREATE TABLE file_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      tokens TEXT NOT NULL,
      hash TEXT NOT NULL
    );
    CREATE INDEX idx_chunks_project ON file_chunks(project_id);
    CREATE INDEX idx_chunks_path ON file_chunks(project_id, rel_path);

    CREATE TABLE embeddings (
      chunk_id INTEGER PRIMARY KEY REFERENCES file_chunks(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      vector BLOB NOT NULL,
      dim INTEGER NOT NULL,
      model TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE index_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      added INTEGER NOT NULL DEFAULT 0,
      modified INTEGER NOT NULL DEFAULT 0,
      removed INTEGER NOT NULL DEFAULT 0,
      unchanged INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      index_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      error TEXT
    );

    CREATE TABLE conversations (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      provider TEXT,
      model TEXT,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      attachments TEXT NOT NULL DEFAULT '[]',
      tokens INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      conversation_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      agent_role TEXT NOT NULL DEFAULT 'planning',
      plan TEXT NOT NULL DEFAULT '[]',
      current_step_id TEXT,
      progress REAL NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER,
      error TEXT,
      checkpoint TEXT NOT NULL DEFAULT '{}',
      result TEXT
    );
    CREATE INDEX idx_tasks_status ON tasks(status, created_at);

    CREATE TABLE tool_executions (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      project_id TEXT,
      tool_id TEXT NOT NULL,
      tool_input TEXT NOT NULL DEFAULT '{}',
      output TEXT,
      status TEXT NOT NULL,
      risk TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_tool_exec_created ON tool_executions(created_at);
    CREATE INDEX idx_tool_exec_task ON tool_executions(task_id);

    CREATE TABLE approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      risk TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      resolved_by TEXT
    );
    CREATE INDEX idx_approvals_status ON approvals(status, created_at);

    CREATE TABLE file_snapshots (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      operation_id TEXT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      blob_path TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_snapshots_project ON file_snapshots(project_id, created_at);

    CREATE TABLE snapshot_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id TEXT NOT NULL REFERENCES file_snapshots(id) ON DELETE CASCADE,
      rel_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      existed INTEGER NOT NULL DEFAULT 1,
      blob_path TEXT,
      content TEXT
    );
    CREATE INDEX idx_snapshot_files ON snapshot_files(snapshot_id);

    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      revisions TEXT NOT NULL DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'user'
    );
    CREATE INDEX idx_memories_project ON memories(project_id, category);

    CREATE TABLE agents (
      role TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      allowed_tools TEXT NOT NULL DEFAULT '[]',
      may_write_files INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      blocks TEXT NOT NULL DEFAULT '[]',
      entry TEXT,
      is_template INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE workflow_executions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      project_id TEXT,
      status TEXT NOT NULL,
      cursor TEXT,
      log TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      error TEXT
    );

    CREATE TABLE activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      kind TEXT NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      project_id TEXT,
      task_id TEXT,
      provider TEXT,
      status TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX idx_activity_at ON activity_logs(at DESC);

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      at INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      level TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE provider_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      tokens_source TEXT NOT NULL,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      ok INTEGER NOT NULL,
      error_class TEXT,
      cost_usd REAL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_usage_created ON provider_usage(created_at);

    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      allowed INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX idx_audit_at ON audit_log(at DESC);

    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      reference_id TEXT,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    `,
  },
  {
    version: 2,
    name: 'search_indexes',
    up: `
    CREATE INDEX idx_files_project_hash ON project_files(project_id, hash);
    CREATE INDEX idx_chunks_hash ON file_chunks(project_id, hash);
    CREATE INDEX idx_memories_content ON memories(category);
    CREATE INDEX idx_tasks_project ON tasks(project_id, created_at DESC);
    CREATE INDEX idx_usage_provider ON provider_usage(provider, created_at DESC);
    `,
  },
];

export function runMigrations(db: SqlDriver): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const applied = new Set(
    db.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version),
  );
  let count = 0;
  for (const m of MIGRATIONS) {
    if (applied.has(m.version)) continue;
    db.transaction(() => {
      db.exec(m.up);
      db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', [
        m.version,
        m.name,
        Date.now(),
      ]);
    });
    count += 1;
  }
  return count;
}

export function currentVersion(db: SqlDriver): number {
  const row = db.get<{ v: number | null }>('SELECT MAX(version) AS v FROM schema_migrations');
  return Number(row?.v ?? 0);
}
