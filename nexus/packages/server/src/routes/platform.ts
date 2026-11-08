/**
 * Remaining REST surfaces: terminal, editor, snapshots, search, memory,
 * workflows, browser, vision, analytics, activity, settings, tools, events.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, parseBody, requireParam } from '../http.js';
import type { NexusApp } from '../../../core/src/app.js';
import { NexusError } from '../../../core/src/errors.js';
import { builtinTemplates } from '../../../core/src/workflows/engine.js';
import type { ApprovalRequiredResult } from '../../../core/src/terminal/manager.js';

/** Narrowing helper for the terminal manager's union return types. */
function isApprovalRequired<T extends object>(
  result: T,
): result is T & ApprovalRequiredResult {
  return 'requiresApproval' in result && (result as { requiresApproval?: boolean }).requiresApproval === true;
}
import { ALL_MODELS } from '../../../core/src/providers/models.js';

/* --------------------------------------------------------------- terminal */

export function terminalRoutes(app: NexusApp): Router {
  const router = Router();

  router.post(
    '/run',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          projectId: z.string().min(1),
          command: z.string().min(1).max(4000),
          cwd: z.string().optional(),
          timeoutMs: z.number().int().min(500).max(900_000).optional(),
          approved: z.boolean().optional(),
        }),
        req.body,
      );
      const result = await app.terminal.run(body);
      if (isApprovalRequired(result)) {
        // Route destructive commands through the real approval gate.
        const decision = await app.approvals.request({
          taskId: null,
          kind: 'command',
          title: `Run: ${body.command}`,
          detail: result.reason,
          risk: result.risk,
          payload: { projectId: body.projectId, command: body.command },
        });
        if (!decision.approved) {
          throw new NexusError('APPROVAL_REJECTED', 'Command was not approved', { httpStatus: 403 });
        }
        const approved = await app.terminal.run({ ...body, approved: true });
        res.json(approved);
        return;
      }
      res.json(result);
    }),
  );

  router.post(
    '/start',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({ projectId: z.string().min(1), command: z.string().min(1).max(2000), cwd: z.string().optional() }),
        req.body,
      );
      const result = app.terminal.start(body);
      if (isApprovalRequired(result)) {
        throw new NexusError('APPROVAL_REQUIRED', result.reason, { httpStatus: 428 });
      }
      res.status(201).json({ process: result });
    }),
  );

  router.get('/processes', asyncRoute(async (_req, res) => res.json({ processes: app.terminal.list() })));

  router.get(
    '/processes/:processId',
    asyncRoute(async (req, res) => {
      const processId = requireParam(req, 'processId');
      res.json({ process: app.terminal.get(processId), output: app.terminal.output(processId) });
    }),
  );

  router.post(
    '/processes/:processId/stop',
    asyncRoute(async (req, res) => res.json({ process: app.terminal.stop(requireParam(req, 'processId')) })),
  );

  router.post(
    '/processes/:processId/restart',
    asyncRoute(async (req, res) => res.json({ process: app.terminal.restart(requireParam(req, 'processId')) })),
  );

  router.get('/history', asyncRoute(async (_req, res) => res.json({ history: app.terminal.historyEntries(50) })));

  return router;
}

/* ----------------------------------------------------------------- editor */

const editOperation = z.union([
  z.object({ kind: z.literal('create'), relPath: z.string().min(1), content: z.string() }),
  z.object({ kind: z.literal('write'), relPath: z.string().min(1), content: z.string(), expectedHash: z.string().nullable().optional() }),
  z.object({
    kind: z.literal('replace'),
    relPath: z.string().min(1),
    search: z.string().min(1),
    replace: z.string(),
    expectedHash: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal('delete'), relPath: z.string().min(1), expectedHash: z.string().nullable().optional() }),
  z.object({ kind: z.literal('move'), relPath: z.string().min(1), to: z.string().min(1), expectedHash: z.string().nullable().optional() }),
  z.object({ kind: z.literal('mkdir'), relPath: z.string().min(1) }),
]);

