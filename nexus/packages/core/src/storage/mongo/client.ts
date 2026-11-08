/**
 * MongoDB connection layer.
 *
 * Selected when MONGODB_URI is set. The driver is loaded with a dynamic import so
 * a SQLite-only install never pays for a package it does not use.
 *
 * Design notes:
 *   - `_id` mirrors the application id (a string), so ids survive a SQLite → Mongo
 *     import unchanged and every lookup is a primary-key hit.
 *   - Documents are stored in the application's camelCase shape. The SQL
 *     snake_case → camelCase translation happened once, at the repository layer;
 *     no mapper layer is needed on top.
 *   - Timestamps stay epoch milliseconds (numbers), matching SQLite exactly so
 *     comparisons and ordering behave identically across both backends.
 */
import { NexusError } from '../../errors.js';

export interface MongoConfig {
  uri: string;
  /** Database name. Falls back to the path component of the URI, then 'nexus'. */
  dbName?: string;
  /** Collection name prefix, so several environments can share a cluster. */
  prefix?: string;
  serverSelectionTimeoutMs?: number;
}

type AnyDoc = Record<string, unknown>;

/** Minimal structural view of the driver, so we depend on behaviour not types. */
export interface Collection {
  findOne(filter: AnyDoc, options?: AnyDoc): Promise<AnyDoc | null>;
  find(filter: AnyDoc, options?: AnyDoc): { sort(spec: AnyDoc): { limit(n: number): { toArray(): Promise<AnyDoc[]> } }; limit(n: number): { toArray(): Promise<AnyDoc[]> }; toArray(): Promise<AnyDoc[]> };
  insertOne(doc: AnyDoc): Promise<{ insertedId: unknown }>;
  insertMany(docs: AnyDoc[]): Promise<unknown>;
  updateOne(filter: AnyDoc, update: AnyDoc, options?: AnyDoc): Promise<{ matchedCount: number; modifiedCount: number }>;
  updateMany(filter: AnyDoc, update: AnyDoc): Promise<{ modifiedCount: number }>;
  replaceOne(filter: AnyDoc, doc: AnyDoc, options?: AnyDoc): Promise<unknown>;
  deleteOne(filter: AnyDoc): Promise<{ deletedCount: number }>;
  deleteMany(filter: AnyDoc): Promise<{ deletedCount: number }>;
  countDocuments(filter?: AnyDoc): Promise<number>;
  aggregate(pipeline: AnyDoc[]): { toArray(): Promise<AnyDoc[]> };
  createIndex(spec: AnyDoc, options?: AnyDoc): Promise<string>;
  distinct(field: string, filter?: AnyDoc): Promise<unknown[]>;
}

export interface MongoHandle {
  collection(name: string): Collection;
  createIndexes(): Promise<number>;
  ping(): Promise<boolean>;
  serverVersion(): Promise<string | null>;
  close(): Promise<void>;
}

export interface CollectionSpec {
  name: string;
  indexes: { keys: Record<string, 1 | -1>; unique?: boolean; name?: string }[];
}

/**
 * Every collection the application uses. `createIndexes` is idempotent, so it runs
 * on each boot. Indexes here are the Mongo equivalent of the SQLite unique
 * constraints — without them, concurrent writes would race.
 */
