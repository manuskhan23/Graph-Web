/**
 * Centralised configuration. Nothing in NEXUS reads `process.env` outside this
 * module, which keeps configuration auditable in one place.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface NexusConfig {
  port: number;
  host: string;
  /** Where SQLite + artifacts live (snapshots, screenshots, indexes). */
  dataDir: string;
  dbPath: string;
  /** When set, MongoDB is used instead of SQLite. */
  mongodbUri: string | null;
  artifactDir: string;
  logDir: string;
  /** Exact origins allowed to call the API (no wildcards). */
  allowedOrigins: string[];
  seedDemoProject: boolean;
  /** Register + index the repository checkout on first start. */
  seedDemo: boolean;
  limits: {
    maxToolCalls: number;
    maxDurationMs: number;
    maxRetriesPerStep: number;
    maxContextTokens: number;
    maxConcurrentTasks: number;
    maxFileBytes: number;
    maxUploadBytes: number;
  };
  retention: { snapshotDays: number; activityDays: number };
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultDataDir(): string {
  if (process.env.NEXUS_DATA_DIR) return resolve(process.env.NEXUS_DATA_DIR);
  return join(homedir(), '.nexus-ai');
}

const dataDir = defaultDataDir();

export const config: NexusConfig = {
  port: intEnv('NEXUS_PORT', 4400),
  host: process.env.NEXUS_HOST ?? '0.0.0.0',
  dataDir,
  get dbPath() {
    return join(dataDir, 'nexus.db');
  },
  get mongodbUri() {
    const uri = process.env.MONGODB_URI?.trim();
    return uri && uri.length > 0 ? uri : null;
  },
  get artifactDir() {
    return join(dataDir, 'artifacts');
  },
  get logDir() {
    return join(dataDir, 'logs');
  },
  // The sandbox preview proxy serves the UI from *.e2b.app and forwards API
  // calls relative to the same host, so we allow that pattern explicitly.
  allowedOrigins:
    process.env.NEXUS_ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
      'http://localhost:4400',
      'http://localhost:5173',
      'http://127.0.0.1:4400',
      'http://127.0.0.1:5173',
    ],
  seedDemoProject: process.env.NEXUS_SEED_DEMO === '1',
  seedDemo: process.env.NEXUS_SEED_DEMO === '1',
  limits: {
    maxToolCalls: intEnv('NEXUS_MAX_TOOL_CALLS', 24),
    maxDurationMs: intEnv('NEXUS_MAX_DURATION_MS', 5 * 60 * 1000),
    maxRetriesPerStep: intEnv('NEXUS_MAX_RETRIES', 2),
    maxContextTokens: intEnv('NEXUS_MAX_CONTEXT_TOKENS', 48_000),
    maxConcurrentTasks: intEnv('NEXUS_MAX_CONCURRENT_TASKS', 2),
    maxFileBytes: 2 * 1024 * 1024,
    maxUploadBytes: 12 * 1024 * 1024,
  },
  retention: { snapshotDays: 30, activityDays: 60 },
};

/** Directories never indexed, never snapshotted, never served. */
export const BUILTIN_IGNORE_GLOBS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.cache/**',
  '**/.venv/**',
  '**/__pycache__/**',
  '**/target/**',
  '**/vendor/**',
  '**/.turbo/**',
  '**/*.min.js',
  '**/*.min.css',
  '**/*.map',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  // secrets / environment — never indexed
  '**/.env',
  '**/.env.*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/id_rsa*',
  '**/.npmrc',
  '**/.netrc',
  '**/credentials.json',
  '**/serviceAccount*.json',
];

/** Binary / non-indexable extensions. */
export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.tiff', '.avif', '.svgz',
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.mp4', '.mov', '.avi', '.webm',
  '.zip', '.gz', '.tar', '.7z', '.rar', '.bz2', '.xz',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.jar', '.wasm', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.db', '.sqlite', '.sqlite3', '.pyc',
]);
