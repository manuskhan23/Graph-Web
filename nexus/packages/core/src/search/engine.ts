/**
 * Phase 11 — Hybrid search.
 *
 * Keyword retrieval is BM25 over the persisted chunk token index (always
 * available). Semantic retrieval uses Gemini embeddings when a key is configured
 * and the vectors exist for the current chunk hashes; otherwise the engine
 * degrades to keyword-only and says so in `strategy` instead of pretending.
 *
 * Every hit carries `isSourceContent: true` because snippets come from indexed
 * source text, never from a model.
 */
import type { SearchHit, SearchResponse } from '../types.js';
import type { Database } from '../storage/db.js';
import type { ModelRouter } from '../providers/router.js';
import { EMBEDDING_MODEL } from '../providers/models.js';
import { tokenize } from './tokenizer.js';
import { isCodeLanguage } from '../project/languages.js';

const K1 = 1.4;
const B = 0.7;

interface Doc {
  chunkId: string;
  relPath: string;
  startLine: number;
  endLine: number;
  content: string;
  terms: string[];
  tf: Map<string, number>;
  length: number;
}

export interface SearchOptions {
  projectId: string;
  query: string;
  limit?: number;
  semantic?: boolean;
  pathFilter?: string;
}

export class SearchEngine {
  constructor(
    private readonly db: Database,
    private readonly router?: ModelRouter,
  ) {}

  /** In-memory BM25 corpus built from the persisted chunk index. */
  private async buildCorpus(projectId: string, pathFilter?: string): Promise<Doc[]> {
    const files = await this.db.projects.filesByPath(projectId);
    const chunks = await this.db.projects.chunks(projectId);
    const docs: Doc[] = [];
    for (const chunk of chunks) {
      if (pathFilter && !chunk.relPath.includes(pathFilter)) continue;
      const file = files.get(chunk.relPath);
      if (file && !isCodeLanguage(file.language) && file.language !== 'json' && file.language !== 'yaml' && file.language !== 'markdown') {
        continue;
      }
      const terms = chunk.tokens.length > 0 ? chunk.tokens.split(' ').filter(Boolean) : tokenize(chunk.content);
      const tf = new Map<string, number>();
      for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
      docs.push({
        chunkId: String(chunk.id),
        relPath: chunk.relPath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        terms,
        tf,
        length: terms.length,
      });
    }
    return docs;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const startedAt = Date.now();
    const limit = options.limit ?? 12;
    const corpus = await this.buildCorpus(options.projectId, options.pathFilter);
    const queryTerms = tokenize(options.query);

    if (corpus.length === 0 || queryTerms.length === 0) {
      return {
        query: options.query,
        projectId: options.projectId,
        hits: [],
        tookMs: Date.now() - startedAt,
        strategy: 'keyword',
      };
    }

    // ---- BM25
    const df = new Map<string, number>();
    for (const doc of corpus) {
      for (const term of new Set(doc.terms)) df.set(term, (df.get(term) ?? 0) + 1);
    }
    const avgLen = corpus.reduce((sum, d) => sum + d.length, 0) / corpus.length;
    const N = corpus.length;
    const scored: { doc: Doc; score: number }[] = [];

    for (const doc of corpus) {
      let score = 0;
      let matched = 0;
      for (const term of queryTerms) {
        const freq = doc.tf.get(term);
        if (!freq) continue;
        matched += 1;
        const n = df.get(term) ?? 0;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        score += idf * ((freq * (K1 + 1)) / (freq + K1 * (1 - B + B * (doc.length / avgLen))));
      }
      if (score <= 0) continue;
      // Coverage bonus: matching more distinct query terms beats repeating one.
      score *= 1 + (matched / queryTerms.length) * 0.5;
      // Symbol/path matches are strong signals in code search.
      const lowerPath = doc.relPath.toLowerCase();
      for (const term of queryTerms) {
        if (lowerPath.includes(term)) score *= 1.15;
      }
      scored.push({ doc, score });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, limit * 3);

    // ---- optional semantic re-rank (Gemini embeddings)
    let strategy: SearchResponse['strategy'] = 'keyword';
    if (options.semantic && this.router) {
      const reranked = await this.semanticRerank(options.projectId, options.query, top);
      if (reranked) {
        top.splice(0, top.length, ...reranked);
        strategy = 'hybrid';
      }
    }

    const hits: SearchHit[] = top.slice(0, limit).map(({ doc, score }) => ({
      relPath: doc.relPath,
      startLine: doc.startLine,
      endLine: doc.endLine,
      score: Number(score.toFixed(4)),
      snippet: buildSnippet(doc.content, queryTerms),
      matchType: strategy === 'hybrid' ? 'hybrid' : 'keyword',
      isSourceContent: true,
    }));

    return {
      query: options.query,
      projectId: options.projectId,
      hits,
      tookMs: Date.now() - startedAt,
      strategy,
    };
  }

