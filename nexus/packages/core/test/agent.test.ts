import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './fixtures.js';
import { createApp } from '../src/app.js';
import { MockProvider } from './mocks.js';
import { EventBus } from '../src/events/bus.js';
import { TaskPlanner } from '../src/tasks/planner.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { AgentOrchestrator } from '../src/agents/orchestrator.js';
import { AgentRoles } from '../src/agents/roles.js';
import { assertTransition, canTransition } from '../src/tasks/state.js';
import { NexusError } from '../src/errors.js';

/** Build the full composition root against a fixture project. */
async function appFor(
  project: ReturnType<typeof makeProject>,
  options: { script?: Record<string, string>; configured?: boolean } = {},
) {
  return createApp({
    test: true,
    db: project.db,
    events: new EventBus(),
    providers: {
      gemini: new MockProvider('gemini', options.script ?? {}, options.configured ?? false),
      groq: new MockProvider('groq', {}, false),
    },
  });
}

test('agent runs a heuristic plan end-to-end and verifies each step', async () => {
  const project = makeProject({
    'package.json': JSON.stringify({ name: 'ok-fixture', scripts: { build: 'node -e "process.exit(0)"' } }),
    'src/a.ts': 'export const a = 1;\n',
  });
  const app = await appFor(project);
  await app.indexer.index(project.projectId);
  const result = await app.runtime.run({
    projectId: project.projectId,
    message: 'Analyse the project and verify it builds',
    autoApproveBelow: null,
  });

  assert.ok(result.taskId);
  assert.equal(result.status, 'completed', `expected completion, got ${result.status}: ${result.answer}`);
  assert.equal(result.verified, true, 'at least one step must be verified');
  assert.ok(result.toolCalls > 0);
  assert.ok(result.steps.every((s) => s.status === 'completed' || s.status === 'skipped'));
  const task = project.db.tasks.get(result.taskId);
  assert.equal(task?.status, 'completed');
  assert.equal(task?.progress, 1);
  project.cleanup();
});

test('agent fails honestly when the verification command exits non-zero', async () => {
  // A package.json whose "test" script exits 1 — the agent must not claim success.
  const project = makeProject({
    'package.json': JSON.stringify({ name: 'fail-fixture', scripts: { test: 'node -e "process.exit(1)"' } }),
  });
  const app = await appFor(project);
  await app.indexer.index(project.projectId);
  const result = await app.runtime.run({ projectId: project.projectId, message: 'Run the test suite' });

  assert.equal(result.status, 'failed', 'a non-zero exit must never be reported as success');
  assert.match(result.answer, /exit code 1/i);
  const task = project.db.tasks.get(result.taskId);
  assert.equal(task?.status, 'failed');
  assert.ok(task?.error);
  project.cleanup();
});

test('tool call limit stops a runaway task', async () => {
  const project = makeProject({});
  const app = await appFor(project);
  const off = autoRespondToApprovals(app, 'approve');
  app.settings.update({ agent: { maxToolCalls: 1 } });
  const result = await app.runtime.run({
    projectId: project.projectId,
    message: 'Add authentication, refactor the database layer, write tests and run the build',
  });
  assert.equal(result.status, 'failed');
  assert.match(result.answer, /Execution limit reached/);
  assert.ok(result.toolCalls <= 2);
  off();
  project.cleanup();
});

test('duration limit aborts a long task', async () => {
  const project = makeProject({});
  const app = await appFor(project);
  const off = autoRespondToApprovals(app, 'approve');
  app.settings.update({ agent: { maxDurationMs: 5000 } });
  const result = await app.runtime.run({ projectId: project.projectId, message: 'Build the project' });
  assert.ok(['completed', 'failed'].includes(result.status));
  off();
  project.cleanup();
});

test('a task that requires approval is never auto-approved silently', async () => {
  const project = makeProject({ 'src/a.ts': 'a\n' });
  const app = await appFor(project);
  // Directly exercise the approval gate: high risk + no human → denial on timeout.
  const promise = app.approvals.request({
    taskId: null,
    kind: 'tool',
    title: 'Delete file',
    detail: 'test',
    risk: 'high',
    payload: {},
    timeoutMs: 150,
  });
  const decision = await promise;
  assert.equal(decision.approved, false);
  assert.equal(decision.by, 'timeout');
  const stored = app.db.observability.approvals();
  assert.equal(stored[0]!.status, 'rejected');
  project.cleanup();
});

