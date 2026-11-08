/**
 * Phase 16 — Settings & control centre.
 * Settings are validated with zod, persisted in SQLite, and merged over defaults
 * so new settings appear without a migration.
 */
import { z } from 'zod';
import { BUILTIN_IGNORE_GLOBS, config } from '../config.js';
import { NexusError } from '../errors.js';
import type { AppSettings, SettingsResponse } from '../types.js';
import type { ObservabilityStore } from '../storage/contracts.js';
import { keyStore } from '../security/keys.js';
import { DEFAULT_MODELS } from '../providers/models.js';

const settingsSchema = z.object({
  ai: z
    .object({
      defaultProvider: z.enum(['gemini', 'groq']),
      geminiModel: z.string().min(1),
      groqModel: z.string().min(1),
      temperature: z.number().min(0).max(2),
      maxOutputTokens: z.number().int().min(64).max(32_768),
      allowCrossProviderFallback: z.boolean(),
    })
    .partial(),
  agent: z
    .object({
      maxToolCalls: z.number().int().min(1).max(200),
      maxDurationMs: z.number().int().min(5_000).max(3_600_000),
      maxRetriesPerStep: z.number().int().min(0).max(10),
      maxContextTokens: z.number().int().min(1_000).max(1_000_000),
      maxConcurrentTasks: z.number().int().min(1).max(8),
      requireApprovalFor: z.object({ medium: z.boolean(), high: z.boolean() }).partial(),
    })
    .partial(),
  app: z
    .object({
      theme: z.literal('monochrome'),
      notifications: z.boolean(),
      memoryEnabled: z.boolean(),
      terminal: z.object({ shell: z.enum(['powershell', 'cmd', 'bash']), timeoutMs: z.number().int().min(1_000) }).partial(),
      browser: z.object({ headless: z.boolean(), defaultTimeoutMs: z.number().int().min(1_000) }).partial(),
      logging: z
        .object({ level: z.enum(['debug', 'info', 'warn', 'error']), retentionDays: z.number().int().min(1) })
        .partial(),
    })
    .partial(),
  projects: z.object({ defaultIgnoreGlobs: z.array(z.string()) }).partial(),
}).partial();

export type SettingsPatch = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    defaultProvider: 'gemini',
    geminiModel: DEFAULT_MODELS.gemini.modelId,
    groqModel: DEFAULT_MODELS.groq.modelId,
    temperature: 0.4,
    maxOutputTokens: 4096,
    allowCrossProviderFallback: true,
  },
  agent: {
    maxToolCalls: config.limits.maxToolCalls,
    maxDurationMs: config.limits.maxDurationMs,
    maxRetriesPerStep: config.limits.maxRetriesPerStep,
    maxContextTokens: config.limits.maxContextTokens,
    maxConcurrentTasks: config.limits.maxConcurrentTasks,
    requireApprovalFor: { medium: true, high: true },
  },
  app: {
    theme: 'monochrome',
    notifications: true,
    memoryEnabled: true,
    terminal: { shell: 'bash', timeoutMs: 120_000 },
    browser: { headless: true, defaultTimeoutMs: 20_000 },
    logging: { level: 'info', retentionDays: 30 },
  },
  projects: { defaultIgnoreGlobs: [...BUILTIN_IGNORE_GLOBS] },
};

const SETTINGS_KEY = 'app.settings';

export class SettingsService {
  /**
   * Settings are read synchronously in hot paths (limits are consulted per step),
   * but every store is async. The cache below is the synchronous view; it is
   * hydrated by `load()` before the app serves requests and rewritten by
   * `update()` / `reset()`, so it never drifts from the database.
   */
  private cached: Partial<AppSettings> = {};
  private hydrated = false;

  constructor(private readonly store: ObservabilityStore) {}

  /** Read persisted settings into the synchronous cache. Call once at startup. */
  async load(): Promise<AppSettings> {
    this.cached = await this.store.getSetting<Partial<AppSettings>>(SETTINGS_KEY, {});
    this.hydrated = true;
    return this.get();
  }

  get(): AppSettings {
    return deepMerge(DEFAULT_SETTINGS, this.cached);
  }

  /** True once `load()` has run, so callers can tell defaults from stored values. */
  get isHydrated(): boolean {
    return this.hydrated;
  }

  /** Validate then persist a partial patch. Returns the merged, effective settings. */
  async update(patch: unknown): Promise<AppSettings> {
    const parsed = settingsSchema.safeParse(patch);
    if (!parsed.success) {
      throw new NexusError('VALIDATION_FAILED', 'Invalid settings payload', {
        details: parsed.error.flatten(),
      });
    }
    const merged = deepMerge(this.get(), parsed.data as Partial<AppSettings>);
    this.cached = merged as Partial<AppSettings>;
    this.hydrated = true;
    await this.store.setSetting(SETTINGS_KEY, merged);
    return merged;
  }

  async reset(): Promise<AppSettings> {
    this.cached = {};
    await this.store.setSetting(SETTINGS_KEY, {});
    return this.get();
  }

  /** Settings + masked key state for the UI. Raw secrets are never included. */
  response(): SettingsResponse {
    return { settings: this.get(), keys: keyStore.all() };
  }

  async setApiKey(provider: 'gemini' | 'groq', key: string): Promise<SettingsResponse> {
    keyStore.set(provider, key);
    await this.store.audit({
      actor: 'user',
      action: 'key.set',
      subject: provider,
      allowed: true,
      metadata: { fingerprint: keyStore.fingerprint(provider) },
    });
    return this.response();
  }

  async clearApiKey(provider: 'gemini' | 'groq'): Promise<SettingsResponse> {
    keyStore.clear(provider);
    await this.store.audit({ actor: 'user', action: 'key.clear', subject: provider, allowed: true });
    return this.response();
  }

  effectiveLimits() {
    return this.get().agent;
  }
}

export function deepMerge<T>(base: T, patch: unknown): T {
  if (patch === null || patch === undefined) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base)) return patch as T;
  if (typeof patch !== 'object' || Array.isArray(patch)) return patch as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const existing = out[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing)) {
      out[key] = deepMerge(existing, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}
