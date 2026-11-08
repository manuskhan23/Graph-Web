/**
 * Secret storage. API keys must never reach the renderer, logs or the DB in
 * plaintext. Resolution order:
 *
 *   1. OS credential store (Electron `safeStorage` via the main process) — set by
 *      the desktop shell through `setKeyResolver`.
 *   2. Environment variables (dev / CI).
 *   3. Encrypted file in the app data dir, encrypted with a machine-local key
 *      derived with scrypt (used when no OS keychain is available, e.g. sandbox).
 *
 * The UI only ever sees `{ configured, masked, source }`.
 */
import { createHash, randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { config } from '../config.js';
import { NexusError } from '../errors.js';
import type { ProviderId } from '../types.js';

export type KeySource = 'keychain' | 'env' | 'encrypted-file' | 'none';

export interface KeyState {
  configured: boolean;
  masked: string | null;
  source: KeySource;
}

type KeyResolver = (provider: ProviderId) => string | null;

const ENV_KEYS: Record<ProviderId, string> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
};

const PROVIDERS: ProviderId[] = ['gemini', 'groq'];

export class KeyStore {
  private readonly file: string;
  private resolver: KeyResolver | null = null;
  private cache = new Map<ProviderId, { value: string; source: KeySource }>();

  constructor(filePath = join(config.dataDir, 'secrets.enc')) {
    this.file = filePath;
  }

  /** Electron main injects an OS-keychain backed resolver here. */
  setKeyResolver(resolver: KeyResolver | null): void {
    this.resolver = resolver;
    this.cache.clear();
  }

  get(provider: ProviderId): string | null {
    const cached = this.cache.get(provider);
    if (cached) return cached.value;

    if (this.resolver) {
      const fromKeychain = safeCall(() => this.resolver!(provider));
      if (fromKeychain) {
        this.cache.set(provider, { value: fromKeychain, source: 'keychain' });
        return fromKeychain;
      }
    }
    const envValue = process.env[ENV_KEYS[provider]];
    if (envValue && envValue.trim().length > 0) {
      this.cache.set(provider, { value: envValue.trim(), source: 'env' });
      return envValue.trim();
    }
    const stored = this.readFile()[provider];
    if (stored) {
      this.cache.set(provider, { value: stored, source: 'encrypted-file' });
      return stored;
    }
    return null;
  }

  state(provider: ProviderId): KeyState {
    const value = this.get(provider);
    if (!value) return { configured: false, masked: null, source: 'none' };
    const cached = this.cache.get(provider);
    return { configured: true, masked: mask(value), source: cached?.source ?? 'none' };
  }

  all(): Record<ProviderId, KeyState> {
    return {
      gemini: this.state('gemini'),
      groq: this.state('groq'),
    };
  }

  /** Persist a key in the encrypted file store. Rejects obviously invalid input. */
  set(provider: ProviderId, rawKey: string): KeyState {
    const key = rawKey.trim();
    if (key.length < 12) {
      throw new NexusError('VALIDATION_FAILED', 'API key looks too short to be valid');
    }
    if (/\s/.test(key)) {
      throw new NexusError('VALIDATION_FAILED', 'API key must not contain whitespace');
    }
    const current = this.readFile();
    current[provider] = key;
    this.writeFile(current);
    this.cache.set(provider, { value: key, source: 'encrypted-file' });
    return this.state(provider);
  }

  clear(provider: ProviderId): void {
    const current = this.readFile();
    delete current[provider];
    this.writeFile(current);
    this.cache.delete(provider);
  }

  /* ------------------------------------------------------- file crypto */

  private machineKey(): Buffer {
    // Derive a stable per-machine secret. This is defence-in-depth, not a
    // replacement for an OS keychain: files are also chmod 0600.
    const material = `${hostname()}:${safeCall(() => userInfo().username) ?? 'user'}:nexus-ai-v2`;
    return scryptSync(material, 'nexus-ai-salt-v2', 32);
  }

  private readFile(): Partial<Record<ProviderId, string>> {
    if (!existsSync(this.file)) return {};
    try {
      const raw = readFileSync(this.file);
      if (raw.length < 32) return {};
      const iv = raw.subarray(0, 12);
      const tag = raw.subarray(12, 28);
      const body = raw.subarray(28);
      const decipher = createDecipheriv('aes-256-gcm', this.machineKey(), iv);
      decipher.setAuthTag(tag);
      const plain = Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
      return JSON.parse(plain) as Partial<Record<ProviderId, string>>;
    } catch (err) {
      console.error('[nexus][keys] cannot decrypt secret store:', (err as Error).message);
      return {};
    }
  }

  private writeFile(data: Partial<Record<ProviderId, string>>): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.machineKey(), iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const out = Buffer.concat([iv, cipher.getAuthTag(), enc]);
    writeFileSync(this.file, out, { mode: 0o600 });
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* best effort on platforms without chmod */
    }
  }

  /** Diagnostics only — never returns the secret itself. */
  fingerprint(provider: ProviderId): string | null {
    const value = this.get(provider);
    if (!value) return null;
    return createHash('sha256').update(value).digest('hex').slice(0, 8);
  }
}

function mask(value: string): string {
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 4)}${'•'.repeat(Math.min(12, value.length - 8))}${value.slice(-4)}`;
}

function safeCall<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

export const keyStore = new KeyStore();

export function isProviderKeyPresent(provider: ProviderId): boolean {
  return keyStore.get(provider) !== null;
}

export { PROVIDERS, ENV_KEYS };
