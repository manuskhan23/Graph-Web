/**
 * Phase 4 — Version history and rollback.
 *
 * Every mutating operation calls `capture()` *before* touching disk. Files are
 * deduplicated by content hash, so snapshots stay cheap; blobs above the inline
 * threshold are written to the artifact directory instead of the database.
 * Restores are themselves snapshotted, so a rollback can be rolled back.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { NexusError } from '../errors.js';
import type { Database } from '../storage/db.js';
import { resolveInsideProject, resolveInsideProjectReal } from '../security/paths.js';
import { id } from '../storage/driver.js';

const INLINE_LIMIT = 128 * 1024;

export interface CaptureOptions {
  projectId: string;
  relPaths: string[];
  /** Logical operation this snapshot protects (tool execution id, task step id…). */
  operationId: string;
  label: string;
  kind?: 'pre-change' | 'manual' | 'scheduled';
}

export interface RestoreResult {
  snapshotId: string;
  restored: string[];
  created: string[];
  deleted: string[];
  safetySnapshotId: string | null;
}

export class SnapshotService {
  constructor(private readonly db: Database) {}

  private blobPath(hash: string): string {
    return join(config.artifactDir, 'blobs', hash.slice(0, 2), `${hash}.txt`);
  }

  capture(options: CaptureOptions): string {
    const project = this.db.projects.get(options.projectId);
    if (!project) throw new NexusError('NOT_FOUND', `Project not found: ${options.projectId}`);

    const files: { relPath: string; hash: string; existed: boolean; blobPath: string | null; content: string | null }[] = [];
    const digest = createHash('sha256');
    let totalSize = 0;

    for (const relPath of [...new Set(options.relPaths)]) {
      const abs = resolveInsideProject(project.rootPath, relPath);
      if (!existsSync(abs)) {
        // Record deletions: restoring later must remove the file again.
        files.push({ relPath, hash: 'missing', existed: false, blobPath: null, content: null });
        digest.update(`${relPath}:missing`);
        continue;
      }
      let buffer: Buffer;
      try {
        buffer = readFileSync(abs);
      } catch (err) {
        throw new NexusError('STORAGE_ERROR', `Cannot snapshot ${relPath}`, { cause: err });
      }
      const hash = createHash('sha256').update(buffer).digest('hex');
      totalSize += buffer.length;
      digest.update(`${relPath}:${hash}`);

      // Reuse an existing blob with identical content (dedupe across snapshots).
      const existing = this.db.db.get<{ blob_path: string | null }>(
        'SELECT blob_path FROM snapshot_files WHERE hash = ? AND blob_path IS NOT NULL LIMIT 1',
        [hash],
      );
      let blob: string | null = existing?.blob_path ?? null;
      let inline: string | null = null;

      if (buffer.length > INLINE_LIMIT) {
        if (!blob || !existsSync(blob)) {
          blob = this.blobPath(hash);
          mkdirSync(dirname(blob), { recursive: true });
          writeFileSync(blob, buffer);
        }
      } else {
        inline = buffer.toString('utf8');
      }
      files.push({ relPath, hash, existed: true, blobPath: blob, content: inline });
    }

    const record = this.db.snapshots.create({
      projectId: options.projectId,
      operationId: options.operationId,
      kind: options.kind ?? 'pre-change',
      label: options.label,
      hash: digest.digest('hex'),
      size: totalSize,
      metadata: { files: files.length, operationId: options.operationId },
      files,
    });

    this.db.observability.addActivity({
      kind: 'system',
      level: 'info',
      title: `Snapshot: ${options.label}`,
      detail: `${files.length} file(s), ${(totalSize / 1024).toFixed(1)} KB`,
      projectId: options.projectId,
      taskId: null,
      provider: null,
      status: record.id,
    });

    return record.id;
  }

  /** Full-project capture (used before destructive project operations). */
  captureProject(projectId: string, label: string, operationId = id('op')): string {
    const files = this.db.projects.files(projectId).map((f) => f.relPath);
    return this.capture({ projectId, relPaths: files, operationId, label, kind: 'manual' });
  }

  list(projectId: string) {
    return this.db.snapshots.list(projectId).map((s) => ({
      ...s,
      fileCount: this.db.snapshots.files(s.id).length,
    }));
  }

  detail(snapshotId: string) {
    const snapshot = this.db.snapshots.get(snapshotId);
    if (!snapshot) throw new NexusError('NOT_FOUND', `Snapshot not found: ${snapshotId}`);
    return { ...snapshot, files: this.db.snapshots.files(snapshotId) };
  }

