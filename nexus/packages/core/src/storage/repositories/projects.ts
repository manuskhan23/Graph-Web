import type { Project, ProjectFileRecord, ScanResult } from '../../types.js';
import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';

export interface IndexedFileInput {
  relPath: string;
  language: string;
  size: number;
  hash: string;
  lines: number;
}

export class ProjectsRepository {
  constructor(private readonly db: SqlDriver) {}

  private rowToProject(row: SqlRow): Project {
    return {
      id: String(row.id),
      name: String(row.name),
      rootPath: String(row.root_path),
      description: String(row.description ?? ''),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      lastIndexedAt: row.last_indexed_at === null ? null : Number(row.last_indexed_at),
      indexVersion: Number(row.index_version ?? 0),
      ignoredGlobs: parseJson<string[]>(row.ignored_globs, []),
      settings: parseJson<Record<string, unknown>>(row.settings, {}),
    };
  }

  list(): Project[] {
    return this.db.all('SELECT * FROM projects ORDER BY updated_at DESC').map((r) => this.rowToProject(r));
  }

  get(projectId: string): Project | null {
    const row = this.db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
    return row ? this.rowToProject(row) : null;
  }

  findByRoot(rootPath: string): Project | null {
    const row = this.db.get('SELECT * FROM projects WHERE root_path = ?', [rootPath]);
    return row ? this.rowToProject(row) : null;
  }

