/**
 * Phase 7 — Browser automation session manager.
 *
 * Wraps a driver with: session ownership, sensitive-action classification
 * (payments, checkouts, form submissions that transact), screenshot capture,
 * console-error reporting and the audit trail.
 *
 * NEXUS never attempts to defeat CAPTCHAs or site security. Those flows stop and
 * hand control back to the user.
 */
import { NexusError } from '../errors.js';
import type { BrowserActionResult, BrowserSessionInfo } from '../types.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import type { BrowserDriver } from './driver.js';
import { looksSensitive } from './driver.js';

export interface BrowserActionInput {
  sessionId: string;
  action: 'goto' | 'click' | 'fill' | 'press' | 'select' | 'wait' | 'text' | 'html' | 'screenshot' | 'eval' | 'url' | 'errors';
  url?: string;
  selector?: string;
  value?: string;
  key?: string;
  name?: string;
  fullPage?: boolean;
  timeoutMs?: number;
}

export class BrowserManager {
  private sessions = new Map<string, BrowserSessionInfo>();

  constructor(
    private readonly driver: BrowserDriver,
    private readonly db: Database,
    private readonly events?: EventBus,
  ) {}

  driverKind(): 'playwright' | 'stub' {
    return this.driver.kind;
  }

  availability() {
    return this.driver.isAvailable();
  }

  async launch(options: { headless?: boolean } = {}): Promise<BrowserSessionInfo> {
    const settings = await this.db.observability.getSetting<{ app?: { browser?: { headless?: boolean } } }>('app.settings', {});
    const headless = options.headless ?? settings?.app?.browser?.headless ?? true;
    const { info } = await this.driver.launch({ headless });
    this.sessions.set(info.id, info);
    this.events?.emit('browser.action', `Browser session started (${this.driver.kind})`, { sessionId: info.id, headless });
    await this.db.observability.addActivity({
      kind: 'browser',
      level: 'info',
      title: 'Browser session started',
      detail: `driver=${this.driver.kind} headless=${headless}`,
      projectId: null,
      taskId: null,
      provider: null,
      status: 'running',
    });
    return info;
  }

  sessions_(): BrowserSessionInfo[] {
    return [...this.sessions.values()];
  }

  async close(sessionId: string): Promise<void> {
    await this.driver.close(sessionId);
    this.sessions.delete(sessionId);
  }

  async closeAll(): Promise<void> {
    await this.driver.closeAll();
    this.sessions.clear();
  }

  /** Classify an action for approval purposes. */
  classify(input: BrowserActionInput): { sensitive: boolean; reason: string } {
    if (input.action === 'goto' && input.url && looksSensitive(input.url)) {
      return { sensitive: true, reason: `Navigating to a transactional page: ${input.url}` };
    }
    if (input.action === 'click' && input.selector && /submit|pay|purchase|buy|confirm|delete/i.test(input.selector)) {
      return { sensitive: true, reason: `Clicking a consequential control: ${input.selector}` };
    }
    if (input.action === 'eval' && input.value && /(password|localStorage|document\.cookie)/i.test(input.value)) {
      return { sensitive: true, reason: 'Script accesses credentials or storage' };
    }
    return { sensitive: false, reason: '' };
  }

  async execute(input: BrowserActionInput): Promise<BrowserActionResult> {
    if (!this.sessions.has(input.sessionId)) {
      throw new NexusError('NOT_FOUND', `Browser session not found: ${input.sessionId}`);
    }
    const timeoutMs = input.timeoutMs ?? 20_000;
    const startedAt = Date.now();
    let detail = '';
    let url: string | undefined;
    let screenshotPath: string | undefined;

    try {
      switch (input.action) {
        case 'goto': {
          if (!input.url) throw new NexusError('VALIDATION_FAILED', 'url is required for goto');
          const result = await this.driver.goto(input.sessionId, input.url, { timeoutMs });
          url = result.url;
          detail = `Navigated to ${result.url}${result.status ? ` (HTTP ${result.status})` : ''}`;
          break;
        }
        case 'click':
          requireSelector(input);
          await this.driver.click(input.sessionId, input.selector!, { timeoutMs });
          detail = `Clicked ${input.selector}`;
          break;
        case 'fill':
          requireSelector(input);
          await this.driver.fill(input.sessionId, input.selector!, input.value ?? '', { timeoutMs });
          detail = `Filled ${input.selector}`;
          break;
        case 'press':
          requireSelector(input);
          await this.driver.press(input.sessionId, input.selector!, input.key ?? 'Enter');
          detail = `Pressed ${input.key ?? 'Enter'} on ${input.selector}`;
          break;
        case 'select':
          requireSelector(input);
          await this.driver.selectOption(input.sessionId, input.selector!, input.value ?? '');
          detail = `Selected ${input.value} in ${input.selector}`;
          break;
        case 'wait':
          requireSelector(input);
          await this.driver.waitFor(input.sessionId, input.selector!, { timeoutMs });
          detail = `Element appeared: ${input.selector}`;
          break;
        case 'text': {
          const text = await this.driver.text(input.sessionId, input.selector);
          detail = text.slice(0, 8000);
          break;
        }
        case 'html': {
          const html = await this.driver.content(input.sessionId);
          detail = html.slice(0, 20_000);
          break;
        }
        case 'screenshot':
          screenshotPath = await this.driver.screenshot(input.sessionId, input.name ?? 'capture', input.fullPage);
          detail = `Screenshot saved to ${screenshotPath}`;
          break;
        case 'eval': {
          const value = await this.driver.evaluate(input.sessionId, input.value ?? 'document.title');
          detail = typeof value === 'string' ? value : JSON.stringify(value);
          break;
        }
        case 'url':
          url = await this.driver.currentUrl(input.sessionId);
          detail = url;
          break;
        case 'errors': {
          const errors = await this.driver.consoleErrors(input.sessionId);
          detail = errors.length ? errors.join('\n') : 'No console errors';
          break;
        }
        default:
          throw new NexusError('VALIDATION_FAILED', `Unsupported browser action: ${input.action}`);
      }
    } catch (err) {
      const message = err instanceof NexusError ? err.message : (err as Error).message;
      await this.db.observability.addActivity({
        kind: 'browser',
        level: 'error',
        title: `Browser action failed: ${input.action}`,
        detail: message,
        projectId: null,
        taskId: null,
        provider: null,
        status: 'failed',
      });
      throw err instanceof NexusError
        ? err
        : new NexusError('BROWSER_ACTION_FAILED', `Browser action failed: ${message}`, { cause: err });
    }

    url = url ?? (await safeUrl(this.driver, input.sessionId));
    this.events?.emit('browser.action', `Browser ${input.action}`, {
      sessionId: input.sessionId,
      action: input.action,
      durationMs: Date.now() - startedAt,
    });
    await this.db.observability.addActivity({
      kind: 'browser',
      level: 'info',
      title: `Browser ${input.action}`,
      detail: detail.slice(0, 500),
      projectId: null,
      taskId: null,
      provider: null,
      status: 'success',
    });

    return {
      sessionId: input.sessionId,
      action: input.action,
      ok: true,
      detail,
      ...(url ? { url } : {}),
      ...(screenshotPath ? { screenshotPath } : {}),
    };
  }
}

function requireSelector(input: BrowserActionInput): void {
  if (!input.selector) throw new NexusError('VALIDATION_FAILED', `selector is required for ${input.action}`);
}

async function safeUrl(driver: BrowserDriver, sessionId: string): Promise<string | undefined> {
  try {
    return await driver.currentUrl(sessionId);
  } catch {
    return undefined;
  }
}
