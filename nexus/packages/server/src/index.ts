/**
 * Express application factory. Holds no business logic — every route delegates to
 * a core service. Long-running work is handed to the job manager so request
 * handlers stay fast (architecture rule 7).
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp, type NexusApp, type CreateAppOptions } from '../../core/src/app.js';
import { config } from '../../core/src/config.js';
import { NexusError, toNexusError } from '../../core/src/errors.js';
import { sendError } from './http.js';
import { projectsRoutes } from './routes/projects.js';
import { agentRoutes, conversationsRoutes, tasksRoutes } from './routes/agent.js';
import {
  terminalRoutes,
  editorRoutes,
  snapshotRoutes,
  searchRoutes,
  memoryRoutes,
  workflowRoutes,
  browserRoutes,
  visionRoutes,
  analyticsRoutes,
  activityRoutes,
  settingsRoutes,
  metaRoutes,
  jobRoutes,
} from './routes/platform.js';

export interface Server {
  nexus: NexusApp;
  express: Express;
  listen(port?: number): Promise<{ port: number; host: string }>;
  close(): Promise<void>;
}

export async function buildServer(options: CreateAppOptions = {}): Promise<Server> {
  const nexus = await createApp(options);
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '24mb' }));

  /* ------------------------------------------------------- security headers */
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-ancestors 'self'",
      ].join('; '),
    );
    next();
  });

  /* --------------------------------------------------------------- CORS ---
   * Strict allow-list. No wildcard. The sandbox preview proxy serves the UI and
   * API from the same origin, so only explicit local origins are needed. */
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    } else if (origin) {
      res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: 'Origin not allowed', retryable: false } });
      return;
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  /* ------------------------------------------------------------- routes --- */
  const api = express.Router();
  api.use('/projects', projectsRoutes(nexus));
  api.use('/agent', agentRoutes(nexus));
  api.use('/tasks', tasksRoutes(nexus));
  api.use('/conversations', conversationsRoutes(nexus));
  api.use('/terminal', terminalRoutes(nexus));
  api.use('/editor', editorRoutes(nexus));
  api.use('/snapshots', snapshotRoutes(nexus));
  api.use('/search', searchRoutes(nexus));
  api.use('/memory', memoryRoutes(nexus));
  api.use('/workflows', workflowRoutes(nexus));
  api.use('/browser', browserRoutes(nexus));
  api.use('/vision', visionRoutes(nexus));
  api.use('/analytics', analyticsRoutes(nexus));
  api.use('/activity', activityRoutes(nexus));
  api.use('/settings', settingsRoutes(nexus));
  api.use('/jobs', jobRoutes(nexus));
  api.use('/', metaRoutes(nexus));

  api.get('/events/stream', (req: Request, res: Response) => {
    const since = Number(req.query.since ?? 0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\n\n`);

    // Replay buffered events so a reconnect does not lose history.
    for (const event of nexus.events.replay(Number.isFinite(since) ? since : 0)) {
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const unsubscribe = nexus.events.on((event) => {
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 20_000);
    keepAlive.unref?.();

    req.on('close', () => {
      unsubscribe();
      clearInterval(keepAlive);
    });
  });

  app.use('/api', api);

  /* --------------------------------------------------- static UI (built) -- */
  const here = dirname(fileURLToPath(import.meta.url));
  const uiDir = join(here, '..', '..', '..', 'ui', 'dist');
  if (existsSync(uiDir)) {
    app.use(express.static(uiDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => {
      res.sendFile(join(uiDir, 'index.html'));
    });
  }

  /* ---------------------------------------------------------- error sink -- */
  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}`, retryable: false } });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof SyntaxError && 'body' in err) {
      sendError(res, new NexusError('VALIDATION_FAILED', 'Request body is not valid JSON'));
      return;
    }
    const nexusError = toNexusError(err);
    if (nexusError.httpStatus >= 500) {
      console.error('[nexus][server] unhandled error:', nexusError.code, nexusError.message, nexusError.cause ?? '');
    }
    sendError(res, nexusError);
  });

  return {
    nexus,
    express: app,
    listen(port = config.port) {
      return new Promise((resolve, reject) => {
        const server = app.listen(port, config.host, () => {
          resolve({ port, host: config.host });
        });
        server.on('error', reject);
        (server as unknown as { nexusServer?: unknown }).nexusServer = server;
        setServerInstance(server);
      });
    },
    async close() {
      await nexus.shutdown();
    },
  };
}

let serverInstance: { close: (cb?: () => void) => void } | null = null;

function setServerInstance(server: { close: (cb?: () => void) => void }): void {
  serverInstance = server;
}

/** Graceful shutdown for the CLI entry point. */
export function shutdownServer(): void {
  if (serverInstance) serverInstance.close();
}

function isAllowedOrigin(origin: string): boolean {
  if (config.allowedOrigins.includes(origin)) return true;
  // Sandbox / preview hosts serve the UI and API from the same origin, so an
  // explicit *.e2b.app allowance is safe here.
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    if (hostname.endsWith('.e2b.app')) return true;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export { createApp, config };
