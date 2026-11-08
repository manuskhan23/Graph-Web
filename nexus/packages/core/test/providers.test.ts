import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase } from '../src/storage/db.js';
import { SettingsService } from '../src/settings/service.js';
import { ModelRouter, classifyComplexity } from '../src/providers/router.js';
import { GeminiProvider } from '../src/providers/gemini.js';
import { GroqProvider } from '../src/providers/groq.js';
import { MockProvider } from './mocks.js';
import { NexusError } from '../src/errors.js';
import { EventBus } from '../src/events/bus.js';

async function setup(configured: { gemini?: boolean; groq?: boolean } = {}) {
  const db = await createTestDatabase();
  const settings = new SettingsService(db.observability);
  const gemini = new MockProvider('gemini', {}, configured.gemini ?? true);
  const groq = new MockProvider('groq', {}, configured.groq ?? true);
  const router = new ModelRouter({
    settings,
    observability: db.observability,
    getKey: (provider) => (configured[provider] === false ? null : `fake-${provider}`),
    events: new EventBus(),
    providers: { gemini, groq },
  });
  return { db, settings, router, gemini, groq };
}

test('complex reasoning routes to Gemini, trivial work to Groq', async () => {
  const { router } = await setup();
  const complex = router.decide({ capability: 'text', complexity: 'complex', purpose: 'plan' });
  assert.equal(complex.provider, 'gemini');

  const trivial = router.decide({ capability: 'text', complexity: 'trivial', prefersLowLatency: true, purpose: 'classify' });
  assert.equal(trivial.provider, 'groq');
});

test('vision always routes to Gemini and fails loudly if unavailable', async () => {
  const { router } = await setup();
  const vision = router.decide({ capability: 'vision', purpose: 'vision' });
  assert.equal(vision.provider, 'gemini');
  assert.equal(vision.modelId, 'gemini-3.8-flash');

  // Groq declares no vision-capable model, so requesting vision must fail
  // rather than silently sending an image to a text-only model.
  const { router: onlyGroq } = await setup({ gemini: false });
  assert.throws(
    () => onlyGroq.decide({ capability: 'vision', purpose: 'vision' }),
    (err: unknown) => err instanceof NexusError && err.code === 'PROVIDER_NOT_CONFIGURED',
  );
});

test('fallback is only offered when the other provider declares the capability', async () => {
  const { router } = await setup();
  const textRoute = router.decide({ capability: 'text', complexity: 'complex', purpose: 'plan' });
  assert.equal(textRoute.fallback?.provider, 'groq');
  assert.equal(textRoute.fallback?.modelId, 'openai/gpt-oss-120b');
  // ...but groq cannot do vision or embeddings, so no fallback exists.
  const visionRoute = router.decide({ capability: 'vision', purpose: 'vision' });
  assert.equal(visionRoute.fallback, null);
});

test('privacy policy blocks cross-provider transfer when fallback is disabled', async () => {
  const { settings, router } = await setup();
  await settings.update({ ai: { allowCrossProviderFallback: false } });
  const decision = router.decide({ capability: 'text', complexity: 'complex', containsProjectData: true, purpose: 'chat' });
  assert.equal(decision.fallback, null);
});

test('router records provider usage with the correct source label', async () => {
  const { db, router } = await setup();
  await router.complete(
    { messages: [{ role: 'user', content: 'hi' }], purpose: 'chat' },
    { capability: 'text', complexity: 'complex', purpose: 'chat' },
  );
  const usage = await db.observability.usage();
  assert.equal(usage.length, 1);
  assert.equal(usage[0]!.provider, 'gemini');
  assert.equal(usage[0]!.tokensSource, 'provider');
  assert.ok(usage[0]!.ok);
  void db.close();
});

test('fallback executes when the primary provider throws', async () => {
  const db = await createTestDatabase();
  const settings = new SettingsService(db.observability);
  const events = new EventBus();
  const seen: string[] = [];
  events.on((e) => seen.push(e.type));
  const router = new ModelRouter({
    settings,
    observability: db.observability,
    getKey: () => 'fake',
    events,
    providers: {
      gemini: new MockProvider('gemini', { chat: () => { throw new Error('gemini down'); } }),
      groq: new MockProvider('groq', { chat: 'groq answer' }),
    },
  });
  // Force gemini first.
  const result = await router.complete(
    { messages: [{ role: 'user', content: 'hi' }], purpose: 'chat' },
    { capability: 'text', complexity: 'complex', purpose: 'chat' },
  );
  assert.equal(result.provider, 'groq');
  assert.equal(result.text, 'groq answer');
  assert.ok(seen.includes('provider.fallback'));
  const failures = (await db.observability.usage()).filter((u) => !u.ok);
  assert.equal(failures.length, 1);
  void db.close();
});