export function editorRoutes(app: NexusApp): Router {
  const router = Router();

  router.post(
    '/stage',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          projectId: z.string().min(1),
          operations: z.array(editOperation).min(1).max(50),
          label: z.string().max(200).optional(),
        }),
        req.body,
      );
      res.json(app.editor.stage(body.projectId, body.operations as never[], body.label));
    }),
  );

  router.post(
    '/apply',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ operationId: z.string().min(1) }), req.body);
      const staged = app.editor.getStaged(body.operationId);
      if (!staged) throw new NexusError('NOT_FOUND', 'No staged edit set with that id');
      const decision = await app.approvals.request({
        taskId: null,
        kind: 'edit',
        title: `Apply ${staged.summary.files} file change(s)`,
        detail: `+${staged.summary.additions}/-${staged.summary.deletions} across ${staged.changes.map((c) => c.relPath).join(', ')}`,
        risk: 'high',
        payload: { operationId: body.operationId },
      });
      if (!decision.approved) {
        throw new NexusError('APPROVAL_REJECTED', 'The change was rejected', { httpStatus: 403 });
      }
      res.json(app.editor.apply(body.operationId, { approvedBy: decision.by }));
    }),
  );

  router.post(
    '/discard',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ operationId: z.string().min(1) }), req.body);
      res.json({ discarded: app.editor.discard(body.operationId) });
    }),
  );

  router.get(
    '/staged/:operationId',
    asyncRoute(async (req, res) => {
      const staged = app.editor.getStaged(requireParam(req, 'operationId'));
      if (!staged) throw new NexusError('NOT_FOUND', 'Staged edit set not found');
      res.json(staged);
    }),
  );

  return router;
}

/* -------------------------------------------------------------- snapshots */

export function snapshotRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = String(req.query.projectId ?? '');
      if (!projectId) throw new NexusError('VALIDATION_FAILED', 'projectId query param is required');
      res.json({ snapshots: app.snapshots.list(projectId) });
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({ projectId: z.string().min(1), label: z.string().min(1).max(200), relPaths: z.array(z.string()).optional() }),
        req.body,
      );
      const id = body.relPaths
        ? app.snapshots.capture({ projectId: body.projectId, relPaths: body.relPaths, operationId: `manual_${Date.now()}`, label: body.label, kind: 'manual' })
        : app.snapshots.captureProject(body.projectId, body.label);
      res.status(201).json({ snapshotId: id });
    }),
  );

  router.get(
    '/:snapshotId',
    asyncRoute(async (req, res) => res.json(app.snapshots.detail(requireParam(req, 'snapshotId')))),
  );

  router.get(
    '/:snapshotId/diff',
    asyncRoute(async (req, res) => {
      const relPath = String(req.query.path ?? '');
      if (!relPath) throw new NexusError('VALIDATION_FAILED', 'path query param is required');
      res.json(app.snapshots.diffWithCurrent(requireParam(req, 'snapshotId'), relPath));
    }),
  );

  router.post(
    '/:snapshotId/restore',
    asyncRoute(async (req, res) => {
      const snapshotId = requireParam(req, 'snapshotId');
      const body = parseBody(z.object({ relPaths: z.array(z.string()).optional() }), req.body);
      const detail = app.snapshots.detail(snapshotId);
      const decision = await app.approvals.request({
        taskId: null,
        kind: 'tool',
        title: `Restore snapshot "${detail.label}"`,
        detail: `This rewrites ${body.relPaths?.length ?? detail.files.length} file(s) on disk. A safety snapshot is taken first.`,
        risk: 'high',
        payload: { snapshotId },
      });
      if (!decision.approved) throw new NexusError('APPROVAL_REJECTED', 'Restore was not approved', { httpStatus: 403 });
      res.json(app.snapshots.restore(snapshotId, body.relPaths));
    }),
  );

  return router;
}

