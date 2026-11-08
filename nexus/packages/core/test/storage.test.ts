import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../src/storage/db.js';
import { runMigrations, currentVersion, MIGRATIONS } from '../src/storage/migrations.js';
import { createMemoryDriver } from '../src/storage/driver.js';

test('migrations create the full schema and are idempotent', () => {
  const db = createTestDatabase();
  assert.equal(db.version, MIGRATIONS[MIGRATIONS.length - 1]!.version);
  // re-running applies nothing
  const applied = runMigrations(db.db);
  assert.equal(applied, 0);
  assert.equal(currentVersion(db.db), db.version);
  // every expected table exists
  const tables = db.db
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map((r) => r.name);
  for (const expected of [
    'projects', 'project_files', 'file_chunks', 'embeddings', 'tasks', 'tool_executions',
    'file_snapshots', 'snapshot_files', 'memories', 'workflows', 'workflow_executions',
    'activity_logs', 'notifications', 'provider_usage', 'app_settings', 'audit_log',
  ]) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
  db.close();
});

test('projects repository enforces root uniqueness and cascades deletes', () => {
  const db = createTestDatabase();
  const project = db.projects.create({ name: 'a', rootPath: '/tmp/x' });
  assert.equal(db.projects.get(project.id)?.name, 'a');
  assert.throws(() => db.projects.create({ name: 'b', rootPath: '/tmp/x' }));

  db.projects.upsertFile(project.id, { relPath: 'src/a.ts', language: 'typescript', size: 10, hash: 'h1', lines: 2 });
  assert.equal(db.projects.countFiles(project.id), 1);
  db.projects.remove(project.id);
  assert.equal(db.projects.countFiles(project.id), 0);
  db.close();
});

test('memories keep an append-only revision history', () => {
  const db = createTestDatabase();
  const memory = db.memories.create({ projectId: null, category: 'preference', content: 'Use tabs' });
  const updated = db.memories.update(memory.id, { content: 'Use 2 spaces' });
  assert.equal(updated?.content, 'Use 2 spaces');
  assert.equal(updated?.revisions.length, 1);
  assert.equal(updated?.revisions[0]!.content, 'Use tabs');
  db.close();
});

test('tasks repository round-trips plans and interrupted recovery', () => {
  const db = createTestDatabase();
  const task = db.tasks.create({ projectId: null, title: 'Do a thing', status: 'running' });
  db.tasks.update(task.id, {
    currentStepId: 's1',
    progress: 0.5,
    plan: [{ id: 's1', title: 'step', detail: '', toolId: null, toolInput: {}, dependsOn: [], verifyWith: null, status: 'completed', attempts: 1, result: null, error: null, startedAt: null, finishedAt: null }],
  });
  const reloaded = db.tasks.get(task.id);
  assert.equal(reloaded?.plan.length, 1);
  assert.equal(db.tasks.activeCount(), 1);
  assert.equal(db.tasks.interrupted().length, 1);
  assert.deepEqual(db.tasks.completedStepIds(task.id), ['s1']);
  db.close();
});

test('analytics return null instead of fabricating values when empty', () => {
  const db = createTestDatabase();
  const snapshot = db.observability.analytics();
  assert.equal(snapshot.tasks.total, 0);
  assert.equal(snapshot.tasks.successRate, null);
  assert.equal(snapshot.tasks.avgDurationMs, null);
  assert.deepEqual(snapshot.providers, []);

  const task = db.tasks.create({ projectId: null, title: 't' });
  db.tasks.update(task.id, { status: 'completed', startedAt: 1000, finishedAt: 3000 });
  const withData = db.observability.analytics();
  assert.equal(withData.tasks.total, 1);
  assert.equal(withData.tasks.successRate, 1);
  assert.equal(withData.tasks.avgDurationMs, 2000);
  db.close();
});

test('storage driver transactions roll back on error', () => {
  const driver = createMemoryDriver();
  driver.exec('CREATE TABLE t (a INTEGER)');
  assert.throws(() =>
    driver.transaction(() => {
      driver.run('INSERT INTO t VALUES (1)');
      throw new Error('boom');
    }),
  );
  assert.equal(driver.all('SELECT * FROM t').length, 0);
  driver.close();
});
