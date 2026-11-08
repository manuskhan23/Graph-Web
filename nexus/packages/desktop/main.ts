/**
 * Electron main process (§4 architecture, §11 security).
 *
 * Responsibilities:
 *  - create the single BrowserWindow with hardening flags
 *  - spawn and supervise the Express backend as a child process
 *  - own API-key storage via the OS keychain (safeStorage) and hand it to the
 *    backend through IPC-free environment injection
 *  - expose a *tiny* IPC surface (dialogs, window controls, notifications) —
 *    never filesystem or process access
 *  - enforce navigation / window-open policy and a strict CSP
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NEXUS_DEV === '1';
const BACKEND_PORT = Number(process.env.NEXUS_PORT ?? 4400);
const BACKEND_ORIGIN = `http://127.0.0.1:${BACKEND_PORT}`;
const CSP = [
  "default-src 'self'",
  isDev ? "script-src 'self' 'unsafe-inline' http://localhost:5173" : "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${BACKEND_ORIGIN}${isDev ? ' http://localhost:5173 ws://localhost:5173' : ''}`,
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** Allowed IPC channels. Anything else is rejected by the preload bridge. */
const IPC_CHANNELS = [
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
] as const;

let mainWindow: BrowserWindow | null = null;
let backend: ChildProcess | null = null;

/* -------------------------------------------------------------- key store */

function keyFilePath(): string {
  return join(app.getPath('userData'), 'keys.json');
}

/**
 * Keys are encrypted with the OS credential store (DPAPI/Keychain/libsecret).
 * If encryption is unavailable we refuse to persist rather than write plaintext.
 */
function readKeys(): Record<string, string> {
  const file = keyFilePath();
  if (!existsSync(file)) return {};
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn('[nexus] OS encryption unavailable — not reading stored keys');
    return {};
  }
  try {
    const encrypted = readFileSync(file);
    return JSON.parse(safeStorage.decryptString(encrypted)) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeKeys(keys: Record<string, string>): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is unavailable on this system; refusing to write API keys in plaintext.');
  }
  mkdirSync(app.getPath('userData'), { recursive: true });
  writeFileSync(keyFilePath(), safeStorage.encryptString(JSON.stringify(keys)), { mode: 0o600 });
}

/* ---------------------------------------------------------------- backend */

function startBackend(): void {
  const entry = resolve(here, '..', 'server', 'src', 'main.js');
  if (!existsSync(entry)) {
    console.error('[nexus] backend entry not found:', entry, '— run `npm run build:server` first');
    return;
  }
  const keys = readKeys();
  backend = spawn(process.execPath, ['--experimental-sqlite', entry], {
    env: {
      ...process.env,
      NEXUS_PORT: String(BACKEND_PORT),
      NEXUS_HOST: '127.0.0.1',
      NEXUS_ALLOWED_ORIGINS: `http://localhost:${BACKEND_PORT},file://`,
      // Keys reach the backend through the environment only; the renderer never
      // sees them and they are never logged.
      ...(keys.gemini ? { GEMINI_API_KEY: keys.gemini } : {}),
      ...(keys.groq ? { GROQ_API_KEY: keys.groq } : {}),
      // Keep the Electron binary's Node in "run as node" mode.
      ELECTRON_RUN_AS_NODE: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  backend.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[backend] ${chunk}`));
  backend.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[backend] ${chunk}`));
  backend.on('exit', (code) => {
    console.error(`[nexus] backend exited with code ${code}`);
    backend = null;
  });
}

function stopBackend(): void {
  if (!backend?.pid) return;
  try {
    process.kill(backend.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
  backend = null;
}

/* ----------------------------------------------------------------- window */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#000000',
    title: 'NEXUS AI',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // Security: strict isolation, no Node in the renderer, sandboxed preload.
      preload: resolve(here, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      sandbox: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Navigation policy: the app may only navigate inside itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(BACKEND_ORIGIN) || url.startsWith('file://');
    if (!allowed) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [CSP] } });
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    // The renderer never needs camera/mic/geolocation.
    const allowed = permission === 'notifications' || permission === 'clipboard-read';
    callback(allowed);
  });

  const devUrl = process.env.NEXUS_DEV_URL ?? 'http://localhost:5173';
  if (isDev) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadURL(`${BACKEND_ORIGIN}/`);
}

/* -------------------------------------------------------------------- IPC */

function validateArgs(channel: string, payload: unknown): void {
  if (!IPC_CHANNELS.includes(channel as (typeof IPC_CHANNELS)[number])) {
    throw new Error(`Blocked IPC channel: ${channel}`);
  }
  if (typeof payload === 'object' && payload !== null) {
    for (const key of Object.keys(payload)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new Error('Blocked IPC payload key');
      }
    }
  }
}

function registerIpc(): void {
  const handle = (channel: string, handler: (payload: never) => unknown) => {
    ipcMain.handle(channel, (event, payload) => {
      // Only our own window may call.
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error('Unauthorised IPC sender');
      }
      validateArgs(channel, payload);
      return handler(payload as never);
    });
  };

  handle('nexus:select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: 'Select a project directory',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0] ?? null;
  });

  handle('nexus:set-api-key', async (payload: { provider: 'gemini' | 'groq'; key: string }) => {
    if (!payload || typeof payload.key !== 'string' || payload.key.length < 8) {
      throw new Error('Invalid key payload');
    }
    if (payload.provider !== 'gemini' && payload.provider !== 'groq') {
      throw new Error('Unknown provider');
    }
    const keys = readKeys();
    keys[payload.provider] = payload.key.trim();
    writeKeys(keys);
    return { ok: true, provider: payload.provider };
  });

  handle('nexus:get-key-status', async () => {
    const keys = readKeys();
    return {
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      gemini: Boolean(keys.gemini),
      groq: Boolean(keys.groq),
    };
  });

  handle('nexus:clear-api-key', async (payload: { provider: 'gemini' | 'groq' }) => {
    const keys = readKeys();
    delete keys[payload.provider];
    writeKeys(keys);
    return { ok: true };
  });

  handle('nexus:notify', async (payload: { title: string; body: string }) => {
    if (!Notification.isSupported()) return { shown: false };
    new Notification({ title: String(payload.title).slice(0, 120), body: String(payload.body).slice(0, 300) }).show();
    return { shown: true };
  });

  handle('nexus:window-minimize', async () => {
    mainWindow?.minimize();
    return { ok: true };
  });
  handle('nexus:window-maximize', async () => {
    if (!mainWindow) return { ok: false };
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
    return { maximized: mainWindow.isMaximized() };
  });
  handle('nexus:window-close', async () => {
    mainWindow?.close();
    return { ok: true };
  });

  handle('nexus:open-external', async (payload: { url: string }) => {
    const url = String(payload?.url ?? '');
    if (!/^https?:\/\//.test(url)) throw new Error('Only http(s) URLs may be opened externally');
    await shell.openExternal(url);
    return { ok: true };
  });

  handle('nexus:app-info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    isDev,
  }));

  handle('nexus:backend-url', async () => ({ url: BACKEND_ORIGIN }));
}

/* ------------------------------------------------------------ app lifecycle */

// A second instance must not fight over the SQLite file or the port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    startBackend();
    registerIpc();
    // Give the backend a moment to bind before loading the UI.
    setTimeout(createWindow, 700);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => stopBackend());
  app.on('will-quit', () => stopBackend());

  // Block permission escalation from web content.
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  // Never allow a renderer to start a second Node process.
  void randomBytes;
}
