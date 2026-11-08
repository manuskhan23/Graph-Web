/**
 * Browser driver abstraction.
 *
 * `PlaywrightDriver` is the real implementation. `StubDriver` implements the same
 * interface with an in-memory document so the browser tool layer, action guards
 * and the agent loop can be tested deterministically without downloading a
 * browser binary.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { NexusError } from '../errors.js';
import type { BrowserSessionInfo } from '../types.js';

export interface BrowserActionOptions {
  timeoutMs?: number;
}

export interface BrowserDriver {
  readonly kind: 'playwright' | 'stub';
  isAvailable(): Promise<{ available: boolean; reason?: string }>;
  launch(options: { headless: boolean }): Promise<{ sessionId: string; info: BrowserSessionInfo }>;
  close(sessionId: string): Promise<void>;
  closeAll(): Promise<void>;
  goto(sessionId: string, url: string, options?: BrowserActionOptions): Promise<{ url: string; status: number | null }>;
  click(sessionId: string, selector: string, options?: BrowserActionOptions): Promise<void>;
  fill(sessionId: string, selector: string, value: string, options?: BrowserActionOptions): Promise<void>;
  press(sessionId: string, selector: string, key: string, options?: BrowserActionOptions): Promise<void>;
  selectOption(sessionId: string, selector: string, value: string): Promise<void>;
  waitFor(sessionId: string, selector: string, options?: BrowserActionOptions): Promise<void>;
  text(sessionId: string, selector?: string): Promise<string>;
  content(sessionId: string): Promise<string>;
  screenshot(sessionId: string, name: string, fullPage?: boolean): Promise<string>;
  evaluate(sessionId: string, expression: string): Promise<unknown>;
  currentUrl(sessionId: string): Promise<string>;
  consoleErrors(sessionId: string): Promise<string[]>;
}

const SENSITIVE_URL_PATTERN =
  /(checkout|payment|purchase|subscribe|billing|order|donate|transfer)/i;

export function looksSensitive(url: string): boolean {
  return SENSITIVE_URL_PATTERN.test(url);
}

/* ------------------------------------------------------------ Playwright */

export class PlaywrightDriver implements BrowserDriver {
  readonly kind = 'playwright' as const;
  private sessions = new Map<string, { browser: unknown; page: unknown; errors: string[] }>();
  private moduleState: 'unknown' | 'loaded' | 'missing' = 'unknown';

  private async loadPlaywright(): Promise<typeof import('playwright')> {
    try {
      const mod = await import('playwright');
      this.moduleState = 'loaded';
      return mod;
    } catch (err) {
      this.moduleState = 'missing';
      throw new NexusError('BROWSER_UNAVAILABLE', `Playwright is not installed: ${(err as Error).message}`, {
        httpStatus: 503,
      });
    }
  }

  async isAvailable(): Promise<{ available: boolean; reason?: string }> {
    try {
      const pw = await this.loadPlaywright();
      // Probe for a browser binary without launching a window.
      const executable = pw.chromium.executablePath();
      const { existsSync } = await import('node:fs');
      if (!executable || !existsSync(executable)) {
        return {
          available: false,
          reason:
            'Chromium is not downloaded. Run `npx playwright install chromium` to enable live browser automation.',
        };
      }
      return { available: true };
    } catch (err) {
      return { available: false, reason: (err as Error).message };
    }
  }

  private async getSession(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NexusError('NOT_FOUND', `Browser session not found: ${sessionId}`);
    return session;
  }

  async launch(options: { headless: boolean }) {
    const pw = await this.loadPlaywright();
    const browser = await pw.chromium.launch({ headless: options.headless });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const sessionId = randomUUID();
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    this.sessions.set(sessionId, { browser, page, errors });
    return {
      sessionId,
      info: { id: sessionId, headless: options.headless, url: 'about:blank', createdAt: Date.now() },
    };
  }