test('no configured provider surfaces a structured error', async () => {
  const { router } = await setup({ gemini: false, groq: false });
  await assert.rejects(
    () =>
      router.complete(
        { messages: [{ role: 'user', content: 'hi' }], purpose: 'chat' },
        { capability: 'text', complexity: 'complex', purpose: 'chat' },
      ),
    (err: unknown) => err instanceof NexusError && err.code === 'PROVIDER_NOT_CONFIGURED',
  );
});

test('gemini provider parses text, tool calls and usage from the REST payload', async () => {
  const calls: { url: string; body: unknown }[] = [];
  const provider = new GeminiProvider(
    () => 'test-key',
    async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Here is a plan. ' },
                  { functionCall: { name: 'file.read', args: { relPath: 'src/a.ts' } } },
                ],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  );
  const result = await provider.complete({
    system: 'be good',
    messages: [{ role: 'user', content: 'read the file' }],
    purpose: 'agent',
    tools: [{ name: 'file.read', description: 'read', parameters: { type: 'object' } }],
  });
  assert.equal(result.text, 'Here is a plan. ');
  assert.equal(result.toolCalls[0]!.name, 'file.read');
  assert.deepEqual(result.toolCalls[0]!.arguments, { relPath: 'src/a.ts' });
  assert.equal(result.usage.inputTokens, 120);
  assert.equal(result.usage.source, 'provider');
  const body = calls[0]!.body as { systemInstruction: unknown; tools: unknown[] };
  assert.ok(body.systemInstruction);
  assert.equal(body.tools.length, 1);
  assert.match(calls[0]!.url, /models\/gemini-3\.8-flash:generateContent/);
});

test('gemini rejects vision requests for a non-vision model before any HTTP call', async () => {
  let called = false;
  const provider = new GeminiProvider(
    () => 'k',
    async () => {
      called = true;
      return new Response('{}', { status: 200 });
    },
  );
  await assert.rejects(
    () =>
      provider.complete({
        model: 'gemini-embedding-001',
        messages: [{ role: 'user', content: [{ type: 'image', data: 'abc', mimeType: 'image/png' }] }],
        purpose: 'vision',
      }),
    (err: unknown) => err instanceof NexusError,
  );
  assert.equal(called, false);
});

test('groq maps 429 to a retryable rate-limit error', async () => {
  const provider = new GroqProvider(
    () => 'k',
    async () =>
      new Response(JSON.stringify({ error: { message: 'slow down' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
  );
  await assert.rejects(
    () => provider.complete({ messages: [{ role: 'user', content: 'hi' }], purpose: 'chat' }),
    (err: unknown) => err instanceof NexusError && err.code === 'PROVIDER_RATE_LIMITED' && err.retryable,
  );
});

test('groq parses completion and tool call arguments', async () => {
  const provider = new GroqProvider(
    () => 'k',
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: 'done',
                tool_calls: [{ id: 'c1', function: { name: 'file.search', arguments: '{"query":"auth"}' } }],
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
  const result = await provider.complete({ messages: [{ role: 'user', content: 'hi' }], purpose: 'chat' });
  assert.equal(result.text, 'done');
  assert.deepEqual(result.toolCalls[0]!.arguments, { query: 'auth' });
  assert.equal(result.usage.outputTokens, 5);
});

test('complexity classifier scales with request size and multi-step signals', async () => {
  assert.equal(classifyComplexity('hi'), 'trivial');
  assert.equal(classifyComplexity('explain this function please'), 'trivial');
  assert.equal(
    classifyComplexity('explain how the authentication middleware validates the session token and where it is mounted'),
    'simple',
  );
  assert.equal(
    classifyComplexity('Add Google authentication to the existing app, refactor the user model, integrate tests and plan the migration'),
    'complex',
  );
});