/* ----------------------------------------------------------------- search */

export function searchRoutes(app: NexusApp): Router {
  const router = Router();

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          projectId: z.string().min(1),
          query: z.string().min(1).max(1000),
          limit: z.number().int().min(1).max(50).optional(),
          semantic: z.boolean().optional(),
          pathFilter: z.string().optional(),
        }),
        req.body,
      );
      res.json(await app.search.search(body));
    }),
  );

  router.post(
    '/embed',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ projectId: z.string().min(1), limit: z.number().int().min(1).max(2000).optional() }), req.body);
      const job = app.jobs.start('embed', async ({ report }) => {
        report(0.1, 'Generating embeddings');
        const stored = await app.search.embedProject(body.projectId, body.limit ?? 400);
        report(1, `${stored} vectors stored`);
        return stored;
      }, { referenceId: body.projectId });
      res.status(202).json({ job });
    }),
  );

  return router;
}

/* ----------------------------------------------------------------- memory */

export function memoryRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const category = typeof req.query.category === 'string' ? (req.query.category as never) : undefined;
      res.json({ memories: app.memory.list({ projectId, category }), stats: app.memory.stats() });
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => res.status(201).json({ memory: app.memory.create(req.body) })),
  );

  router.patch(
    '/:memoryId',
    asyncRoute(async (req, res) => res.json({ memory: app.memory.update(requireParam(req, 'memoryId'), req.body) })),
  );

  router.delete(
    '/:memoryId',
    asyncRoute(async (req, res) => {
      app.memory.remove(requireParam(req, 'memoryId'));
      res.json({ removed: true });
    }),
  );

  router.get(
    '/export',
    asyncRoute(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : null;
      res.type('application/json').send(app.memory.export(projectId));
    }),
  );

  router.post(
    '/import',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ json: z.string().min(2), projectId: z.string().nullable().optional() }), req.body);
      res.json(app.memory.import(body.json, body.projectId ?? null));
    }),
  );

  return router;
}

/* -------------------------------------------------------------- workflows */

export function workflowRoutes(app: NexusApp): Router {
  const router = Router();

  const blockSchema = z.object({
    id: z.string().min(1).max(60),
    type: z.enum(['ai', 'file', 'terminal', 'browser', 'condition', 'approval', 'delay', 'transform', 'test']),
    label: z.string().min(1).max(120),
    config: z.record(z.unknown()),
    next: z.string().nullable(),
    onFalse: z.string().nullable(),
  });

  router.get('/', asyncRoute(async (_req, res) => res.json({ workflows: app.workflows.list() })));

  router.get(
    '/templates',
    asyncRoute(async (_req, res) => res.json({ templates: builtinTemplates(null) })),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(120),
          description: z.string().max(500).optional(),
          projectId: z.string().nullable().optional(),
          blocks: z.array(blockSchema).min(1).max(60),
          entry: z.string().nullable().optional(),
        }),
        req.body,
      );
      res.status(201).json({ workflow: app.db.workflows.create(body as never) });
    }),
  );

  router.get(
    '/:workflowId',
    asyncRoute(async (req, res) => {
      const workflow = app.db.workflows.get(requireParam(req, 'workflowId'));
      if (!workflow) throw new NexusError('NOT_FOUND', 'Workflow not found');
      res.json({ workflow, executions: app.db.workflows.executions(workflow.id, 20) });
    }),
  );

  router.patch(
    '/:workflowId',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          name: z.string().min(1).max(120).optional(),
          description: z.string().max(500).optional(),
          blocks: z.array(blockSchema).optional(),
          entry: z.string().nullable().optional(),
        }),
        req.body,
      );
      const updated = app.db.workflows.update(requireParam(req, 'workflowId'), body as never);
      if (!updated) throw new NexusError('NOT_FOUND', 'Workflow not found');
      res.json({ workflow: updated });
    }),
  );

  router.delete(
    '/:workflowId',
    asyncRoute(async (req, res) => res.json({ removed: app.db.workflows.remove(requireParam(req, 'workflowId')) })),
  );

  router.post(
    '/:workflowId/run',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ projectId: z.string().nullable().optional(), background: z.boolean().optional() }), req.body);
      const workflowId = requireParam(req, 'workflowId');
      if (body.background) {
        const job = app.jobs.start('workflow', async ({ report }) => {
          report(0.1, 'Running workflow');
          const execution = await app.workflows.run({ workflowId, projectId: body.projectId ?? null });
          report(1, `Workflow ${execution.status}`);
          return execution;
        }, { referenceId: workflowId });
        res.status(202).json({ job });
        return;
      }
      res.json({ execution: await app.workflows.run({ workflowId, projectId: body.projectId ?? null }) });
    }),
  );

  router.post(
    '/executions/:executionId/pause',
    asyncRoute(async (req, res) => {
      app.workflows.pause(requireParam(req, 'executionId'));
      res.json({ paused: true });
    }),
  );

  router.post(
    '/executions/:executionId/resume',
    asyncRoute(async (req, res) => res.json({ execution: await app.workflows.resume(requireParam(req, 'executionId')) })),
  );

  router.post(
    '/executions/:executionId/cancel',
    asyncRoute(async (req, res) => {
      app.workflows.cancel(requireParam(req, 'executionId'));
      res.json({ cancelled: true });
    }),
  );

  return router;
}

