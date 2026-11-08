/**
 * MongoDB project / file-index store.
 *
 * Equivalent behaviour to `sqlite/projects.ts`, expressed as document operations:
 *   - unique (projectId, relPath) index replaces the SQL UNIQUE constraint
 *   - `upsertFile` is an idempotent upsert on that same key
 *   - `replaceChunks` deletes + reinserts inside the same logical operation
 */
import type { Project, ProjectFileRecord, ScanResult } from '../../types.js';
import { id, now } from '../driver.js';
import type {
  ChunkInput,
  ChunkRecord,
  IndexedFileInput,
  IndexRunRecord,
  ProjectStore,
} from '../contracts.js';
import type { MongoHandle } from './client.js';

type Doc = Record<string, unknown>;

export class MongoProjectStore implements ProjectStore {
  constructor(private readonly mongo: MongoHandle) {}

  private get projects() {
    return this.mongo.collection('projects');
  }
  private get filesCol() {
    return this.mongo.collection('project_files');
  }
  private get chunks_() {
    return this.mongo.collection('file_chunks');
  }
  private get runs() {
    return this.mongo.collection('index_runs');
  }

  private toProject(doc: Doc): Project {
    return {
      id: String(doc._id),
      name: String(doc.name),
      rootPath: String(doc.rootPath),
      description: String(doc.description ?? ''),
      createdAt: Number(doc.createdAt),
      updatedAt: Number(doc.updatedAt),
      lastIndexedAt: doc.lastIndexedAt === null || doc.lastIndexedAt === undefined ? null : Number(doc.lastIndexedAt),
      indexVersion: Number(doc.indexVersion ?? 0),
      ignoredGlobs: (doc.ignoredGlobs as string[]) ?? [],
      settings: (doc.settings as Record<string, unknown>) ?? {},
    };
  }

  private toFile(doc: Doc): ProjectFileRecord {
    return {
      // ProjectFileRecord.id stays a number in the shared type for SQLite parity;
      // Mongo has no integer ids, so a stable string hash-free ordinal is used.
      id: Number(doc.ordinal ?? 0),
      projectId: String(doc.projectId),
      relPath: String(doc.relPath),
      language: String(doc.language),
      size: Number(doc.size),
      hash: String(doc.hash),
      lines: Number(doc.lines),
      indexedAt: Number(doc.indexedAt),
    };
  }

  async list(): Promise<Project[]> {
    const docs = await this.projects.find({}).sort({ updatedAt: -1 }).limit(500).toArray();
    return docs.map((doc) => this.toProject(doc));
  }

  async get(projectId: string): Promise<Project | null> {
    const doc = await this.projects.findOne({ _id: projectId });
    return doc ? this.toProject(doc) : null;
  }

  async findByRoot(rootPath: string): Promise<Project | null> {
    const doc = await this.projects.findOne({ rootPath });
    return doc ? this.toProject(doc) : null;
  }

  async create(input: {
    name: string;
    rootPath: string;
    description?: string;
    ignoredGlobs?: string[];
    settings?: Record<string, unknown>;
  }): Promise<Project> {
    const projectId = id('prj');
    const ts = now();
    const doc: Doc = {
      _id: projectId,
      name: input.name,
      rootPath: input.rootPath,
      description: input.description ?? '',
      createdAt: ts,
      updatedAt: ts,
      lastIndexedAt: null,
      indexVersion: 0,
      ignoredGlobs: input.ignoredGlobs ?? [],
      settings: input.settings ?? {},
    };
    await this.projects.insertOne(doc);
    return this.toProject(doc);
  }

