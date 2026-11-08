/**
 * Phase 3 — Code editing engine.
 *
 * Editing is a two-phase operation:
 *   1. `stage()` — validate paths, detect conflicts against the hash the caller
 *      saw, snapshot the pre-change state, and produce diffs. Nothing is written.
 *   2. `apply()` — write the staged changes. Apply is idempotent-safe: it
 *      re-checks that the file still matches the staged "before" hash, so a user
 *      edit landing in between is never silently overwritten.
 *
 * Edits are only applied after an explicit approval when the surrounding task
 * requires one (see the tool registry / permission layer).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { diffLines } from 'diff';
import { NexusError } from '../errors.js';
import type { Database } from '../storage/db.js';
import type { SnapshotService } from '../snapshots/service.js';
import { assertNoSecret, assertReadableFile, isBinaryPath, resolveInsideProject, resolveInsideProjectReal, toRelative } from '../security/paths.js';
import { config } from '../config.js';
import { buildFileDiff, summarizeDiffs, type FileDiff } from './diff.js';
import { id } from '../storage/driver.js';
import { assertNoGitMetadata } from '../security/invariants.js';

export type EditOperation =
  | { kind: 'create'; relPath: string; content: string }
  | { kind: 'write'; relPath: string; content: string; expectedHash?: string | null }
  | { kind: 'replace'; relPath: string; search: string; replace: string; expectedHash?: string | null }
  | { kind: 'delete'; relPath: string; expectedHash?: string | null }
  | { kind: 'move'; relPath: string; to: string; expectedHash?: string | null }
  | { kind: 'mkdir'; relPath: string };

export interface StagedChange {
  operation: EditOperation;
  relPath: string;
  beforeContent: string | null;
  afterContent: string | null;
  beforeHash: string | null;
  diff: FileDiff | null;
}

export interface StagedEditSet {
  operationId: string;
  projectId: string;
  changes: StagedChange[];
  summary: { files: number; additions: number; deletions: number };
  snapshotId: string;
}

interface StagedCacheEntry extends StagedEditSet {
  projectRoot: string;
  stagedAt: number;
}

export class EditorService {
  private staged = new Map<string, StagedCacheEntry>();

  constructor(
    private readonly db: Database,
    private readonly snapshots: SnapshotService,
  ) {}

  /* ------------------------------------------------------------- reading */

  readFile(projectId: string, relPath: string): { relPath: string; content: string; hash: string; lines: number } {
    const project = this.requireProject(projectId);
    const { absPath } = assertReadableFile(project.rootPath, relPath);
    const content = readFileSync(absPath, 'utf8');
    return {
      relPath,
      content,
      hash: hashOf(content),
      lines: content.split(/\r?\n/).length,
    };
  }

  readRange(projectId: string, relPath: string, startLine: number, endLine: number): { content: string; hash: string } {
    const file = this.readFile(projectId, relPath);
    const lines = file.content.split(/\r?\n/);
    const start = Math.max(1, Math.min(startLine, lines.length));
    const end = Math.max(start, Math.min(endLine, lines.length));
    return { content: lines.slice(start - 1, end).join('\n'), hash: file.hash };
  }

  listTree(projectId: string, maxEntries = 4000) {
    const project = this.requireProject(projectId);
    const files = this.db.projects.files(projectId);
    const dirs = new Map<string, number>();
    for (const file of files) {
      const parts = file.relPath.split('/');
      for (let i = 1; i < parts.length; i += 1) {
        const dir = parts.slice(0, i).join('/');
        dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
      }
    }
    return {
      root: project.rootPath,
      files: files.slice(0, maxEntries).map((f) => ({
        relPath: f.relPath,
        language: f.language,
        size: f.size,
        lines: f.lines,
        hash: f.hash,
      })),
      directories: [...dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, count]) => ({ path, files: count })),
    };
  }

  /* ------------------------------------------------------------- staging */

  stage(projectId: string, operations: EditOperation[], label = 'Code change'): StagedEditSet {
    const project = this.requireProject(projectId);
    if (!Array.isArray(operations) || operations.length === 0) {
      throw new NexusError('VALIDATION_FAILED', 'At least one edit operation is required');
    }
    const changes: StagedChange[] = [];
    const touched: string[] = [];

    for (const operation of operations) {
      assertNoGitMetadata(operation.relPath);
      const abs = resolveInsideProject(project.rootPath, operation.relPath);
      assertNoSecret(abs);

      switch (operation.kind) {
        case 'create': {
          if (existsSync(abs)) {
            throw new NexusError('CONFLICT', `File already exists: ${operation.relPath}`);
          }
          if (isBinaryPath(operation.relPath)) throw new NexusError('VALIDATION_FAILED', 'Refusing to create a binary file as text');
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: null,
            afterContent: operation.content,
            beforeHash: null,
            diff: buildFileDiff(operation.relPath, '', operation.content),
          });
          touched.push(operation.relPath);
          break;
        }
        case 'write': {
          const current = this.readCurrent(project.rootPath, operation.relPath);
          assertExpectedHash(operation.relPath, current.hash, operation.expectedHash);
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: current.content,
            afterContent: operation.content,
            beforeHash: current.hash,
            diff: buildFileDiff(operation.relPath, current.content ?? '', operation.content),
          });
          touched.push(operation.relPath);
          break;
        }
        case 'replace': {
          const current = this.readCurrent(project.rootPath, operation.relPath);
          if (current.content === null) throw new NexusError('PATH_NOT_FOUND', `File not found: ${operation.relPath}`);
          assertExpectedHash(operation.relPath, current.hash, operation.expectedHash);
          if (operation.search.length === 0) throw new NexusError('VALIDATION_FAILED', 'Search string is empty');
          const occurrences = countOccurrences(current.content, operation.search);
          if (occurrences === 0) {
            throw new NexusError('CONFLICT', `Search text not found in ${operation.relPath} (the file may have changed)`);
          }
          if (occurrences > 1) {
            throw new NexusError('CONFLICT', `Search text is ambiguous: ${occurrences} matches in ${operation.relPath}. Provide more context.`);
          }
          const after = current.content.replace(operation.search, operation.replace);
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: current.content,
            afterContent: after,
            beforeHash: current.hash,
            diff: buildFileDiff(operation.relPath, current.content, after),
          });
          touched.push(operation.relPath);
          break;
        }
        case 'delete': {
          const current = this.readCurrent(project.rootPath, operation.relPath);
          if (current.content === null) throw new NexusError('PATH_NOT_FOUND', `File not found: ${operation.relPath}`);
          assertExpectedHash(operation.relPath, current.hash, operation.expectedHash);
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: current.content,
            afterContent: null,
            beforeHash: current.hash,
            diff: buildFileDiff(operation.relPath, current.content, ''),
          });
          touched.push(operation.relPath);
          break;
        }
        case 'move': {
          const current = this.readCurrent(project.rootPath, operation.relPath);
          if (current.content === null) throw new NexusError('PATH_NOT_FOUND', `File not found: ${operation.relPath}`);
          assertExpectedHash(operation.relPath, current.hash, operation.expectedHash);
          const targetAbs = resolveInsideProject(project.rootPath, operation.to);
          assertNoSecret(targetAbs);
          if (existsSync(targetAbs)) throw new NexusError('CONFLICT', `Destination exists: ${operation.to}`);
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: current.content,
            afterContent: current.content,
            beforeHash: current.hash,
            diff: buildFileDiff(operation.relPath, current.content ?? '', current.content ?? ''),
          });
          touched.push(operation.relPath, operation.to);
          break;
        }
        case 'mkdir': {
          if (existsSync(abs)) throw new NexusError('CONFLICT', `Directory already exists: ${operation.relPath}`);
          changes.push({
            operation,
            relPath: operation.relPath,
            beforeContent: null,
            afterContent: null,
            beforeHash: null,
            diff: null,
          });
          break;
        }
        default:
          throw new NexusError('VALIDATION_FAILED', `Unsupported edit operation`);
      }
    }

    const operationId = id('edit');
    const snapshotId = this.snapshots.capture({
      projectId,
      relPaths: touched,
      operationId,
      label,
    });

    const staged: StagedEditSet = {
      operationId,
      projectId,
      changes,
      summary: summarizeDiffs(changes.map((c) => c.diff).filter((d): d is FileDiff => d !== null)),
      snapshotId,
    };
    this.staged.set(operationId, { ...staged, projectRoot: project.rootPath, stagedAt: Date.now() });
    return staged;
  }

  getStaged(operationId: string): StagedEditSet | null {
    const entry = this.staged.get(operationId);
    if (!entry) return null;
    const { projectRoot: _root, stagedAt: _at, ...set } = entry;
    return set;
  }

  discard(operationId: string): boolean {
    return this.staged.delete(operationId);
  }

  /* ------------------------------------------------------------- applying */

  apply(operationId: string, options: { approvedBy?: string } = {}): { operationId: string; applied: string[]; snapshotId: string } {
    const entry = this.staged.get(operationId);
    if (!entry) throw new NexusError('NOT_FOUND', `No staged edit set: ${operationId}`);

    const applied: string[] = [];
    // Apply in a single pass; the pre-change snapshot is the rollback point.
    for (const change of entry.changes) {
      const op = change.operation;
      const abs = resolveInsideProject(entry.projectRoot, change.relPath);

      if (op.kind === 'mkdir') {
        mkdirSync(abs, { recursive: true });
        applied.push(change.relPath);
        continue;
      }

      if (op.kind === 'delete') {
        // Re-verify the file has not changed since staging.
        const current = this.readCurrent(entry.projectRoot, change.relPath);
        assertExpectedHash(change.relPath, current.hash, change.beforeHash);
        if (existsSync(abs)) unlinkSync(abs);
        this.db.projects.deleteFile(entry.projectId, change.relPath);
        applied.push(change.relPath);
        continue;
      }

      if (op.kind === 'move') {
        const current = this.readCurrent(entry.projectRoot, change.relPath);
        assertExpectedHash(change.relPath, current.hash, change.beforeHash);
        const targetAbs = resolveInsideProject(entry.projectRoot, op.to);
        mkdirSync(dirname(targetAbs), { recursive: true });
        renameSync(abs, targetAbs);
        this.db.projects.deleteFile(entry.projectId, change.relPath);
        applied.push(`${change.relPath} → ${op.to}`);
        continue;
      }

      // create / write / replace
      const current = this.readCurrent(entry.projectRoot, change.relPath);
      if (op.kind === 'create') {
        if (existsSync(abs)) throw new NexusError('CONFLICT', `File appeared during apply: ${change.relPath}`);
      } else {
        assertExpectedHash(change.relPath, current.hash, change.beforeHash);
      }
      if ((change.afterContent ?? '').length > config.limits.maxFileBytes) {
        throw new NexusError('FILE_TOO_LARGE', `Content exceeds the ${config.limits.maxFileBytes} byte limit`);
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, change.afterContent ?? '', 'utf8');
      const rel = toRelative(entry.projectRoot, abs);
      this.db.projects.upsertFile(entry.projectId, {
        relPath: rel,
        language: detectLang(rel),
        size: Buffer.byteLength(change.afterContent ?? ''),
        hash: hashOf(change.afterContent ?? ''),
        lines: (change.afterContent ?? '').split(/\r?\n/).length,
      });
      applied.push(change.relPath);
    }

    this.staged.delete(operationId);
    this.db.observability.addActivity({
      kind: 'tool',
      level: 'info',
      title: 'Applied code changes',
      detail: `${applied.length} file(s) modified`,
      projectId: entry.projectId,
      taskId: null,
      provider: null,
      status: 'completed',
    });
    this.db.observability.audit({
      actor: options.approvedBy ?? 'user',
      action: 'editor.apply',
      subject: operationId,
      allowed: true,
      metadata: { files: applied },
    });

    return { operationId, applied, snapshotId: entry.snapshotId };
  }

  /* -------------------------------------------------------------- helpers */

  private requireProject(projectId: string) {
    const project = this.db.projects.get(projectId);
    if (!project) throw new NexusError('NOT_FOUND', `Project not found: ${projectId}`);
    return project;
  }

  private readCurrent(root: string, relPath: string): { content: string | null; hash: string | null } {
    const abs = resolveInsideProjectReal(root, relPath);
    if (!existsSync(abs)) return { content: null, hash: null };
    const content = readFileSync(abs, 'utf8');
    return { content, hash: hashOf(content) };
  }
}

export function hashOf(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertExpectedHash(relPath: string, actual: string | null, expected: string | null | undefined): void {
  if (expected === undefined || expected === null) return;
  if (actual !== expected) {
    throw new NexusError('CONFLICT', `File changed since it was inspected: ${relPath}`, {
      details: { expected, actual },
    });
  }
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function detectLang(relPath: string): string {
  const dot = relPath.lastIndexOf('.');
  if (dot === -1) return 'unknown';
  const ext = relPath.slice(dot).toLowerCase();
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.json': 'json', '.md': 'markdown', '.css': 'css', '.html': 'html',
    '.yml': 'yaml', '.yaml': 'yaml', '.sql': 'sql',
  };
  return map[ext] ?? 'unknown';
}

export { diffLines };
