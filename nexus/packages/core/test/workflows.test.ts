import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, type TempProject } from './fixtures.js';
import { createApp } from '../src/app.js';
import { EventBus } from '../src/events/bus.js';
import { MockProvider } from './mocks.js';
import { evaluateCondition, builtinTemplates } from '../src/workflows/engine.js';

async function appFor(project: TempProject) {
  return createApp({
    test: true,
    db: project.db,
    events: new EventBus(),
    providers: { gemini: new MockProvider('gemini', {}, false), groq: new MockProvider('groq', {}, false) },
  });
}

test('workflow executes a linear chain and records every block', async () => {
  const project = await makeProject({ 'src/a.ts': 'export const a = 1;\n' });
  const app = await appFor(project);
  await app.indexer.index(project.projectId);

  const workflow = await app.db.workflows.create({
    name: 'scan then list',
    projectId: project.projectId,
    blocks: [
      { id: 'b1', type: 'file', label: 'scan', config: { toolId: 'project.scan', input: {} }, next: 'b2', onFalse: null },
      { id: 'b2', type: 'terminal', label: 'echo', config: { command: 'echo workflow-ok' }, next: 'b3', onFalse: null },
      { id: 'b3', type: 'transform', label: 'collect', config: { value: '{{lastCommand.output}}', variable: 'out' }, next: null, onFalse: null },
    ],
    entry: 'b1',
  });

  const execution = await app.workflows.run({ workflowId: workflow.id, projectId: project.projectId });
  assert.equal(execution.status, 'completed');
  assert.equal(execution.log.length, 3);
  assert.ok(execution.log.every((l) => l.status === 'success'));
  assert.ok(execution.finishedAt);
  project.cleanup();
});

test('a failing block stops the workflow with an error', async () => {
  const project = await makeProject({});
  const app = await appFor(project);
  const workflow = await app.db.workflows.create({
    name: 'failing',
    projectId: project.projectId,
    blocks: [
      { id: 'x', type: 'terminal', label: 'fail', config: { command: 'node -e "process.exit(2)"' }, next: null, onFalse: null },
    ],
    entry: 'x',
  });
  const execution = await app.workflows.run({ workflowId: workflow.id, projectId: project.projectId });
  assert.equal(execution.status, 'failed');
  assert.ok(execution.error);
  project.cleanup();
});

test('condition blocks route to onFalse when the expression is false', async () => {
  const project = await makeProject({});
  const app = await appFor(project);
  const workflow = await app.db.workflows.create({
    name: 'branching',
    projectId: project.projectId,
    blocks: [
      { id: 'cond', type: 'condition', label: 'check', config: { expression: 'lastCommand.output contains "impossible"' }, next: 'yes', onFalse: 'no' },
      { id: 'yes', type: 'transform', label: 'yes', config: { value: 'took true branch', variable: 'branch' }, next: null, onFalse: null },
      { id: 'no', type: 'transform', label: 'no', config: { value: 'took false branch', variable: 'branch' }, next: null, onFalse: null },
    ],
    entry: 'cond',
  });
  const execution = await app.workflows.run({ workflowId: workflow.id, projectId: project.projectId });
  assert.equal(execution.status, 'completed');
  assert.ok(execution.log.some((l) => l.blockId === 'no'));
  assert.ok(!execution.log.some((l) => l.blockId === 'yes'));
  project.cleanup();
});

test('workflow can be paused and resumed from its cursor', async () => {
  const project = await makeProject({});
  const app = await appFor(project);
  const workflow = await app.db.workflows.create({
    name: 'pausable',
    projectId: project.projectId,
    blocks: [
      { id: 'd1', type: 'delay', label: 'wait 1', config: { ms: 10 }, next: 'd2', onFalse: null },
      { id: 'd2', type: 'delay', label: 'wait 2', config: { ms: 10 }, next: 'd3', onFalse: null },
      { id: 'd3', type: 'delay', label: 'wait 3', config: { ms: 10 }, next: null, onFalse: null },
    ],
    entry: 'd1',
  });
  // Pause after the first block has run.
  // Deliberately not awaited: the run must still be in flight when we pause it.
  const runPromise = app.workflows.run({ workflowId: workflow.id, projectId: project.projectId });
  let pending = (await project.db.workflows.allExecutions(1))[0];
  // The execution row is written asynchronously; wait for it to appear.
  for (let i = 0; i < 50 && !pending; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    pending = (await project.db.workflows.allExecutions(1))[0];
  }
  assert.ok(pending, 'execution row was never persisted');
  await app.workflows.pause(pending.id);
  const paused = await runPromise;
  assert.equal(paused.status, 'paused');
  assert.ok(paused.cursor);

  const resumed = await app.workflows.resume(paused.id);
  assert.equal(resumed.status, 'completed');
  project.cleanup();
});

test('a cycle of blocks is bounded by the block execution limit', async () => {
  const project = await makeProject({});
  const app = await appFor(project);
  const workflow = await app.db.workflows.create({
    name: 'loop',
    projectId: project.projectId,
    blocks: [
      { id: 'a', type: 'delay', label: 'a', config: { ms: 1 }, next: 'b', onFalse: null },
      { id: 'b', type: 'delay', label: 'b', config: { ms: 1 }, next: 'a', onFalse: null },
    ],
    entry: 'a',
  });
  const execution = await app.workflows.run({ workflowId: workflow.id, projectId: project.projectId, maxBlocks: 6 });
  assert.equal(execution.status, 'failed');
  assert.match(execution.error ?? '', /exceeded 6 block/);
  project.cleanup();
});

test('condition evaluator supports comparisons without eval', async () => {
  const vars = { count: 3, text: 'hello world', nested: { value: 10 }, flag: true };
  assert.equal(evaluateCondition('count > 2', vars), true);
  assert.equal(evaluateCondition('count < 2', vars), false);
  assert.equal(evaluateCondition('count >= 3', vars), true);
  assert.equal(evaluateCondition('count == 3', vars), true);
  assert.equal(evaluateCondition('count != 3', vars), false);
  assert.equal(evaluateCondition('text contains "world"', vars), true);
  assert.equal(evaluateCondition('text startsWith "hell"', vars), true);
  assert.equal(evaluateCondition('nested.value == 10', vars), true);
  assert.equal(evaluateCondition('flag', vars), true);
  assert.equal(evaluateCondition('missing', vars), false);
  // Injection attempts are inert.
  assert.equal(evaluateCondition('process.exit(1)', vars), false);
  assert.equal(evaluateCondition('require("fs")', vars), false);
});

test('builtin templates are real, connected definitions', async () => {
  const templates = builtinTemplates(null);
  assert.equal(templates.length, 3);
  for (const template of templates) {
    assert.ok(template.blocks.length > 0);
    assert.ok(template.entry);
    const ids = new Set(template.blocks.map((b) => b.id));
    assert.ok(ids.has(template.entry!));
    for (const block of template.blocks) {
      if (block.next) assert.ok(ids.has(block.next), `${template.name}: dangling next ${block.next}`);
      if (block.onFalse) assert.ok(ids.has(block.onFalse), `${template.name}: dangling onFalse ${block.onFalse}`);
    }
  }
});