  create(input: {
    name: string;
    rootPath: string;
    description?: string;
    ignoredGlobs?: string[];
    settings?: Record<string, unknown>;
  }): Project {
    const projectId = id('prj');
    const ts = now();
    this.db.run(
      `INSERT INTO projects (id, name, root_path, description, created_at, updated_at, ignored_globs, settings)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        input.name,
        input.rootPath,
        input.description ?? '',
        ts,
        ts,
        JSON.stringify(input.ignoredGlobs ?? []),
        JSON.stringify(input.settings ?? {}),
      ],
    );
    return this.get(projectId)!;
  }

  update(
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'ignoredGlobs' | 'settings' | 'lastIndexedAt' | 'indexVersion'>>,
  ): Project | null {
    const current = this.get(projectId);
    if (!current) return null;
    this.db.run(
      `UPDATE projects SET name = ?, description = ?, ignored_globs = ?, settings = ?,
        last_indexed_at = ?, index_version = ?, updated_at = ? WHERE id = ?`,
      [
        patch.name ?? current.name,
        patch.description ?? current.description,
        JSON.stringify(patch.ignoredGlobs ?? current.ignoredGlobs),
        JSON.stringify(patch.settings ?? current.settings),
        patch.lastIndexedAt === undefined ? current.lastIndexedAt : patch.lastIndexedAt,
        patch.indexVersion ?? current.indexVersion,
        now(),
        projectId,
      ],
    );
    return this.get(projectId);
  }

  remove(projectId: string): boolean {
    const res = this.db.run('DELETE FROM projects WHERE id = ?', [projectId]);
    return res.changes > 0;
  }

  /* ----------------------------------------------------------- file index */

  files(projectId: string): ProjectFileRecord[] {
    return this.db
      .all(
        `SELECT id, project_id, rel_path, language, size, hash, lines, indexed_at
         FROM project_files WHERE project_id = ? ORDER BY rel_path`,
        [projectId],
      )
      .map((r) => ({
        id: Number(r.id),
        projectId: String(r.project_id),
        relPath: String(r.rel_path),
        language: String(r.language),
        size: Number(r.size),
        hash: String(r.hash),
        lines: Number(r.lines),
        indexedAt: Number(r.indexed_at),
      }));
  }

  filesByPath(projectId: string): Map<string, ProjectFileRecord> {
    const map = new Map<string, ProjectFileRecord>();
    for (const f of this.files(projectId)) map.set(f.relPath, f);
    return map;
  }

  getFile(projectId: string, relPath: string): ProjectFileRecord | null {
    const row = this.db.get('SELECT * FROM project_files WHERE project_id = ? AND rel_path = ?', [
      projectId,
      relPath,
    ]);
    if (!row) return null;
    return {
      id: Number(row.id),
      projectId,
      relPath,
      language: String(row.language),
      size: Number(row.size),
      hash: String(row.hash),
      lines: Number(row.lines),
      indexedAt: Number(row.indexed_at),
    };
  }

  upsertFile(projectId: string, file: IndexedFileInput): void {
    this.db.run(
      `INSERT INTO project_files (project_id, rel_path, language, size, hash, lines, indexed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, rel_path) DO UPDATE SET
         language = excluded.language, size = excluded.size, hash = excluded.hash,
         lines = excluded.lines, indexed_at = excluded.indexed_at`,
      [projectId, file.relPath, file.language, file.size, file.hash, file.lines, now()],
    );
  }

  deleteFile(projectId: string, relPath: string): void {
    this.db.run('DELETE FROM project_files WHERE project_id = ? AND rel_path = ?', [projectId, relPath]);
    this.db.run('DELETE FROM file_chunks WHERE project_id = ? AND rel_path = ?', [projectId, relPath]);
  }

  countFiles(projectId: string): number {
    const row = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM project_files WHERE project_id = ?', [
      projectId,
    ]);
    return Number(row?.c ?? 0);
  }

  /* ------------------------------------------------------------- chunks */

  replaceChunks(
    projectId: string,
    relPath: string,
    chunks: { startLine: number; endLine: number; content: string; tokens: string; hash: string }[],
  ): void {
    this.db.transaction(() => {
      this.db.run(
        'DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM file_chunks WHERE project_id = ? AND rel_path = ?)',
        [projectId, relPath],
      );
      this.db.run('DELETE FROM file_chunks WHERE project_id = ? AND rel_path = ?', [projectId, relPath]);
      for (const c of chunks) {
        this.db.run(
          `INSERT INTO file_chunks (project_id, rel_path, start_line, end_line, content, tokens, hash)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [projectId, relPath, c.startLine, c.endLine, c.content, c.tokens, c.hash],
        );
      }
    });
  }

  chunks(projectId: string): {
    id: number;
    relPath: string;
    startLine: number;
    endLine: number;
    content: string;
    tokens: string;
    hash: string;
  }[] {
    return this.db
      .all<SqlRow>(
        `SELECT id, rel_path, start_line, end_line, content, tokens, hash
         FROM file_chunks WHERE project_id = ? ORDER BY rel_path, start_line`,
        [projectId],
      )
      .map((r) => ({
        id: Number(r.id),
        relPath: String(r.rel_path),
        startLine: Number(r.start_line),
        endLine: Number(r.end_line),
        content: String(r.content),
        tokens: String(r.tokens),
        hash: String(r.hash),
      }));
  }

  /* --------------------------------------------------------- index runs */

  startIndexRun(projectId: string, indexVersion: number): string {
    const runId = id('idx');
    this.db.run(
      `INSERT INTO index_runs (id, project_id, started_at, index_version, status)
       VALUES (?, ?, ?, ?, 'running')`,
      [runId, projectId, now(), indexVersion],
    );
    return runId;
  }

  finishIndexRun(runId: string, result: Omit<ScanResult, 'projectId' | 'durationMs'> & { error?: string }): void {
    this.db.run(
      `UPDATE index_runs SET finished_at = ?, added = ?, modified = ?, removed = ?, unchanged = ?,
        skipped = ?, index_version = ?, status = ?, error = ? WHERE id = ?`,
      [
        now(),
        result.added,
        result.modified,
        result.removed,
        result.unchanged,
        result.skipped,
        result.indexVersion,
        result.error ? 'failed' : 'completed',
        result.error ?? null,
        runId,
      ],
    );
  }

  recentIndexRuns(projectId: string, limit = 10) {
    return this.db.all<SqlRow>(
      'SELECT * FROM index_runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
      [projectId, limit],
    );
  }
}
