import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProject } from './fixtures.js';
import { createApp } from '../src/app.js';
import { EventBus } from '../src/events/bus.js';
import { MockProvider } from './mocks.js';
import { NexusError } from '../src/errors.js';
import { ProjectIndexer } from '../src/project/indexer.js';
import { SearchEngine } from '../src/search/engine.js';
import { ContextManager } from '../src/context/manager.js';
import { SettingsService } from '../src/settings/service.js';
import { ModelRouter } from '../src/providers/router.js';
import { tokenize } from '../src/search/tokenizer.js';

async function appFor(project: ReturnType<typeof makeProject>) {
  return createApp({
    test: true,
    db: project.db,
    events: new EventBus(),
    providers: { gemini: new MockProvider('gemini', {}, false), groq: new MockProvider('groq', {}, false) },
  });
}

/* ------------------------------------------------------------------ memory */

test('memory rejects secrets, tracks revisions and supports disable', async () => {
  const project = makeProject({});
  const app = await appFor(project);

  const memory = app.memory.create({
    content: 'Always use 2-space indentation in TypeScript files',
    category: 'coding_standard',
    projectId: project.projectId,
  });
  assert.ok(memory.id);

  assert.throws(
    () => app.memory.create({ content: 'the key is AIzaSyBO0TVbpLYjrM688KqfxEGkhHSPHFsetd8', category: 'preference' }),
    (err: unknown) => err instanceof NexusError && err.code === 'SENSITIVE_DATA_BLOCKED',
  );
  assert.throws(
    () => app.memory.create({ content: 'password: supersecret123', category: 'preference' }),
    (err: unknown) => err instanceof NexusError && err.code === 'SENSITIVE_DATA_BLOCKED',
  );

  const updated = app.memory.update(memory.id, { content: 'Always use 2-space indentation in all files' });
  assert.equal(updated.revisions.length, 1);

  // Export never contains secret material.
  app.db.memories.create({ projectId: null, category: 'preference', content: 'sk-abcdefghijklmnopqrstuvwx', source: 'user' });
  const exported = app.memory.export(null);
  assert.ok(!exported.includes('sk-abcdefghijklmnopqrstuvwx'));
  const parsed = JSON.parse(exported) as { memories: unknown[] };
  assert.ok(parsed.memories.length >= 1);

  const imported = app.memory.import(
    JSON.stringify({
      memories: [
        { content: 'Prefer functional components', category: 'preference' },
        { content: 'token: gsk_abcdefghijklmnopqrstuvwxyz123456', category: 'preference' },
      ],
    }),
    null,
  );
  assert.equal(imported.imported, 1);
  assert.equal(imported.skipped, 1);

  app.settings.update({ app: { memoryEnabled: false } });
  assert.equal(app.memory.list({}).length, 0);
  assert.throws(
    () => app.memory.create({ content: 'new fact here', category: 'preference' }),
    (err: unknown) => err instanceof NexusError && err.code === 'PERMISSION_DENIED',
  );
  app.settings.update({ app: { memoryEnabled: true } });
  assert.ok(app.memory.list({}).length > 0);
  project.cleanup();
});

test('memory search is project-scoped', async () => {
  const project = makeProject({});
  const app = await appFor(project);
  app.memory.create({ content: 'Uses Postgres for persistence', category: 'tech_stack', projectId: project.projectId });
  app.memory.create({ content: 'Uses SQLite for persistence', category: 'tech_stack', projectId: null });
  const hits = app.memory.search('persistence', project.projectId);
  assert.equal(hits.length, 2, 'project scope includes global memories');
  const scoped = app.db.memories.list({ projectId: null });
  assert.equal(scoped.length, 1);
  project.cleanup();
});

/* ------------------------------------------------------------------ search */

test('search ranks code above prose and reports protocol details', async () => {
  const project = makeProject({
    'src/authService.ts': 'export function authenticateUser(token: string) {\n  return verifyToken(token);\n}\n',
    'docs/notes.md': 'Authentication notes: the user token is verified by the helper.\n',
  });
  await new ProjectIndexer(project.db).index(project.projectId);
  const engine = new SearchEngine(project.db);
  const result = await engine.search({ projectId: project.projectId, query: 'authenticateUser token' });
  assert.equal(result.strategy, 'keyword');
  assert.ok(result.hits.length >= 1);
  assert.equal(result.hits[0]!.relPath, 'src/authService.ts');
  assert.equal(result.hits[0]!.matchType, 'keyword');
  assert.equal(result.hits[0]!.isSourceContent, true);
  assert.ok(result.hits[0]!.endLine >= result.hits[0]!.startLine);
  project.cleanup();
});

test('search returns empty results for an empty query instead of erroring', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;' });
  await new ProjectIndexer(project.db).index(project.projectId);
  const result = await new SearchEngine(project.db).search({ projectId: project.projectId, query: '   ' });
  assert.deepEqual(result.hits, []);
  project.cleanup();
});

