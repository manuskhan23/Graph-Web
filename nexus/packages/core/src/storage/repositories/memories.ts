import type { Memory, MemoryCategory } from '../../types.js';
import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';

export class MemoriesRepository {
  constructor(private readonly db: SqlDriver) {}

  private map(row: SqlRow): Memory {
    return {
      id: String(row.id),
      projectId: row.project_id === null ? null : String(row.project_id),
      category: String(row.category) as MemoryCategory,
      content: String(row.content),
      importance: Number(row.importance),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      revisions: parseJson<{ at: number; content: string }[]>(row.revisions, []),
      source: String(row.source) as Memory['source'],
    };
  }

  list(filter: { projectId?: string | null; category?: MemoryCategory; limit?: number } = {}): Memory[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.projectId !== undefined) {
      if (filter.projectId === null) where.push('project_id IS NULL');
      else {
        where.push('(project_id = ? OR project_id IS NULL)');
        params.push(filter.projectId);
      }
    }
    if (filter.category) {
      where.push('category = ?');
      params.push(filter.category);
    }
    const sql = `SELECT * FROM memories ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY importance DESC, updated_at DESC LIMIT ?`;
    params.push(filter.limit ?? 200);
    return this.db.all(sql, params).map((r) => this.map(r));
  }

  get(memoryId: string): Memory | null {
    const row = this.db.get('SELECT * FROM memories WHERE id = ?', [memoryId]);
    return row ? this.map(row) : null;
  }

  create(input: {
    projectId: string | null;
    category: MemoryCategory;
    content: string;
    importance?: number;
    source?: Memory['source'];
  }): Memory {
    const memoryId = id('mem');
    const ts = now();
    this.db.run(
      `INSERT INTO memories (id, project_id, category, content, importance, created_at, updated_at, revisions, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?)`,
      [
        memoryId,
        input.projectId,
        input.category,
        input.content,
        input.importance ?? 3,
        ts,
        ts,
        input.source ?? 'user',
      ],
    );
    return this.get(memoryId)!;
  }

  update(
    memoryId: string,
    patch: { content?: string; category?: MemoryCategory; importance?: number },
  ): Memory | null {
    const current = this.get(memoryId);
    if (!current) return null;
    const revisions = [...current.revisions, { at: current.updatedAt, content: current.content }].slice(-20);
    this.db.run(
      'UPDATE memories SET content = ?, category = ?, importance = ?, revisions = ?, updated_at = ? WHERE id = ?',
      [
        patch.content ?? current.content,
        patch.category ?? current.category,
        patch.importance ?? current.importance,
        JSON.stringify(revisions),
        now(),
        memoryId,
      ],
    );
    return this.get(memoryId);
  }

  remove(memoryId: string): boolean {
    return this.db.run('DELETE FROM memories WHERE id = ?', [memoryId]).changes > 0;
  }

  search(term: string, projectId?: string | null): Memory[] {
    const like = `%${term.toLowerCase()}%`;
    const rows = this.db.all(
      `SELECT * FROM memories WHERE LOWER(content) LIKE ? ${projectId ? 'AND (project_id = ? OR project_id IS NULL)' : ''}
       ORDER BY importance DESC, updated_at DESC LIMIT 50`,
      projectId ? [like, projectId] : [like],
    );
    return rows.map((r) => this.map(r));
  }

  countByCategory(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const row of this.db.all<{ category: string; c: number }>(
      'SELECT category, COUNT(*) AS c FROM memories GROUP BY category',
    )) {
      out[row.category] = Number(row.c);
    }
    return out;
  }
}
