/**
 * Storage abstraction.
 *
 * Business logic never imports `node:sqlite` directly — it talks to the `SqlDriver`
 * interface. That makes it possible to swap in `better-sqlite3` (or a Postgres
 * driver) for distribution without touching repositories.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NexusError } from '../errors.js';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlRow = Record<string, SqlValue>;

export interface SqlDriver {
  exec(sql: string): void;
  all<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): T[];
  get<T extends SqlRow = SqlRow>(sql: string, params?: SqlValue[]): T | undefined;
  run(sql: string, params?: SqlValue[]): { changes: number; lastInsertRowid: number };
  close(): void;
  transaction<T>(fn: () => T): T;
}

/** Thin `node:sqlite` adapter (zero native build step, ships with Node 22+). */
export class NodeSqliteDriver implements SqlDriver {
  private db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA busy_timeout = 5000');
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  all<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): T[] {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }

  get<T extends SqlRow = SqlRow>(sql: string, params: SqlValue[] = []): T | undefined {
    return this.db.prepare(sql).get(...(params as never[])) as T | undefined;
  }

  run(sql: string, params: SqlValue[] = []): { changes: number; lastInsertRowid: number } {
    const res = this.db.prepare(sql).run(...(params as never[]));
    return {
      changes: Number(res.changes ?? 0),
      lastInsertRowid: Number(res.lastInsertRowid ?? 0),
    };
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (err) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }
}

/** In-memory driver for tests. */
export function createMemoryDriver(): SqlDriver {
  return new NodeSqliteDriver(':memory:');
}

export function createFileDriver(path: string): SqlDriver {
  try {
    return new NodeSqliteDriver(path);
  } catch (err) {
    throw new NexusError('STORAGE_ERROR', `Cannot open database at ${path}`, { cause: err });
  }
}

export function now(): number {
  return Date.now();
}

export function id(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function parseJson<T>(raw: SqlValue | undefined, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function boolInt(value: boolean): number {
  return value ? 1 : 0;
}
