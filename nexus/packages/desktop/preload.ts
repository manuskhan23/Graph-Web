/**
 * Preload bridge (§4.2, §11).
 *
 * The renderer gets a small, frozen, explicitly enumerated API. There is no
 * generic `ipcRenderer.invoke` escape hatch: every method maps to one vetted
 * channel, arguments are validated here as well as in the main process, and the
 * object is frozen so page scripts cannot monkey-patch it.
 */
import { contextBridge, ipcRenderer } from 'electron';

const ALLOWED_CHANNELS = new Set([
  'nexus:select-directory',
  'nexus:set-api-key',
  'nexus:get-key-status',
  'nexus:clear-api-key',
  'nexus:notify',
  'nexus:window-minimize',
  'nexus:window-maximize',
  'nexus:window-close',
  'nexus:open-external',
  'nexus:app-info',
  'nexus:backend-url',
]);

function invoke(channel: string, payload?: unknown): Promise<unknown> {
  if (!ALLOWED_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
  }
  return ipcRenderer.invoke(channel, payload);
}

function assertProvider(provider: unknown): 'gemini' | 'groq' {
  if (provider !== 'gemini' && provider !== 'groq') throw new Error('Unknown provider');
  return provider;
}

const nexusApi = {
  isDesktop: true as const,

  /** Native directory picker. Returns an absolute path or null. */
  async selectDirectory(): Promise<string | null> {
    const result = await invoke('nexus:select-directory');
    return typeof result === 'string' ? result : null;
  },

  async setApiKey(provider: 'gemini' | 'groq', key: string): Promise<{ ok: boolean }> {
    if (typeof key !== 'string' || key.length < 8) throw new Error('API key looks invalid');
    return (await invoke('nexus:set-api-key', { provider: assertProvider(provider), key })) as { ok: boolean };
  },

  async getKeyStatus(): Promise<{ encryptionAvailable: boolean; gemini: boolean; groq: boolean }> {
    return (await invoke('nexus:get-key-status')) as { encryptionAvailable: boolean; gemini: boolean; groq: boolean };
  },

  async clearApiKey(provider: 'gemini' | 'groq'): Promise<{ ok: boolean }> {
    return (await invoke('nexus:clear-api-key', { provider: assertProvider(provider) })) as { ok: boolean };
  },

  async notify(title: string, body: string): Promise<{ shown: boolean }> {
    return (await invoke('nexus:notify', { title: String(title).slice(0, 120), body: String(body).slice(0, 300) })) as {
      shown: boolean;
    };
  },

  window: {
    minimize: () => invoke('nexus:window-minimize'),
    toggleMaximize: () => invoke('nexus:window-maximize'),
    close: () => invoke('nexus:window-close'),
  },

  async openExternal(url: string): Promise<{ ok: boolean }> {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs allowed');
    return (await invoke('nexus:open-external', { url })) as { ok: boolean };
  },

  async appInfo(): Promise<Record<string, unknown>> {
    return (await invoke('nexus:app-info')) as Record<string, unknown>;
  },

  async backendUrl(): Promise<string> {
    const { url } = (await invoke('nexus:backend-url')) as { url: string };
    return url;
  },
};

Object.freeze(nexusApi.window);
Object.freeze(nexusApi);
contextBridge.exposeInMainWorld('nexus', nexusApi);

export type NexusBridge = typeof nexusApi;