/* ---------------------------------------------------------------- browser */

export function browserRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/status',
    asyncRoute(async (_req, res) => {
      res.json({ driver: app.browser.driverKind(), ...(await app.browser.availability()) });
    }),
  );

  router.get('/sessions', asyncRoute(async (_req, res) => res.json({ sessions: app.browser.sessions_() })));

  router.post(
    '/sessions',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ headless: z.boolean().optional() }), req.body);
      res.status(201).json({ session: await app.browser.launch(body) });
    }),
  );

  router.delete(
    '/sessions/:sessionId',
    asyncRoute(async (req, res) => {
      await app.browser.close(requireParam(req, 'sessionId'));
      res.json({ closed: true });
    }),
  );

  router.post(
    '/action',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          sessionId: z.string().min(1),
          action: z.enum(['goto', 'click', 'fill', 'press', 'select', 'wait', 'text', 'html', 'screenshot', 'eval', 'url', 'errors']),
          url: z.string().optional(),
          selector: z.string().optional(),
          value: z.string().optional(),
          key: z.string().optional(),
          name: z.string().optional(),
          fullPage: z.boolean().optional(),
        }),
        req.body,
      );
      const classification = app.browser.classify(body);
      if (classification.sensitive) {
        const decision = await app.approvals.request({
          taskId: null,
          kind: 'browser',
          title: `Browser action: ${body.action}`,
          detail: classification.reason,
          risk: 'high',
          payload: { sessionId: body.sessionId, action: body.action, url: body.url },
        });
        if (!decision.approved) throw new NexusError('APPROVAL_REJECTED', 'Browser action was not approved', { httpStatus: 403 });
      }
      res.json(await app.browser.execute(body));
    }),
  );

  return router;
}

/* ----------------------------------------------------------------- vision */

export function visionRoutes(app: NexusApp): Router {
  const router = Router();
  router.post(
    '/analyze',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({
          imageBase64: z.string().optional(),
          imagePath: z.string().optional(),
          mimeType: z.string().optional(),
          prompt: z.string().min(3).max(4000),
          projectId: z.string().nullable().optional(),
        }),
        req.body,
      );
      res.json(await app.vision.analyze(body));
    }),
  );
  return router;
}

/* -------------------------------------------------------------- analytics */

export function analyticsRoutes(app: NexusApp): Router {
  const router = Router();
  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      res.json({
        analytics: app.db.observability.analytics(),
        usage: app.db.observability.usage(100),
        jobs: app.jobs.list().slice(0, 20),
      });
    }),
  );
  return router;
}