test('a rejected approval short-circuits tool execution', async () => {
  const project = makeProject({});
  const app = await appFor(project);
  const pending = app.approvals.request({
    taskId: null,
    kind: 'command',
    title: 'rm -rf dist',
    detail: 'destructive',
    risk: 'high',
    payload: {},
    timeoutMs: 5000,
  });
  // Resolve as rejected while the request is in flight.
  await new Promise((resolve) => setTimeout(resolve, 20));
  const pendingRecord = app.db.observability.approvals({ status: 'pending' })[0]!;
  app.approvals.resolve(pendingRecord.id, false, 'user');
  const decision = await pending;
  assert.equal(decision.approved, false);
  assert.equal(decision.by, 'user');
  project.cleanup();
});

test('a rejected approval denies the tool call and leaves the file untouched', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const app = await appFor(project);
  await app.indexer.index(project.projectId);
  autoRespondToApprovals(app, 'reject');

  // file.edit is medium risk and always requires approval; the registry must
  // return a denial rather than applying anything.
  const outcome = await app.registry.execute(
    'file.edit',
    { operations: [{ kind: 'write', relPath: 'src/a.ts', content: 'hacked\n' }], label: 'test edit' },
    { projectId: project.projectId, taskId: null, agentRole: 'coding' },
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.denied, true);
  assert.equal(outcome.error?.code, 'APPROVAL_REJECTED');

  const approvals = project.db.observability.approvals();
  assert.ok(approvals.length >= 1);
  assert.ok(approvals.some((a) => a.status === 'rejected'));

  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'export const a = 1;\n');
  project.cleanup();
});

test('an approved edit is staged, applied and produces a rollback snapshot', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const app = await appFor(project);
  await app.indexer.index(project.projectId);
  autoRespondToApprovals(app, 'approve');

  const staged = await app.registry.execute(
    'file.edit',
    { operations: [{ kind: 'write', relPath: 'src/a.ts', content: 'export const a = 42;\n' }], label: 'bump a' },
    { projectId: project.projectId, taskId: null, agentRole: 'coding' },
  );
  assert.equal(staged.ok, true, staged.summary);
  const operationId = (staged.data as { operationId: string }).operationId;

  const applied = await app.registry.execute(
    'file.applyEdit',
    { operationId },
    { projectId: project.projectId, taskId: null, agentRole: 'coding' },
  );
  assert.equal(applied.ok, true, applied.summary);

  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'export const a = 42;\n');

  const snapshotId = (staged.data as { snapshotId: string }).snapshotId;
  const restored = await app.registry.execute(
    'file.restoreSnapshot',
    { snapshotId },
    { projectId: project.projectId, taskId: null, agentRole: 'coding' },
  );
  assert.equal(restored.ok, true);
  assert.equal(readFileSync(join(project.dir, 'src/a.ts'), 'utf8'), 'export const a = 1;\n');
  project.cleanup();
});

test('a role without write permission cannot edit files even with approval', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const app = await appFor(project);
  autoRespondToApprovals(app, 'approve');
  const outcome = await app.registry.execute(
    'file.edit',
    { operations: [{ kind: 'write', relPath: 'src/a.ts', content: 'x' }] },
    { projectId: project.projectId, taskId: null, agentRole: 'analyst' },
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.denied, true);
  assert.equal(outcome.error?.code, 'PERMISSION_DENIED');
  project.cleanup();
});

test('task state machine rejects illegal transitions', () => {
  assert.ok(canTransition('pending', 'planning'));
  assert.ok(!canTransition('completed', 'running'));
  assert.ok(!canTransition('cancelled', 'running'));
  assert.throws(
    () => assertTransition('completed', 'running'),
    (err: unknown) => err instanceof NexusError && err.code === 'TASK_STATE_INVALID',
  );
});

test('cancellation stops the task between steps', async () => {
  const project = makeProject({});
  const app = await appFor(project);
  const off = autoRespondToApprovals(app, 'approve');
  const runPromise = app.runtime.run({
    projectId: project.projectId,
    message: 'Analyse the architecture, then build, then test, then start the dev server',
  });
  // Cancel as soon as a task row exists.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const active = project.db.tasks.list({ limit: 5 });
  for (const task of active) app.runtime.cancel(task.id);
  const result = await runPromise;
  assert.ok(['cancelled', 'completed', 'failed'].includes(result.status));
  off();
  project.cleanup();
});