  async close(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      await (session.browser as { close: () => Promise<void> }).close();
    } catch {
      /* already closed */
    }
    this.sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    for (const id of [...this.sessions.keys()]) await this.close(id);
  }

  private async page(sessionId: string) {
    const session = await this.getSession(sessionId);
    return session.page as {
      goto: (url: string, opts?: unknown) => Promise<{ status: () => number | null } | null>;
      click: (selector: string, opts?: unknown) => Promise<void>;
      fill: (selector: string, value: string, opts?: unknown) => Promise<void>;
      press: (selector: string, key: string) => Promise<void>;
      selectOption: (selector: string, value: string) => Promise<string[]>;
      waitForSelector: (selector: string, opts?: unknown) => Promise<unknown>;
      innerText: (selector?: string) => Promise<string>;
      content: () => Promise<string>;
      screenshot: (opts: unknown) => Promise<Buffer>;
      evaluate: (fn: string) => Promise<unknown>;
      url: () => string;
    };
  }

  async goto(sessionId: string, url: string, options: BrowserActionOptions = {}) {
    const page = await this.page(sessionId);
    assertHttpUrl(url);
    const response = await page.goto(url, { timeout: options.timeoutMs ?? 20_000, waitUntil: 'domcontentloaded' });
    return { url: page.url(), status: response ? response.status() : null };
  }

  async click(sessionId: string, selector: string, options: BrowserActionOptions = {}) {
    const page = await this.page(sessionId);
    await page.click(selector, { timeout: options.timeoutMs ?? 10_000 });
  }

  async fill(sessionId: string, selector: string, value: string, options: BrowserActionOptions = {}) {
    const page = await this.page(sessionId);
    await page.fill(selector, value, { timeout: options.timeoutMs ?? 10_000 });
  }

  async press(sessionId: string, selector: string, key: string) {
    const page = await this.page(sessionId);
    await page.press(selector, key);
  }

  async selectOption(sessionId: string, selector: string, value: string) {
    const page = await this.page(sessionId);
    await page.selectOption(selector, value);
  }

  async waitFor(sessionId: string, selector: string, options: BrowserActionOptions = {}) {
    const page = await this.page(sessionId);
    await page.waitForSelector(selector, { timeout: options.timeoutMs ?? 10_000 });
  }

  async text(sessionId: string, selector?: string) {
    const page = await this.page(sessionId);
    return selector ? page.innerText(selector) : page.innerText();
  }

  async content(sessionId: string) {
    const page = await this.page(sessionId);
    return page.content();
  }

  async screenshot(sessionId: string, name: string, fullPage = false) {
    const page = await this.page(sessionId);
    const buffer = await page.screenshot({ fullPage });
    const path = join(config.artifactDir, 'screenshots', `${safeName(name)}-${Date.now()}.png`);
    mkdirSync(dirname(path), { recursive: true });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, buffer);
    return path;
  }

  async evaluate(sessionId: string, expression: string) {
    const page = await this.page(sessionId);
    return page.evaluate(expression);
  }

  async currentUrl(sessionId: string) {
    const page = await this.page(sessionId);
    return page.url();
  }

  async consoleErrors(sessionId: string) {
    const session = await this.getSession(sessionId);
    return [...session.errors].slice(-50);
  }
}

/* ------------------------------------------------------------------ stub */

/** Deterministic in-memory browser used by tests and by the "no browser" state. */
export class StubDriver implements BrowserDriver {
  readonly kind = 'stub' as const;
  private sessions = new Map<
    string,
    { url: string; content: string; text: string; history: string[]; fields: Map<string, string>; errors: string[] }
  >();

  async isAvailable() {
    return { available: false, reason: 'Playwright browsers are not installed in this environment (stub driver active).' };
  }

  async launch(options: { headless: boolean }) {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      url: 'about:blank',
      content: '<html><head><title>Stub</title></head><body></body></html>',
      text: '',
      history: [],
      fields: new Map(),
      errors: [],
    });
    return { sessionId, info: { id: sessionId, headless: options.headless, url: 'about:blank', createdAt: Date.now() } };
  }

  async close(sessionId: string) {
    this.sessions.delete(sessionId);
  }

  async closeAll() {
    this.sessions.clear();
  }

  private session(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NexusError('NOT_FOUND', `Browser session not found: ${sessionId}`);
    return session;
  }

  async goto(sessionId: string, url: string) {
    assertHttpUrl(url);
    const session = this.session(sessionId);
    session.url = url;
    session.history.push(url);
    session.text = `Stub page at ${url}`;
    session.content = `<html><body><h1>Stub</h1><p>${url}</p></body></html>`;
    return { url, status: 200 };
  }

  async click(sessionId: string, selector: string) {
    const session = this.session(sessionId);
    session.history.push(`click:${selector}`);
  }

  async fill(sessionId: string, selector: string, value: string) {
    this.session(sessionId).fields.set(selector, value);
  }

  async press(sessionId: string, selector: string, key: string) {
    this.session(sessionId).history.push(`press:${selector}:${key}`);
  }

  async selectOption(sessionId: string, selector: string, value: string) {
    this.session(sessionId).fields.set(selector, value);
  }

  async waitFor(sessionId: string, selector: string) {
    this.session(sessionId).history.push(`wait:${selector}`);
  }

  async text(sessionId: string, selector?: string) {
    const session = this.session(sessionId);
    return selector ? session.fields.get(selector) ?? session.text : session.text;
  }

  async content(sessionId: string) {
    return this.session(sessionId).content;
  }

  async screenshot(_sessionId: string, name: string) {
    return `stub://screenshots/${safeName(name)}.png`;
  }

  async evaluate(sessionId: string, expression: string) {
    return { stub: true, expression };
  }

  async currentUrl(sessionId: string) {
    return this.session(sessionId).url;
  }

  async consoleErrors(sessionId: string) {
    return this.session(sessionId).errors;
  }
}

export function assertHttpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new NexusError('VALIDATION_FAILED', `Invalid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new NexusError('VALIDATION_FAILED', `Only http(s) URLs may be opened, got ${parsed.protocol}`);
  }
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) {
    // Allowed (dev servers are a primary use case) but flagged in the audit log
    // by the caller — never silently treated as an external site.
    return parsed.toString();
  }
  return parsed.toString();
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'screenshot';
}
