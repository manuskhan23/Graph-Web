import type { SqlDriver, SqlRow } from '../driver.js';
import { id, now, parseJson } from '../driver.js';

export interface SnapshotRecord {
  id: string;
  projectId: string;
  operationId: string | null;
  kind: 'pre-change' | 'manual' | 'scheduled';
  label: string;
  createdAt: number;
  hash: string;
  size: number;
  metadata: Record<string, unknown>;
}

export interface SnapshotFileRecord {
  id: number;
  snapshotId: string;
  relPath: string;
  hash: string;
  existed: boolean;
  blobPath: string | null;
  /** Inline content for small files; large files live in blob_path. */
  content: string | null;
}

export class SnapshotsRepository {
  constructor(private readonly db: SqlDriver) {}

  private map(row: SqlRow): SnapshotRecord {
    return {
      id: String(row.id),
      projectId: String(row.project_id),
      operationId: row.operation_id === null ? null : String(row.operation_id),
      kind: String(row.kind) as SnapshotRecord['kind'],
      label: String(row.label),
      createdAt: Number(row.created_at),
      hash: String(row.hash),
      size: Number(row.size),
      metadata: parseJson<Record<string, unknown>>(row.metadata, {}),
    };
  }

  create(input: {
    projectId: string;
    operationId: string | null;
    kind: SnapshotRecord['kind'];
    label: string;
    hash: string;
    size: number;
    metadata?: Record<string, unknown>;
    files: { relPath: string; hash: string; existed: boolean; blobPath: string | null; content: string | null }[];
  }): SnapshotRecord {
    const snapshotId = id('snap');
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO file_snapshots (id, project_id, operation_id, kind, label, created_at, hash, size, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId,
          input.projectId,
          input.operationId,
          input.kind,
          input.label,
          now(),
          input.hash,
          input.size,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      for (const f of input.files) {
        this.db.run(
          `INSERT INTO snapshot_files (snapshot_id, rel_path, hash, existed, blob_path, content)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [snapshotId, f.relPath, f.hash, f.existed ? 1 : 0, f.blobPath, f.content],
        );
      }
    });
    return this.get(snapshotId)!;
  }

  get(snapshotId: string): SnapshotRecord | null {
    const row = this.db.get('SELECT * FROM file_snapshots WHERE id = ?', [snapshotId]);
    return row ? this.map(row) : null;
  }

  list(projectId: string, limit = 100): SnapshotRecord[] {
    return this.db
      .all('SELECT * FROM file_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', [
        projectId,
        limit,
      ])
      .map((r) => this.map(r));
  }

  files(snapshotId: string): SnapshotFileRecord[] {
    return this.db.all('SELECT * FROM snapshot_files WHERE snapshot_id = ?', [snapshotId]).map((r) => ({
      id: Number(r.id),
      snapshotId: String(r.snapshot_id),
      relPath: String(r.rel_path),
      hash: String(r.hash),
      existed: Number(r.existed) === 1,
      blobPath: r.blob_path === null ? null : String(r.blob_path),
      content: r.content === null ? null : String(r.content),
    }));
  }

  findByOperation(operationId: string): SnapshotRecord | null {
    const row = this.db.get('SELECT * FROM file_snapshots WHERE operation_id = ? ORDER BY created_at DESC LIMIT 1', [
      operationId,
    ]);
    return row ? this.map(row) : null;
  }

  /** Retention: drop snapshots older than `days`, returning blob paths to remove. */
  expire(days: number): { snapshots: number; blobs: string[] } {
    const cutoff = now() - days * 86_400_000;
    const old = this.db.all<SqlRow>('SELECT id FROM file_snapshots WHERE created_at < ?', [cutoff]);
    const blobs: string[] = [];
    for (const row of old) {
      for (const f of this.files(String(row.id))) if (f.blobPath) blobs.push(f.blobPath);
    }
    if (old.length) {
      this.db.run('DELETE FROM file_snapshots WHERE created_at < ?', [cutoff]);
    }
    return { snapshots: old.length, blobs };
  }

  count(projectId?: string): number {
    const row = projectId
      ? this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM file_snapshots WHERE project_id = ?', [projectId])
      : this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM file_snapshots');
    return Number(row?.c ?? 0);
  }
}