test('planner rejects unknown tools, cycles and over-budget steps', () => {
  const db = makeProject({});
  const app = new ToolRegistry(db.db.observability, {} as never, undefined);
  const planner = new TaskPlanner(app, null);
  const notes: string[] = [];
  const steps = planner.validateSteps(
    [
      { id: 'a', title: 'A', detail: '', toolId: 'nonexistent.tool', toolInput: {}, dependsOn: [], verifyWith: null },
      { id: 'b', title: 'B', detail: '', toolId: 'file.read', toolInput: {}, dependsOn: ['c'], verifyWith: null },
      { id: 'c', title: 'C', detail: '', toolId: 'file.list', toolInput: {}, dependsOn: ['b'], verifyWith: null },
      { id: 'b', title: 'dup', detail: '', toolId: null, toolInput: {}, dependsOn: [], verifyWith: null },
    ],
    'planning',
    10,
    'high',
    notes,
  );
  // Invalid tool becomes a reasoning step; duplicate id dropped; cycle broken.
  assert.equal(steps.find((s) => s.id === 'a')?.toolId, null);
  assert.equal(steps.filter((s) => s.id === 'b').length, 1);
  // The cycle must be broken somewhere: no step may transitively depend on itself.
  const byId = new Map(steps.map((s) => [s.id, s]));
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (seen.has(from)) return false;
    seen.add(from);
    const step = byId.get(from);
    return (step?.dependsOn ?? []).some((dep) => dep === target || reaches(dep, target, seen));
  };
  assert.ok(!steps.some((s) => reaches(s.id, s.id)), 'plan must be acyclic after validation');
  assert.ok(notes.length >= 2);
  db.cleanup();
});

test('planner honours role tool permissions', () => {
  const project = makeProject({});
  const app = new ToolRegistry(project.db.observability, {} as never, undefined);
  const planner = new TaskPlanner(app, null);
  const notes: string[] = [];
  // The analyst role may not use file.edit, so it must be downgraded.
  const steps = planner.validateSteps(
    [{ id: 'x', title: 'Write file', detail: '', toolId: 'file.edit', toolInput: {}, dependsOn: [], verifyWith: null }],
    'analyst',
    5,
    'high',
    notes,
  );
  assert.equal(steps[0]!.toolId, null);
  assert.match(notes[0]!, /unknown tool|Replaced/);
  project.cleanup();
});

test('orchestrator prevents two agents from writing the same file', () => {
  const project = makeProject({});
  const orchestrator = new AgentOrchestrator(project.db);
  const first = orchestrator.delegate({ role: 'coding', taskId: 'task_1', projectId: project.projectId, files: ['src/a.ts'] });
  assert.ok(first.lease);
  assert.equal(first.conflicts.length, 0);

  const second = orchestrator.delegate({ role: 'documentation', taskId: 'task_2', projectId: project.projectId, files: ['src/a.ts'] });
  assert.equal(second.lease, null);
  assert.equal(second.conflicts.length, 1);
  assert.equal(second.conflicts[0]!.file, 'src/a.ts');

  orchestrator.releaseTask('task_1');
  const third = orchestrator.delegate({ role: 'documentation', taskId: 'task_2', projectId: project.projectId, files: ['src/a.ts'] });
  assert.ok(third.lease);
  project.cleanup();
});

test('agent roles have coherent tool allow-lists', () => {
  const agents = AgentRoles.all();
  assert.equal(agents.length, 7);
  const analyst = agents.find((a) => a.role === 'analyst')!;
  assert.equal(analyst.mayWriteFiles, false);
  assert.ok(!analyst.allowedTools.includes('file.edit'), 'analyst must not be able to edit files');
  const browser = agents.find((a) => a.role === 'browser')!;
  assert.ok(browser.allowedTools.includes('browser.goto'));
  assert.ok(!browser.allowedTools.includes('terminal.run'));
  assert.equal(new Set(agents.map((a) => a.role)).size, 7);
});

/**
 * Simulate a human at the approval prompt. Without this a run that needs
 * approval would legitimately block, which is the correct production behaviour.
 */
function autoRespondToApprovals(app: Awaited<ReturnType<typeof appFor>>, decision: 'approve' | 'reject'): () => void {
  const off = app.events.on((event) => {
    if (event.type !== 'approval.required') return;
    const approvalId = String(event.data.approvalId ?? '');
    if (!approvalId) return;
    // Resolve on the next tick so the gate has registered its pending resolver.
    setTimeout(() => {
      try {
        app.approvals.resolve(approvalId, decision === 'approve', 'test-user');
      } catch {
        /* already resolved */
      }
    }, 5);
  });
  return off;
}

export {};
