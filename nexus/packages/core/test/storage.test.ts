import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../src/storage/db.js';
import { runMigrations, currentVersion, MIGRATIONS } from '../src/storage/migrations.js';
import { createMemoryDriver } from '../src/storage/driver.js';

// SQLite-only: the Mongo backend has no tables, but tests always run on the
// in-memory SQLite driver, so the schema is still the thing under test.
test('migrations create the full schema and are idempotent', async () => {
  const db = await createTestDatabase();
  const sql = db.sql;
  if (!sql) throw new Error('expected the SQLite test driver');
  assert.equal(db.version, MIGRATIONS[MIGRATIONS.length - 1]!.version);
  // re-running applies nothing
  const applied = runMigrations(sql);
  assert.equal(applied, 0);
  assert.equal(currentVersion(sql), db.version);
  // every expected table exists
  const tables = sql
    .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
    .map((r: { name: string }) => r.name);
  for (const expected of [
    'projects', 'project_files', 'file_chunks', 'embeddings', 'tasks', 'tool_executions',
    'file_snapshots', 'snapshot_files', 'memories', 'workflows', 'workflow_executions',
    'activity_logs', 'notifications', 'provider_usage', 'app_settings', 'audit_log',
  ]) {
    assert.ok(tables.includes(expected), `missing table ${expected}`);
  }
  void db.close();
});

test('projects repository enforces root uniqueness and cascades deletes', async () => {
  const db = await createTestDatabase();
  const project = await db.projects.create({ name: 'a', rootPath: '/tmp/x' });
  assert.equal((await db.projects.get(project.id))?.name, 'a');
  assert.rejects(async () => await db.projects.create({ name: 'b', rootPath: '/tmp/x' }));

  await db.projects.upsertFile(project.id, { relPath: 'src/a.ts', language: 'typescript', size: 10, hash: 'h1', lines: 2 });
  assert.equal(await db.projects.countFiles(project.id), 1);
  await db.projects.remove(project.id);
  assert.equal(await db.projects.countFiles(project.id), 0);
  void db.close();
});

test('memories keep an append-only revision history', async () => {
  const db = await createTestDatabase();
  const memory = await db.memories.create({ projectId: null, category: 'preference', content: 'Use tabs' });
  const updated = await db.memories.update(memory.id, { content: 'Use 2 spaces' });
  assert.equal(updated?.content, 'Use 2 spaces');
  assert.equal(updated?.revisions.length, 1);
  assert.equal(updated?.revisions[0]!.content, 'Use tabs');
  void db.close();
});

test('tasks repository round-trips plans and interrupted recovery', async () => {
  const db = await createTestDatabase();
  const task = await db.tasks.create({ projectId: null, title: 'Do a thing', status: 'running' });
  await db.tasks.update(task.id, {
    currentStepId: 's1',
    progress: 0.5,
    plan: [{ id: 's1', title: 'step', detail: '', toolId: null, toolInput: {}, dependsOn: [], verifyWith: null, status: 'completed', attempts: 1, result: null, error: null, startedAt: null, finishedAt: null }],
  });
  const reloaded = await db.tasks.get(task.id);
  assert.equal(reloaded?.plan.length, 1);
  assert.equal(await db.tasks.activeCount(), 1);
  assert.equal((await db.tasks.interrupted()).length, 1);
  assert.deepEqual(await db.tasks.completedStepIds(task.id), ['s1']);
  void db.close();
});

test('analytics return null instead of fabricating values when empty', async () => {
  const db = await createTestDatabase();
  const snapshot = await db.observability.analytics();
  assert.equal(snapshot.tasks.total, 0);
  assert.equal(snapshot.tasks.successRate, null);
  assert.equal(snapshot.tasks.avgDurationMs, null);
  assert.deepEqual(snapshot.providers, []);

  const task = await db.tasks.create({ projectId: null, title: 't' });
  await db.tasks.update(task.id, { status: 'completed', startedAt: 1000, finishedAt: 3000 });
  const withData = await db.observability.analytics();
  assert.equal(withData.tasks.total, 1);
  assert.equal(withData.tasks.successRate, 1);
  assert.equal(withData.tasks.avgDurationMs, 2000);
  void db.close();
});

test('storage driver transactions roll back on error', async () => {
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
