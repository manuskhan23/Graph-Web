/**
 * Database bootstrap: chooses the backend, exposes async stores.
 *
 * Backend selection happens in exactly one place:
 *   MONGODB_URI set  → MongoDB  (native async, needs network access)
 *   otherwise        → SQLite   (node:sqlite, local file, default)
 *
 * Both satisfy the contracts in `contracts.ts`, so nothing above this file knows
 * which one is running.
 */
import { config } from '../config.js';
import { createFileDriver, createMemoryDriver, type SqlDriver } from './driver.js';
import { runMigrations, currentVersion } from './migrations.js';
import type {
  ConversationStore,
  EmbeddingStore,
  MemoryStore,
  ObservabilityStore,
  ProjectStore,
  SnapshotStore,
  TaskStore,
  WorkflowStore,
} from './contracts.js';
import { SqliteConversationStore } from './sqlite/conversations.js';
import { SqliteMemoryStore } from './sqlite/memories.js';
import { SqliteObservabilityStore } from './sqlite/observability.js';
import { SqliteProjectStore } from './sqlite/projects.js';
import { SqliteSnapshotStore } from './sqlite/snapshots.js';
import { SqliteTaskStore } from './sqlite/tasks.js';
import { SqliteWorkflowStore } from './sqlite/workflows.js';
import { SqliteEmbeddingStore } from './sqlite/embeddings.js';
import { connectMongo, SCHEMA_VERSION as MONGO_SCHEMA_VERSION, type MongoHandle } from './mongo/client.js';
import { MongoProjectStore } from './mongo/projects.js';
import { MongoConversationStore } from './mongo/conversations.js';
import {
  MongoEmbeddingStore,
  MongoMemoryStore,
  MongoObservabilityStore,
  MongoSnapshotStore,
  MongoTaskStore,
  MongoWorkflowStore,
} from './mongo/documents.js';

export type StorageBackend = 'sqlite' | 'mongodb';

export interface Database {
  /** Which backend is live. Surfaced by /api/health so it is never a guess. */
  backend: StorageBackend;
  /** Human-readable location (file path or redacted URI). */
  location: string;
  /** Schema version of the live backend. */
  version: number;
  serverVersion: string | null;

  projects: ProjectStore;
  conversations: ConversationStore;
  tasks: TaskStore;
  snapshots: SnapshotStore;
  memories: MemoryStore;
  workflows: WorkflowStore;
  observability: ObservabilityStore;
  embeddings: EmbeddingStore;

  /** Raw SQL handle — only for the SQLite backend; null under MongoDB. */
  sql: SqlDriver | null;
  raw: MongoHandle | null;

  ping(): Promise<boolean>;
  close(): Promise<void>;
}

function buildSqlite(db: SqlDriver): Database {
  const migrated = runMigrations(db);
  if (migrated > 0) {
    console.log(`[nexus][storage] applied ${migrated} migration(s) → schema v${currentVersion(db)}`);
  }
  return {
    backend: 'sqlite',
    location: config.dbPath,
    version: currentVersion(db),
    serverVersion: null,
    projects: new SqliteProjectStore(db),
    conversations: new SqliteConversationStore(db),
    tasks: new SqliteTaskStore(db),
    snapshots: new SqliteSnapshotStore(db),
    memories: new SqliteMemoryStore(db),
    workflows: new SqliteWorkflowStore(db),
    observability: new SqliteObservabilityStore(db),
    embeddings: new SqliteEmbeddingStore(db),
    sql: db,
    raw: null,
    async ping() {
      return true;
    },
    async close() {
      db.close();
    },
  };
}

async function buildMongo(uri: string): Promise<Database> {
  const mongo = await connectMongo({
    uri,
    dbName: process.env.MONGODB_DB,
    prefix: process.env.MONGODB_COLLECTION_PREFIX,
  });
  const indexCount = await mongo.createIndexes();
  const serverVersion = await mongo.serverVersion();

  // The schema version marker keeps both backends reporting the same number.
  const meta = mongo.collection('schema_meta');
  await meta.updateOne(
    { _id: 'schema' },
    { $set: { version: MONGO_SCHEMA_VERSION, updatedAt: Date.now() } },
    { upsert: true },
  );

  console.log(
    `[nexus][storage] MongoDB backend · ${indexCount} indexes ensured · server ${serverVersion ?? 'unknown'}`,
  );

  return {
    backend: 'mongodb',
    location: (await import('./mongo/client.js')).redactUri(uri),
    version: MONGO_SCHEMA_VERSION,
    serverVersion,
    projects: new MongoProjectStore(mongo),
    conversations: new MongoConversationStore(mongo),
    tasks: new MongoTaskStore(mongo),
    snapshots: new MongoSnapshotStore(mongo),
    memories: new MongoMemoryStore(mongo),
    workflows: new MongoWorkflowStore(mongo),
    observability: new MongoObservabilityStore(mongo),
    embeddings: new MongoEmbeddingStore(mongo),
    sql: null,
    raw: mongo,
    ping: () => mongo.ping(),
    close: () => mongo.close(),
  };
}

let singleton: Database | null = null;

/**
 * Open the configured backend. Safe to call repeatedly: the first call wins and
 * is cached, which keeps the composition root and tests sharing one instance.
 */
export async function getDatabase(): Promise<Database> {
  if (singleton) return singleton;
  singleton = config.mongodbUri ? await buildMongo(config.mongodbUri) : buildSqlite(createFileDriver(config.dbPath));
  return singleton;
}

/** Isolated in-memory SQLite for tests. Never a Mongo instance — tests must not need a server. */
export async function createTestDatabase(): Promise<Database> {
  return buildSqlite(createMemoryDriver());
}

/** Close and forget the singleton (tests, shutdown, backend switching). */
export async function resetDatabase(): Promise<void> {
  if (!singleton) return;
  await singleton.close();
  singleton = null;
}
