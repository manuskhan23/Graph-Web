/**
 * SQLite embedding store. Vectors live in `embeddings` as float32 blobs, which
 * keeps re-ranking a single table scan instead of a provider round-trip.
 */
import type { EmbeddingRecord, EmbeddingStore } from '../contracts.js';
import type { SqlDriver } from '../driver.js';

export class SqliteEmbeddingStore implements EmbeddingStore {
  constructor(private readonly db: SqlDriver) {}

  async list(projectId: string): Promise<EmbeddingRecord[]> {
    return this.db
      .all<{ chunk_id: number; vector: Uint8Array; dim: number }>(
        'SELECT chunk_id, vector, dim FROM embeddings WHERE project_id = ?',
        [projectId],
      )
      .map((row) => ({
        chunkId: String(row.chunk_id),
        vector: new Float32Array(
          row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength),
        ),
      }));
  }

  async upsert(
    projectId: string,
    model: string,
    entries: { chunkId: string; vector: Float32Array }[],
  ): Promise<void> {
    if (entries.length === 0) return;
    this.db.transaction(() => {
      for (const entry of entries) {
        if (entry.vector.length === 0) continue;
        this.db.run(
          `INSERT INTO embeddings (chunk_id, project_id, vector, dim, model, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(chunk_id) DO UPDATE SET vector = excluded.vector, dim = excluded.dim, model = excluded.model`,
          [
            Number(entry.chunkId),
            projectId,
            new Uint8Array(entry.vector.buffer.slice(0)),
            entry.vector.length,
            model,
            Date.now(),
          ],
        );
      }
    });
  }

  async removeForFile(projectId: string, relPath: string): Promise<void> {
    this.db.run(
      'DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM file_chunks WHERE project_id = ? AND rel_path = ?)',
      [projectId, relPath],
    );
  }
}
