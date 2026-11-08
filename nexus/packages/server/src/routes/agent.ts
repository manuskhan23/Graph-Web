/** Agent + chat + approval REST surface. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, parseBody, requireParam } from '../http.js';
import type { NexusApp } from '../../../core/src/app.js';
import { NexusError } from '../../../core/src/errors.js';

const attachmentSchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.string().min(3).max(100),
  base64: z.string().min(10).max(20_000_000),
});

const runSchema = z.object({
  projectId: z.string().nullable().optional(),
  message: z.string().min(1).max(20_000),
  conversationId: z.string().nullable().optional(),
  autoApproveBelow: z.enum(['low', 'medium', 'high']).nullable().optional(),
  attachments: z.array(attachmentSchema).max(4).optional(),
  /** When true, run in the background and return the task id immediately. */
  background: z.boolean().optional(),
});

const approvalSchema = z.object({ approved: z.boolean(), by: z.string().max(60).optional() });

export function agentRoutes(app: NexusApp): Router {
  const router = Router();

  router.post(
    '/run',
    asyncRoute(async (req, res) => {
      const body = parseBody(runSchema, req.body);

      const conversation =
        body.conversationId && app.db.conversations.get(body.conversationId)
          ? app.db.conversations.get(body.conversationId)!
          : app.db.conversations.create({
              projectId: body.projectId ?? null,
              title: body.message.slice(0, 60),
            });

      app.db.conversations.addMessage({
        conversationId: conversation.id,
        role: 'user',
        content: body.message,
        attachments: (body.attachments ?? []).map((a) => ({ name: a.name, mimeType: a.mimeType })),
      });

      if (body.background) {
        // Background mode: return a task id, stream progress over SSE.
        const task = app.db.tasks.create({
          projectId: body.projectId ?? null,
          conversationId: conversation.id,
          title: body.message.slice(0, 80),
          description: body.message,
          status: 'pending',
        });
        const job = app.jobs.start('agent', async ({ report }) => {
          report(0.05, 'Starting agent');
          const result = await app.runtime.run({
            projectId: body.projectId ?? null,
            message: body.message,
            conversationId: conversation.id,
            autoApproveBelow: body.autoApproveBelow ?? null,
            attachments: body.attachments,
          });
          report(1, `Task ${result.status}`);
          app.db.conversations.addMessage({
            conversationId: conversation.id,
            role: 'assistant',
            content: result.answer,
            toolCalls: result.steps.map((s) => ({ id: s.id, toolId: s.toolId, status: s.status })),
          });
          return result;
        }, { referenceId: task.id });

        res.status(202).json({ conversationId: conversation.id, taskId: task.id, jobId: job.id });
        return;
      }

      const result = await app.runtime.run({
        projectId: body.projectId ?? null,
        message: body.message,
        conversationId: conversation.id,
        autoApproveBelow: body.autoApproveBelow ?? null,
        attachments: body.attachments,
      });

      app.db.conversations.addMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: result.answer,
        provider: result.usage[0]?.provider ?? null,
        model: result.usage[0]?.model ?? null,
        toolCalls: result.steps.map((s) => ({ id: s.id, toolId: s.toolId, status: s.status })),
      });

      res.json({ ...result, conversationId: conversation.id });
    }),
  );

  router.get(
    '/roles',
    asyncRoute(async (_req, res) => {
      res.json({ agents: app.orchestrator.agents() });
    }),
  );

  router.get(
    '/leases',
    asyncRoute(async (_req, res) => {
      res.json({ leases: app.orchestrator.activeLeases() });
    }),
  );

  /* ---------------------------------------------------------- approvals */

  router.get(
    '/approvals',
    asyncRoute(async (req, res) => {
      const status = req.query.status as 'pending' | 'approved' | 'rejected' | 'expired' | undefined;
      res.json({ approvals: app.approvals.list(status) });
    }),
  );

  router.post(
    '/approvals/:approvalId',
    asyncRoute(async (req, res) => {
      const body = parseBody(approvalSchema, req.body);
      const approval = app.approvals.resolve(requireParam(req, 'approvalId'), body.approved, body.by ?? 'user');
      res.json({ approval });
    }),
  );

  return router;
}

const taskQuerySchema = z.object({
  status: z
    .enum(['pending', 'planning', 'awaiting_approval', 'running', 'paused', 'failed', 'completed', 'cancelled'])
    .optional(),
  projectId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export function tasksRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const query = parseBody(taskQuerySchema, req.query);
      res.json({ tasks: app.db.tasks.list(query) });
    }),
  );

  router.get(
    '/:taskId',
    asyncRoute(async (req, res) => {
      const task = app.db.tasks.get(requireParam(req, 'taskId'));
      if (!task) throw new NexusError('NOT_FOUND', 'Task not found');
      res.json({
        task,
        toolExecutions: app.db.observability.toolExecutions({ taskId: task.id, limit: 100 }),
        approvals: app.db.observability.approvals().filter((a) => a.taskId === task.id),
      });
    }),
  );

  router.post(
    '/:taskId/cancel',
    asyncRoute(async (req, res) => {
      const taskId = requireParam(req, 'taskId');
      const task = app.db.tasks.get(taskId);
      if (!task) throw new NexusError('NOT_FOUND', 'Task not found');
      app.runtime.cancel(taskId);
      res.json({ taskId, cancelled: true });
    }),
  );

  router.post(
    '/:taskId/pause',
    asyncRoute(async (req, res) => {
      const taskId = requireParam(req, 'taskId');
      app.runtime.pause(taskId);
      res.json({ taskId, paused: true });
    }),
  );

  router.post(
    '/:taskId/resume',
    asyncRoute(async (req, res) => {
      const taskId = requireParam(req, 'taskId');
      const result = await app.runtime.resume(taskId);
      res.json(result);
    }),
  );

  return router;
}

export function conversationsRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (req, res) => {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      res.json({ conversations: app.db.conversations.list(projectId ?? undefined) });
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = parseBody(
        z.object({ projectId: z.string().nullable().optional(), title: z.string().min(1).max(120) }),
        req.body,
      );
      res.status(201).json({ conversation: app.db.conversations.create({ projectId: body.projectId ?? null, title: body.title }) });
    }),
  );

  router.get(
    '/:conversationId/messages',
    asyncRoute(async (req, res) => {
      const conversationId = requireParam(req, 'conversationId');
      if (!app.db.conversations.get(conversationId)) throw new NexusError('NOT_FOUND', 'Conversation not found');
      res.json({ messages: app.db.conversations.messages(conversationId, 300) });
    }),
  );

  router.delete(
    '/:conversationId',
    asyncRoute(async (req, res) => {
      const conversationId = requireParam(req, 'conversationId');
      res.json({ removed: app.db.conversations.remove(conversationId) });
    }),
  );

  return router;
}