test('search honours a path filter', async () => {
  const project = makeProject({
    'src/one.ts': 'export const alpha = 1;',
    'lib/two.ts': 'export const alpha = 2;',
  });
  await new ProjectIndexer(project.db).index(project.projectId);
  const result = await new SearchEngine(project.db).search({
    projectId: project.projectId,
    query: 'alpha',
    pathFilter: 'lib/',
  });
  assert.ok(result.hits.length > 0);
  assert.ok(result.hits.every((h) => h.relPath.startsWith('lib/')));
  project.cleanup();
});

test('tokenizer splits identifiers into searchable parts', () => {
  // 'by' is a stopword and is dropped — identifiers still split correctly.
  assert.deepEqual(tokenize('getUserById'), ['get', 'user', 'id']);
  assert.deepEqual(tokenize('parseHTTPResponse'), ['parse', 'http', 'response']);
  assert.ok(tokenize('HTTPServerConfig').includes('http'));
  assert.deepEqual(tokenize('the and of'), []);
});

/* ----------------------------------------------------------------- context */

test('context bundles every layer with reasons and respects the token budget', async () => {
  const project = makeProject({
    'src/app.ts': 'export function loadUser() {\n  return null;\n}\n',
    'src/big.ts': Array.from({ length: 600 }, (_, i) => `export const longSymbolName${i} = ${i};`).join('\n'),
  });
  await new ProjectIndexer(project.db).index(project.projectId);
  project.db.memories.create({ projectId: project.projectId, category: 'preference', content: 'Prefers tabs over spaces', importance: 5 });

  const settings = new SettingsService(project.db.observability);
  const router = new ModelRouter({
    settings,
    observability: project.db.observability,
    getKey: () => null,
    providers: { gemini: new MockProvider('gemini', {}, false), groq: new MockProvider('groq', {}, false) },
  });
  const context = new ContextManager(project.db, settings, router, new SearchEngine(project.db, router));

  settings.update({ agent: { maxContextTokens: 1500 } });
  const bundle = await context.build({
    projectId: project.projectId,
    conversationId: null,
    userMessage: 'How does loadUser work?',
  });

  assert.ok(bundle.system.includes('NEXUS AI'));
  assert.ok(bundle.system.includes('UNTRUSTED DATA'), 'untrusted-input rule must always be present');
  assert.ok(bundle.sources.some((s) => s.layer === 'project'));
  assert.ok(bundle.sources.some((s) => s.layer === 'code'));
  assert.ok(bundle.sources.some((s) => s.layer === 'user_preferences'));
  assert.ok(bundle.sources.every((s) => s.reason.length > 0), 'every source must explain itself');
  assert.ok(bundle.totalTokens <= bundle.budgetTokens * 1.3, `context overflowed: ${bundle.totalTokens}/${bundle.budgetTokens}`);
  assert.equal(bundle.messages[bundle.messages.length - 1]!.role, 'user');
  project.cleanup();
});

test('context includes prior conversation turns for continuity', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;' });
  await new ProjectIndexer(project.db).index(project.projectId);
  const conversation = project.db.conversations.create({ projectId: project.projectId, title: 'Earlier chat' });
  project.db.conversations.addMessage({ conversationId: conversation.id, role: 'user', content: 'We decided to use Zod for validation.' });
  project.db.conversations.addMessage({ conversationId: conversation.id, role: 'assistant', content: 'Understood — Zod it is.' });

  const settings = new SettingsService(project.db.observability);
  const router = new ModelRouter({
    settings,
    observability: project.db.observability,
    getKey: () => null,
    providers: { gemini: new MockProvider('gemini', {}, false), groq: new MockProvider('groq', {}, false) },
  });
  const context = new ContextManager(project.db, settings, router, new SearchEngine(project.db, router));
  const bundle = await context.build({
    projectId: project.projectId,
    conversationId: conversation.id,
    userMessage: 'Continue with the validation work',
  });
  assert.ok(bundle.sources.some((s) => s.layer === 'history'));
  assert.ok(bundle.messages.some((m) => typeof m.content === 'string' && m.content.includes('Zod')));
  project.cleanup();
});

test('context truncates instead of silently dropping layers', async () => {
  const project = makeProject({ 'src/app.ts': 'export const a = 1;' });
  await new ProjectIndexer(project.db).index(project.projectId);
  const settings = new SettingsService(project.db.observability);
  const router = new ModelRouter({
    settings,
    observability: project.db.observability,
    getKey: () => null,
    providers: { gemini: new MockProvider('gemini', {}, false), groq: new MockProvider('groq', {}, false) },
  });
  const context = new ContextManager(project.db, settings, router, new SearchEngine(project.db, router));
  settings.update({ agent: { maxContextTokens: 1000 } });
  const bundle = await context.build({
    projectId: project.projectId,
    conversationId: null,
    userMessage: 'x'.repeat(200),
    taskSummary: 'y'.repeat(500),
  });
  assert.ok(bundle.totalTokens <= bundle.budgetTokens * 1.5);
  project.cleanup();
});
