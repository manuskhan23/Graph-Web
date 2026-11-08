/**
 * Database bootstrap: opens the driver, applies migrations, exposes repositories.
 * This is the only place the app decides *which* driver to use.
 */
import { existsSync } from 'node:fs';
import { config } from '../config.js';
import { createFileDriver, createMemoryDriver, type SqlDriver } from './driver.js';
import { runMigrations, currentVersion } from './migrations.js';
import { ProjectsRepository } from './repositories/projects.js';
import { ConversationsRepository } from './repositories/conversations.js';
import { TasksRepository } from './repositories/tasks.js';
import { SnapshotsRepository } from './repositories/snapshots.js';
import { MemoriesRepository } from './repositories/memories.js';
import { WorkflowsRepository } from './repositories/workflows.js';
import { ObservabilityRepository } from './repositories/observability.js';

export interface Database {
  db: SqlDriver;
  version: number;
  projects: ProjectsRepository;
  conversations: ConversationsRepository;
  tasks: TasksRepository;
  snapshots: SnapshotsRepository;
  memories: MemoriesRepository;
  workflows: WorkflowsRepository;
  observability: ObservabilityRepository;
  close(): void;
}

function build(db: SqlDriver): Database {
  const migrated = runMigrations(db);
  if (migrated > 0) {
    console.log(`[nexus][storage] applied ${migrated} migration(s) → schema v${currentVersion(db)}`);
  }
  return {
    db,
    version: currentVersion(db),
    projects: new ProjectsRepository(db),
    conversations: new ConversationsRepository(db),
    tasks: new TasksRepository(db),
    snapshots: new SnapshotsRepository(db),
    memories: new MemoriesRepository(db),
    workflows: new WorkflowsRepository(db),
    observability: new ObservabilityRepository(db),
    close: () => db.close(),
  };
}

let singleton: Database | null = null;

export function getDatabase(): Database {
  if (singleton) return singleton;
  singleton = build(createFileDriver(config.dbPath));
  return singleton;
}

export function createTestDatabase(): Database {
  return build(createMemoryDriver());
}

export function resetDatabaseForTests(): void {
  if (singleton) {
    singleton.close();
    singleton = null;
  }
}

export function databaseFileExists(): boolean {
  return existsSync(config.dbPath);
}