  async update(
    projectId: string,
    patch: Partial<
      Pick<Project, 'name' | 'description' | 'ignoredGlobs' | 'settings' | 'lastIndexedAt' | 'indexVersion'>
    >,
  ): Promise<Project | null> {
    const set: Doc = { updatedAt: now() };
    for (const key of ['name', 'description', 'ignoredGlobs', 'settings', 'lastIndexedAt', 'indexVersion'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    const result = await this.projects.updateOne({ _id: projectId }, { $set: set });
    if (result.matchedCount === 0) return null;
    return this.get(projectId);
  }

  async remove(projectId: string): Promise<boolean> {
    // Cascade by hand: Mongo has no foreign keys. Orphaned rows would quietly
    // inflate analytics, so every child collection is cleared here.
    const removed = await this.projects.deleteOne({ _id: projectId });
    if (removed.deletedCount === 0) return false;
    await Promise.all([
      this.filesCol.deleteMany({ projectId }),
      this.chunks_.deleteMany({ projectId }),
      this.mongo.collection('embeddings').deleteMany({ projectId }),
      this.runs.deleteMany({ projectId }),
      this.mongo.collection('file_snapshots').deleteMany({ projectId }),
    ]);
    return true;
  }

  /* ----------------------------------------------------------- file index */

  async files(projectId: string): Promise<ProjectFileRecord[]> {
    const docs = await this.filesCol.find({ projectId }).sort({ relPath: 1 }).limit(50_000).toArray();
    return docs.map((doc) => this.toFile(doc));
  }

  async filesByPath(projectId: string): Promise<Map<string, ProjectFileRecord>> {
    const map = new Map<string, ProjectFileRecord>();
    for (const file of await this.files(projectId)) map.set(file.relPath, file);
    return map;
  }

  async getFile(projectId: string, relPath: string): Promise<ProjectFileRecord | null> {
    const doc = await this.filesCol.findOne({ projectId, relPath });
    return doc ? this.toFile(doc) : null;
  }

  async upsertFile(projectId: string, file: IndexedFileInput): Promise<void> {
    await this.filesCol.updateOne(
      { projectId, relPath: file.relPath },
      {
        $set: {
          projectId,
          relPath: file.relPath,
          language: file.language,
          size: file.size,
          hash: file.hash,
          lines: file.lines,
          indexedAt: now(),
        },
        $setOnInsert: { ordinal: 0 },
      },
      { upsert: true },
    );
  }

  async deleteFile(projectId: string, relPath: string): Promise<void> {
    await this.filesCol.deleteOne({ projectId, relPath });
    await this.mongo
      .collection('embeddings')
      .deleteMany({ chunkId: { $in: (await this.chunks_.find({ projectId, relPath }).toArray()).map((c) => String(c._id)) } });
    await this.chunks_.deleteMany({ projectId, relPath });
  }

  async countFiles(projectId: string): Promise<number> {
    return this.filesCol.countDocuments({ projectId });
  }

  /* --------------------------------------------------------------- chunks */

  async replaceChunks(projectId: string, relPath: string, chunks: ChunkInput[]): Promise<void> {
    const existing = await this.chunks_.find({ projectId, relPath }).toArray();
    if (existing.length > 0) {
      await this.mongo
        .collection('embeddings')
        .deleteMany({ chunkId: { $in: existing.map((c) => String(c._id)) } });
    }
    await this.chunks_.deleteMany({ projectId, relPath });
    if (chunks.length === 0) return;
    await this.chunks_.insertMany(
      chunks.map((chunk, index) => ({
        _id: `${projectId}:${relPath}:${index}`,
        projectId,
        relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        tokens: chunk.tokens,
        hash: chunk.hash,
      })),
    );
  }

  async chunks(projectId: string): Promise<ChunkRecord[]> {
    const docs = await this.chunks_
      .find({ projectId })
      .sort({ relPath: 1, startLine: 1 })
      .limit(200_000)
      .toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      relPath: String(doc.relPath),
      startLine: Number(doc.startLine),
      endLine: Number(doc.endLine),
      content: String(doc.content),
      tokens: String(doc.tokens),
      hash: String(doc.hash),
    }));
  }

  /* ----------------------------------------------------------- index runs */

  async startIndexRun(projectId: string, indexVersion: number): Promise<string> {
    const runId = id('idx');
    await this.runs.insertOne({
      _id: runId,
      projectId,
      startedAt: now(),
      finishedAt: null,
      indexVersion,
      added: 0,
      modified: 0,
      removed: 0,
      unchanged: 0,
      skipped: 0,
      status: 'running',
      error: null,
    });
    return runId;
  }

  async finishIndexRun(
    runId: string,
    result: Omit<ScanResult, 'projectId' | 'durationMs'> & { error?: string },
  ): Promise<void> {
    await this.runs.updateOne(
      { _id: runId },
      {
        $set: {
          finishedAt: now(),
          added: result.added,
          modified: result.modified,
          removed: result.removed,
          unchanged: result.unchanged,
          skipped: result.skipped,
          indexVersion: result.indexVersion,
          status: result.error ? 'failed' : 'completed',
          error: result.error ?? null,
        },
      },
    );
  }

  async recentIndexRuns(projectId: string, limit = 10): Promise<IndexRunRecord[]> {
    const docs = await this.runs.find({ projectId }).sort({ startedAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      projectId: String(doc.projectId),
      startedAt: Number(doc.startedAt),
      finishedAt: doc.finishedAt === null || doc.finishedAt === undefined ? null : Number(doc.finishedAt),
      indexVersion: Number(doc.indexVersion),
      added: Number(doc.added ?? 0),
      modified: Number(doc.modified ?? 0),
      removed: Number(doc.removed ?? 0),
      unchanged: Number(doc.unchanged ?? 0),
      skipped: Number(doc.skipped ?? 0),
      status: String(doc.status),
      error: doc.error === null || doc.error === undefined ? null : String(doc.error),
    }));
  }
}