/* --------------------------------------------------------------- activity */

export function activityRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const limit = Number(req.query.limit ?? 100);
      res.json({
        activity: app.db.observability.activity({
          kind: typeof req.query.kind === 'string' ? req.query.kind : undefined,
          level: typeof req.query.level === 'string' ? req.query.level : undefined,
          projectId: typeof req.query.projectId === 'string' ? req.query.projectId : undefined,
          limit: Number.isFinite(limit) ? Math.min(limit, 500) : 100,
        }),
      });
    }),
  );

  router.get(
    '/notifications',
    asyncRoute(async (_req, res) => {
      res.json({
        notifications: app.db.observability.notifications(50),
        unread: app.db.observability.unreadNotificationCount(),
      });
    }),
  );

  router.post(
    '/notifications/read',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ id: z.string().optional() }), req.body);
      if (body.id) app.db.observability.markNotificationRead(body.id);
      else app.db.observability.markAllNotificationsRead();
      res.json({ unread: app.db.observability.unreadNotificationCount() });
    }),
  );

  router.get(
    '/audit',
    asyncRoute(async (req, res) => {
      res.json({ audit: app.db.observability.auditEntries(Math.min(Number(req.query.limit ?? 100), 500)) });
    }),
  );

  return router;
}

/* --------------------------------------------------------------- settings */

export function settingsRoutes(app: NexusApp): Router {
  const router = Router();

  router.get('/', asyncRoute(async (_req, res) => res.json(app.settings.response())));

  router.patch(
    '/',
    asyncRoute(async (req, res) => {
      const settings = app.settings.update(req.body);
      res.json({ settings, keys: app.settings.response().keys });
    }),
  );

  router.post(
    '/reset',
    asyncRoute(async (_req, res) => res.json({ settings: app.settings.reset() })),
  );

  router.post(
    '/keys',
    asyncRoute(async (req, res) => {
      const body = parseBody(z.object({ provider: z.enum(['gemini', 'groq']), key: z.string().min(8).max(500) }), req.body);
      res.json(app.settings.setApiKey(body.provider, body.key));
    }),
  );

  router.delete(
    '/keys/:provider',
    asyncRoute(async (req, res) => {
      const provider = requireParam(req, 'provider');
      if (provider !== 'gemini' && provider !== 'groq') throw new NexusError('VALIDATION_FAILED', 'Unknown provider');
      res.json(app.settings.clearApiKey(provider));
    }),
  );

  return router;
}

/* ------------------------------------------------------ tools & providers */

export function metaRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/tools',
    asyncRoute(async (_req, res) => res.json({ tools: app.registry.descriptors() })),
  );

  router.get(
    '/providers',
    asyncRoute(async (_req, res) => {
      res.json({ providers: app.router.status(), models: ALL_MODELS });
    }),
  );

  router.get(
    '/health',
    asyncRoute(async (_req, res) => {
      res.json({
        status: 'ok',
        database: { version: app.db.version },
        providers: app.router.configuredProviders(),
        browser: { driver: app.browser.driverKind(), ...(await app.browser.availability()) },
        version: '2.0.0',
      });
    }),
  );

  return router;
}

/* ------------------------------------------------------------------ jobs */

export function jobRoutes(app: NexusApp): Router {
  const router = Router();
  router.get('/', asyncRoute(async (_req, res) => res.json({ jobs: app.jobs.list() })));
  router.get(
    '/:jobId',
    asyncRoute(async (req, res) => {
      const job = app.jobs.get(requireParam(req, 'jobId'));
      if (!job) throw new NexusError('NOT_FOUND', 'Job not found');
      res.json({ job });
    }),
  );
  router.post(
    '/:jobId/cancel',
    asyncRoute(async (req, res) => res.json({ job: app.jobs.cancel(requireParam(req, 'jobId')) })),
  );
  return router;
}
