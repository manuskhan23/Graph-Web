import type { SqlDriver, SqlRow } from '../driver.js';
import { id, now, parseJson } from '../driver.js';
import type { SnapshotFileRecord, SnapshotRecord, SnapshotStore } from '../contracts.js';
export type { SnapshotFileRecord, SnapshotRecord } from '../contracts.js';

export class SqliteSnapshotStore implements SnapshotStore {
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

  async create(input: {
    projectId: string;
    operationId: string | null;
    kind: SnapshotRecord['kind'];
    label: string;
    hash: string;
    size: number;
    metadata?: Record<string, unknown>;
    files: { relPath: string; hash: string; existed: boolean; blobPath: string | null; content: string | null }[];
  }): Promise<SnapshotRecord> {
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
    return (await this.get(snapshotId))!;
  }

  async get(snapshotId: string): Promise<SnapshotRecord | null> {
    const row = this.db.get('SELECT * FROM file_snapshots WHERE id = ?', [snapshotId]);
    return row ? this.map(row) : null;
  }

  async list(projectId: string, limit = 100): Promise<SnapshotRecord[]> {
    return this.db
      .all('SELECT * FROM file_snapshots WHERE project_id = ? ORDER BY created_at DESC LIMIT ?', [
        projectId,
        limit,
      ])
      .map((r) => this.map(r));
  }

  async files(snapshotId: string): Promise<SnapshotFileRecord[]> {
    return this.db.all('SELECT * FROM snapshot_files WHERE snapshot_id = ?', [snapshotId]).map((r) => ({
      id: String(r.id),
      snapshotId: String(r.snapshot_id),
      relPath: String(r.rel_path),
      hash: String(r.hash),
      existed: Number(r.existed) === 1,
      blobPath: r.blob_path === null ? null : String(r.blob_path),
      content: r.content === null ? null : String(r.content),
    }));
  }

  async findByOperation(operationId: string): Promise<SnapshotRecord | null> {
    const row = this.db.get('SELECT * FROM file_snapshots WHERE operation_id = ? ORDER BY created_at DESC LIMIT 1', [
      operationId,
    ]);
    return row ? this.map(row) : null;
  }

  /** Retention: drop snapshots older than `days`, returning blob paths to remove. */
  async expire(days: number): Promise<{ snapshots: number; blobs: string[] }> {
    const cutoff = now() - days * 86_400_000;
    const old = this.db.all<SqlRow>('SELECT id FROM file_snapshots WHERE created_at < ?', [cutoff]);
    const blobs: string[] = [];
    for (const row of old) {
      for (const f of await this.files(String(row.id))) if (f.blobPath) blobs.push(f.blobPath);
    }
    if (old.length) {
      this.db.run('DELETE FROM file_snapshots WHERE created_at < ?', [cutoff]);
    }
    return { snapshots: old.length, blobs };
  }

  /** Blob dedupe: an identical file hash already written somewhere? */
  async findBlobByHash(hash: string): Promise<string | null> {
    const row = this.db.get<{ blob_path: string | null }>(
      'SELECT blob_path FROM snapshot_files WHERE hash = ? AND blob_path IS NOT NULL LIMIT 1',
      [hash],
    );
    return row?.blob_path ? String(row.blob_path) : null;
  }

  /** Is this blob still referenced by any snapshot other than `exceptSnapshotId`? */
  async blobInUse(blobPath: string, exceptSnapshotId?: string): Promise<boolean> {
    const row = exceptSnapshotId
      ? this.db.get('SELECT 1 FROM snapshot_files WHERE blob_path = ? AND snapshot_id != ? LIMIT 1', [
          blobPath,
          exceptSnapshotId,
        ])
      : this.db.get('SELECT 1 FROM snapshot_files WHERE blob_path = ? LIMIT 1', [blobPath]);
    return Boolean(row);
  }

  async count(projectId?: string): Promise<number> {
    const row = projectId
      ? this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM file_snapshots WHERE project_id = ?', [projectId])
      : this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM file_snapshots');
    return Number(row?.c ?? 0);
  }
}