  /** Restore selected files (or all) from a snapshot. */
  restore(snapshotId: string, relPaths?: string[]): RestoreResult {
    const snapshot = this.db.snapshots.get(snapshotId);
    if (!snapshot) throw new NexusError('NOT_FOUND', `Snapshot not found: ${snapshotId}`);
    const project = this.db.projects.get(snapshot.projectId);
    if (!project) throw new NexusError('NOT_FOUND', 'Project for snapshot no longer exists');

    const all = this.db.snapshots.files(snapshotId);
    const targets = relPaths ? all.filter((f) => relPaths.includes(f.relPath)) : all;
    if (targets.length === 0) throw new NexusError('VALIDATION_FAILED', 'No matching files in snapshot');

    // Snapshot the current state first so the restore is reversible.
    const safety = this.capture({
      projectId: snapshot.projectId,
      relPaths: targets.map((t) => t.relPath),
      operationId: id('op'),
      label: `Before restoring ${snapshot.label}`,
      kind: 'pre-change',
    });

    const restored: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];

    for (const target of targets) {
      const abs = resolveInsideProject(project.rootPath, target.relPath);
      const existed = existsSync(abs);
      if (!target.existed) {
        if (existed) {
          safeUnlink(abs);
          deleted.push(target.relPath);
        }
        continue;
      }
      const data = target.content !== null ? Buffer.from(target.content, 'utf8') : readBlob(target.blobPath);
      if (!data) continue;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, data);
      (existed ? restored : created).push(target.relPath);
    }

    this.db.observability.addActivity({
      kind: 'system',
      level: 'warn',
      title: `Restored snapshot: ${snapshot.label}`,
      detail: `${restored.length} restored · ${created.length} created · ${deleted.length} deleted`,
      projectId: snapshot.projectId,
      taskId: null,
      provider: null,
      status: 'restored',
    });

    return { snapshotId, restored, created, deleted, safetySnapshotId: safety };
  }

  /** Retention policy — never deletes data inside the configured window. */
  applyRetention(days = config.retention.snapshotDays): { snapshots: number; blobs: number } {
    const { snapshots, blobs } = this.db.snapshots.expire(days);
    let removedBlobs = 0;
    for (const blob of blobs) {
      // Only remove a blob if no remaining snapshot file references it.
      const stillUsed = this.db.db.get(
        'SELECT 1 FROM snapshot_files WHERE blob_path = ? LIMIT 1',
        [blob],
      );
      if (!stillUsed) {
        try {
          unlinkSync(blob);
          removedBlobs += 1;
        } catch {
          /* already gone */
        }
      }
    }
    if (snapshots > 0) {
      this.db.observability.addActivity({
        kind: 'system',
        level: 'info',
        title: 'Snapshot retention applied',
        detail: `${snapshots} snapshot(s) older than ${days} days removed`,
        projectId: null,
        taskId: null,
        provider: null,
        status: 'completed',
      });
    }
    return { snapshots, blobs: removedBlobs };
  }

  /** Diff between a snapshot file and the current working tree file. */
  diffWithCurrent(snapshotId: string, relPath: string): { before: string; after: string; changed: boolean } {
    const snapshot = this.db.snapshots.get(snapshotId);
    if (!snapshot) throw new NexusError('NOT_FOUND', 'Snapshot not found');
    const project = this.db.projects.get(snapshot.projectId);
    if (!project) throw new NexusError('NOT_FOUND', 'Project not found');
    const file = this.db.snapshots.files(snapshotId).find((f) => f.relPath === relPath);
    const before = file?.content ?? (file?.blobPath ? readBlob(file.blobPath)?.toString('utf8') ?? '' : '');
    const abs = resolveInsideProjectReal(project.rootPath, relPath);
    const after = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    return { before, after, changed: before !== after };
  }

  purgeProject(projectId: string): void {
    for (const snapshot of this.db.snapshots.list(projectId, 10_000)) {
      for (const file of this.db.snapshots.files(snapshot.id)) {
        if (file.blobPath) {
          const used = this.db.db.get('SELECT 1 FROM snapshot_files WHERE blob_path = ? AND snapshot_id != ? LIMIT 1', [
            file.blobPath,
            snapshot.id,
          ]);
          if (!used && existsSync(file.blobPath)) {
            try {
              rmSync(file.blobPath);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }
}

function readBlob(blobPath: string | null): Buffer | null {
  if (!blobPath || !existsSync(blobPath)) return null;
  return readFileSync(blobPath);
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* ignore */
  }
}
