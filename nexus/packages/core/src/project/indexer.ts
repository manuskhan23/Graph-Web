/**
 * Phase 1 — Incremental indexer.
 *
 * Only files whose content hash changed are re-read and re-chunked; removed files
 * are cleaned out of the index and the chunk/embedding tables. An index version is
 * bumped on every run so downstream context caches can invalidate.
 */
import { readFileSync } from 'node:fs';
import type { ScanResult } from '../types.js';
import type { Database } from '../storage/db.js';
import { NexusError } from '../errors.js';
import { countLines, hashContent, walkProject } from './scanner.js';
import { chunkFile } from '../context/chunker.js';
import { tokenize } from '../search/tokenizer.js';
import type { EventBus } from '../events/bus.js';

export interface IndexOptions {
  force?: boolean;
  maxFiles?: number;
  reason?: string;
}

export class ProjectIndexer {
  constructor(
    private readonly db: Database,
    private readonly events?: EventBus,
  ) {}

  async index(projectId: string, options: IndexOptions = {}): Promise<ScanResult> {
    const project = await this.db.projects.get(projectId);
    if (!project) throw new NexusError('NOT_FOUND', `Project not found: ${projectId}`);

    const startedAt = Date.now();
    const entries = walkProject(project.rootPath, project.ignoredGlobs, { maxFiles: options.maxFiles });
    const existing = options.force ? new Map() : await this.db.projects.filesByPath(projectId);
    const seen = new Set<string>();

    let added = 0;
    let modified = 0;
    let unchanged = 0;
    let skipped = 0;
    const indexVersion = project.indexVersion + 1;
    const runId = await this.db.projects.startIndexRun(projectId, indexVersion);

    try {
      for (const entry of entries) {
        let content: string;
        try {
          content = readFileSync(entry.absPath, 'utf8');
        } catch {
          skipped += 1;
          continue;
        }
        const hash = hashContent(content);
        seen.add(entry.relPath);
        const prior = existing.get(entry.relPath);

        if (prior && prior.hash === hash && !options.force) {
          unchanged += 1;
          continue;
        }

        await this.db.projects.upsertFile(projectId, {
          relPath: entry.relPath,
          language: entry.language,
          size: entry.size,
          hash,
          lines: countLines(content),
        });

        const chunks = chunkFile(entry.relPath, content).map((chunk) => ({
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          tokens: tokenize(`${entry.relPath} ${chunk.content}`).join(' '),
          hash: hashContent(chunk.content),
        }));
        await this.db.projects.replaceChunks(projectId, entry.relPath, chunks);

        if (prior) modified += 1;
        else added += 1;

        this.events?.emit('notice', `Indexed ${entry.relPath}`, { added: !prior, relPath: entry.relPath }, { projectId });
      }

      let removed = 0;
      for (const relPath of existing.keys()) {
        if (!seen.has(relPath)) {
          await this.db.projects.deleteFile(projectId, relPath);
          removed += 1;
        }
      }

      await this.db.projects.update(projectId, {
        indexVersion,
        lastIndexedAt: Date.now(),
      });
      await this.db.projects.finishIndexRun(runId, {
        scanned: entries.length,
        added,
        modified,
        removed,
        unchanged,
        skipped,
        indexVersion,
      });

      const result: ScanResult = {
        projectId,
        scanned: entries.length,
        added,
        modified,
        removed,
        unchanged,
        skipped,
        durationMs: Date.now() - startedAt,
        indexVersion,
      };

      await this.db.observability.addActivity({
        kind: 'system',
        level: 'info',
        title: `Indexed ${project.name}`,
        detail: `${added} added · ${modified} modified · ${removed} removed · ${unchanged} unchanged (${result.durationMs} ms)`,
        projectId,
        taskId: null,
        provider: null,
        status: 'completed',
      });

      return result;
    } catch (err) {
      await this.db.projects.finishIndexRun(runId, {
        scanned: entries.length,
        added,
        modified,
        removed: 0,
        unchanged,
        skipped,
        indexVersion,
        error: (err as Error).message,
      });
      throw new NexusError('STORAGE_ERROR', `Indexing failed: ${(err as Error).message}`, { cause: err });
    }
  }
}