  /**
   * Returns null when embeddings are unavailable (no key / no vectors), so the
   * caller can honestly report keyword-only retrieval.
   */
  private async semanticRerank(
    projectId: string,
    query: string,
    docs: { doc: Doc; score: number }[],
  ): Promise<{ doc: Doc; score: number }[] | null> {
    if (!this.router || docs.length === 0) return null;
    const existing = await this.db.embeddings.list(projectId);
    if (existing.length === 0) return null;
    let queryVector: number[];
    try {
      const vectors = await this.router.embed([query], 'search.query');
      queryVector = vectors[0] ?? [];
    } catch {
      return null;
    }
    if (queryVector.length === 0) return null;

    const byChunk = new Map<string, Float32Array>();
    for (const row of existing) byChunk.set(row.chunkId, row.vector);

    const rescored = docs.map(({ doc, score }) => {
      const vector = byChunk.get(doc.chunkId);
      const cos = vector ? cosine(queryVector, Array.from(vector)) : 0;
      // Normalise BM25 into a comparable band before blending.
      const normalisedBm25 = score / (1 + score);
      return { doc, score: normalisedBm25 * 0.55 + cos * 0.45 };
    });
    rescored.sort((a, b) => b.score - a.score);
    return rescored;
  }

  /** Persist embeddings for a project (used by the index command / job). */
  async embedProject(projectId: string, limit = 400): Promise<number> {
    if (!this.router) return 0;
    const chunks = await this.db.projects.chunks(projectId);
    const already = new Set((await this.db.embeddings.list(projectId)).map((row) => row.chunkId));
    const pending = chunks.filter((c) => !already.has(c.id)).slice(0, limit);
    if (pending.length === 0) return 0;
    let stored = 0;
    const batchSize = 20;
    for (let i = 0; i < pending.length; i += batchSize) {
      const batch = pending.slice(i, i + batchSize);
      try {
        const vectors = await this.router.embed(
          batch.map((c) => c.content.slice(0, 4000)),
          'search.index',
        );
        const entries = batch
          .map((chunk, index) => ({ chunkId: String(chunk.id), vector: new Float32Array(vectors[index] ?? []) }))
          .filter((entry) => entry.vector.length > 0);
        await this.db.embeddings.upsert(projectId, EMBEDDING_MODEL, entries);
        stored += entries.length;
      } catch {
        return stored;
      }
    }
    return stored;
  }
}

function buildSnippet(content: string, queryTerms: string[], maxLength = 320): string {
  const lower = content.toLowerCase();
  let bestIndex = -1;
  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) bestIndex = idx;
  }
  if (bestIndex === -1) return content.slice(0, maxLength);
  const start = Math.max(0, bestIndex - 90);
  const snippet = content.slice(start, start + maxLength);
  return `${start > 0 ? '…' : ''}${snippet}${start + maxLength < content.length ? '…' : ''}`;
}

function decodeVector(blob: Uint8Array, dim: number): number[] {
  const copy = new Uint8Array(blob);
  const floats = new Float32Array(copy.buffer, copy.byteOffset, Math.min(dim, copy.byteLength / 4));
  return Array.from(floats);
}

function cosine(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export { decodeVector, cosine };