export const COLLECTIONS: CollectionSpec[] = [
  { name: 'projects', indexes: [{ keys: { rootPath: 1 }, unique: true, name: 'uniq_root' }, { keys: { updatedAt: -1 } }] },
  {
    name: 'project_files',
    indexes: [
      { keys: { projectId: 1, relPath: 1 }, unique: true, name: 'uniq_project_path' },
      { keys: { projectId: 1, relPath: 1 } },
    ],
  },
  { name: 'index_runs', indexes: [{ keys: { projectId: 1, startedAt: -1 } }] },
  { name: 'file_chunks', indexes: [{ keys: { projectId: 1, relPath: 1 } }, { keys: { projectId: 1, startLine: 1 } }] },
  { name: 'embeddings', indexes: [{ keys: { chunkId: 1 }, unique: true, name: 'uniq_chunk' }, { keys: { projectId: 1 } }] },
  { name: 'conversations', indexes: [{ keys: { projectId: 1, updatedAt: -1 } }, { keys: { updatedAt: -1 } }] },
  { name: 'messages', indexes: [{ keys: { conversationId: 1, createdAt: 1 } }] },
  { name: 'tasks', indexes: [{ keys: { createdAt: -1 } }, { keys: { status: 1 } }, { keys: { projectId: 1 } }] },
  { name: 'agents', indexes: [{ keys: { role: 1 }, unique: true, name: 'uniq_role' }] },
  { name: 'approvals', indexes: [{ keys: { status: 1, createdAt: -1 } }, { keys: { taskId: 1 } }] },
  {
    name: 'file_snapshots',
    indexes: [{ keys: { projectId: 1, createdAt: -1 } }, { keys: { operationId: 1 } }, { keys: { createdAt: 1 } }],
  },
  { name: 'snapshot_files', indexes: [{ keys: { snapshotId: 1 } }, { keys: { hash: 1 } }, { keys: { blobPath: 1 } }] },
  { name: 'memories', indexes: [{ keys: { projectId: 1, importance: -1, updatedAt: -1 } }, { keys: { category: 1 } }] },
  { name: 'workflows', indexes: [{ keys: { updatedAt: -1 } }] },
  { name: 'workflow_executions', indexes: [{ keys: { workflowId: 1, startedAt: -1 } }, { keys: { startedAt: -1 } }] },
  { name: 'jobs', indexes: [{ keys: { updatedAt: -1 } }] },
  { name: 'app_settings', indexes: [{ keys: { key: 1 }, unique: true, name: 'uniq_key' }] },
  {
    name: 'activity_logs',
    indexes: [{ keys: { at: -1 } }, { keys: { kind: 1, at: -1 } }, { keys: { projectId: 1, at: -1 } }],
  },
  { name: 'notifications', indexes: [{ keys: { at: -1 } }, { keys: { read: 1 } }] },
  { name: 'tool_executions', indexes: [{ keys: { taskId: 1, createdAt: -1 } }, { keys: { toolId: 1 } }] },
  { name: 'provider_usage', indexes: [{ keys: { createdAt: -1 } }, { keys: { provider: 1, modelId: 1 } }] },
  { name: 'audit_log', indexes: [{ keys: { at: -1 } }, { keys: { actor: 1, at: -1 } }] },
  { name: 'schema_meta', indexes: [] },
];

export const SCHEMA_VERSION = 2;

function databaseFromUri(uri: string): string {
  try {
    // mongodb://host:port/dbname?opts — no URL() because mongodb+srv needs it too
    const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, '');
    const afterHost = withoutScheme.slice(withoutScheme.indexOf('/') + 1);
    const name = afterHost.split('?')[0];
    return name.length > 0 ? name : 'nexus';
  } catch {
    return 'nexus';
  }
}

export async function connectMongo(config: MongoConfig): Promise<MongoHandle> {
  const { uri } = config;
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new NexusError('STORAGE_ERROR', 'MONGODB_URI must start with mongodb:// or mongodb+srv://');
  }

  const dbName = config.dbName ?? databaseFromUri(uri);
  const prefix = config.prefix ?? '';
  const timeout = config.serverSelectionTimeoutMs ?? 8000;

  let MongoClientCtor: new (uri: string, options?: AnyDoc) => {
    connect(): Promise<void>;
    db(name: string): { collection(n: string): Collection; command(cmd: AnyDoc): Promise<AnyDoc>; admin(): { serverInfo(): Promise<AnyDoc> } };
    close(): Promise<void>;
  };

  try {
    ({ MongoClient: MongoClientCtor } = (await import('mongodb')) as unknown as {
      MongoClient: typeof MongoClientCtor;
    });
  } catch (err) {
    throw new NexusError(
      'STORAGE_ERROR',
      'MONGODB_URI is set but the "mongodb" package is not installed. Run: npm install mongodb',
      { cause: err },
    );
  }

  const client = new MongoClientCtor(uri, {
    serverSelectionTimeoutMS: timeout,
    // Fail fast instead of buffering writes forever when the server is down.
    retryWrites: true,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new NexusError(
      'STORAGE_ERROR',
      `Cannot reach MongoDB at ${redactUri(uri)}. Check MONGODB_URI, the server status and any IP allow-list.`,
      { cause: err },
    );
  }

  const database = client.db(dbName);
  let version: string | null = null;

  return {
    collection(name: string): Collection {
      return database.collection(`${prefix}${name}`);
    },
    async createIndexes(): Promise<number> {
      let created = 0;
      for (const spec of COLLECTIONS) {
        const target = database.collection(`${prefix}${spec.name}`);
        for (const index of spec.indexes) {
          await target.createIndex(index.keys, {
            ...(index.unique ? { unique: true } : {}),
            ...(index.name ? { name: index.name } : {}),
          });
          created += 1;
        }
      }
      return created;
    },
    async ping(): Promise<boolean> {
      try {
        await database.command({ ping: 1 });
        return true;
      } catch {
        return false;
      }
    },
    async serverVersion(): Promise<string | null> {
      if (version) return version;
      try {
        const info = await database.admin().serverInfo();
        version = typeof info.version === 'string' ? info.version : null;
        return version;
      } catch {
        return null;
      }
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}

/** Never let a credential reach a log line. */
export function redactUri(uri: string): string {
  return uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
