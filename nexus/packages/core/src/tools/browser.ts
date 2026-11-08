/** Phase 7 tools — browser automation exposed to the agent. */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { BrowserManager } from '../browser/manager.js';
import { NexusError } from '../errors.js';

export function createBrowserTools(browser: BrowserManager): ToolDefinition<unknown, unknown>[] {
  const openBrowser: ToolDefinition<{ headless?: boolean }, unknown> = {
    descriptor: {
      id: 'browser.open',
      name: 'Open browser session',
      description:
        'Launch a new isolated browser session. Returns a sessionId used by the other browser tools. Never bypasses CAPTCHAs or site security.',
      risk: 'low',
      category: 'browser',
      timeoutMs: 60_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { headless: { type: 'boolean' } } },
      outputSchema: { type: 'object', properties: { sessionId: { type: 'string' } } },
    },
    schema: z.object({ headless: z.boolean().optional() }),
    outputSchema: z.object({ sessionId: z.string(), headless: z.boolean(), driver: z.string() }),
    allowedRoles: ['browser', 'testing', 'debugging'],
    async execute(input) {
      const info = await browser.launch({ headless: input.headless });
      return {
        ok: true,
        summary: `Browser session ${info.id} opened`,
        data: { sessionId: info.id, headless: info.headless, driver: browser.driverKind() },
        observation: `Browser session opened: sessionId=${info.id} driver=${browser.driverKind()}.`,
      };
    },
  };

  const navigate: ToolDefinition<{ sessionId: string; url: string }, unknown> = {
    descriptor: {
      id: 'browser.goto',
      name: 'Navigate',
      description: 'Navigate the browser session to an http(s) URL and return the final URL and HTTP status.',
      risk: 'low',
      category: 'browser',
      timeoutMs: 60_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' }, url: { type: 'string' } },
        required: ['sessionId', 'url'],
      },
      outputSchema: { type: 'object', properties: { url: { type: 'string' } } },
    },
    schema: z.object({ sessionId: z.string().min(1), url: z.string().url() }),
    outputSchema: z.object({ url: z.string(), detail: z.string() }),
    allowedRoles: ['browser', 'testing', 'debugging'],
    async preflight(input) {
      const classification = browser.classify({ sessionId: input.sessionId, action: 'goto', url: input.url });
      return classification.sensitive ? { reason: classification.reason, risk: 'high' } : null;
    },
    async execute(input) {
      const result = await browser.execute({ sessionId: input.sessionId, action: 'goto', url: input.url });
      return {
        ok: true,
        summary: `Navigated to ${result.url ?? input.url}`,
        data: { url: result.url ?? input.url, detail: result.detail },
        observation: result.detail,
      };
    },
  };

  const interact = z.object({
    sessionId: z.string().min(1),
    action: z.enum(['click', 'fill', 'press', 'select', 'wait']),
    selector: z.string().optional(),
    value: z.string().optional(),
    key: z.string().optional(),
  });

  const interactTool: ToolDefinition<z.infer<typeof interact>, unknown> = {
    descriptor: {
      id: 'browser.interact',
      name: 'Interact with page',
      description:
        'Click, type, press a key, select an option, or wait for a selector. Clicks on pay/submit/confirm/delete controls require human approval.',
      risk: 'medium',
      category: 'browser',
      timeoutMs: 60_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string' },
          action: { type: 'string', enum: ['click', 'fill', 'press', 'select', 'wait'] },
          selector: { type: 'string' },
          value: { type: 'string' },
          key: { type: 'string' },
        },
        required: ['sessionId', 'action'],
      },
      outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    },
    schema: interact,
    outputSchema: z.object({ ok: z.boolean(), detail: z.string() }),
    allowedRoles: ['browser', 'testing', 'debugging'],
    async preflight(input) {
      const classification = browser.classify({
        sessionId: input.sessionId,
        action: input.action,
        selector: input.selector,
        value: input.value,
      });
      return classification.sensitive ? { reason: classification.reason, risk: 'high' } : null;
    },
    async execute(input) {
      const result = await browser.execute({
        sessionId: input.sessionId,
        action: input.action,
        selector: input.selector,
        value: input.value,
        key: input.key,
      });
      return { ok: true, summary: result.detail, data: { ok: true, detail: result.detail }, observation: result.detail };
    },
  };

  const inspect: ToolDefinition<{ sessionId: string; what: 'text' | 'html' | 'url' | 'errors' }, unknown> = {
    descriptor: {
      id: 'browser.inspect',
      name: 'Inspect page',
      description: 'Read page text, HTML, the current URL, or console errors collected during the session.',
      risk: 'low',
      category: 'browser',
      timeoutMs: 30_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' }, what: { type: 'string', enum: ['text', 'html', 'url', 'errors'] } },
        required: ['sessionId', 'what'],
      },
      outputSchema: { type: 'object', properties: { detail: { type: 'string' } } },
    },
    schema: z.object({
      sessionId: z.string().min(1),
      what: z.enum(['text', 'html', 'url', 'errors']),
    }),
    outputSchema: z.object({ detail: z.string() }),
    allowedRoles: ['browser', 'testing', 'debugging', 'analyst'],
    async execute(input) {
      const action = input.what === 'errors' ? 'errors' : input.what;
      const result = await browser.execute({ sessionId: input.sessionId, action });
      return { ok: true, summary: `${input.what} captured`, data: { detail: result.detail }, observation: result.detail };
    },
  };

  const screenshot: ToolDefinition<{ sessionId: string; name?: string; fullPage?: boolean }, unknown> = {
    descriptor: {
      id: 'browser.screenshot',
      name: 'Capture screenshot',
      description: 'Capture a PNG screenshot of the page (optionally full page) and store it as a project artifact.',
      risk: 'low',
      category: 'browser',
      timeoutMs: 60_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { sessionId: { type: 'string' }, name: { type: 'string' }, fullPage: { type: 'boolean' } },
        required: ['sessionId'],
      },
      outputSchema: { type: 'object', properties: { path: { type: 'string' } } },
    },
    schema: z.object({ sessionId: z.string().min(1), name: z.string().optional(), fullPage: z.boolean().optional() }),
    outputSchema: z.object({ path: z.string() }),
    allowedRoles: ['browser', 'testing', 'debugging'],
    async execute(input) {
      const result = await browser.execute({
        sessionId: input.sessionId,
        action: 'screenshot',
        name: input.name,
        fullPage: input.fullPage,
      });
      if (!result.screenshotPath) throw new NexusError('BROWSER_ACTION_FAILED', 'Screenshot was not produced');
      return {
        ok: true,
        summary: `Screenshot saved`,
        data: { path: result.screenshotPath },
        observation: `Screenshot: ${result.screenshotPath}`,
      };
    },
  };

  return [openBrowser, navigate, interactTool, inspect, screenshot] as ToolDefinition<unknown, unknown>[];
}
