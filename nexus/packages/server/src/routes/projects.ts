/** Phase 1 REST surface: projects, scanning, analysis, tree. */
import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, parseBody, requireParam, sendError } from '../http.js';
import type { NexusApp } from '../../../core/src/app.js';
import { NexusError } from '../../../core/src/errors.js';
import { assertProjectRoot } from '../../../core/src/security/paths.js';

const createSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  rootPath: z.string().min(1),
  description: z.string().max(500).optional(),
  ignoredGlobs: z.array(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  ignoredGlobs: z.array(z.string()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export function projectsRoutes(app: NexusApp): Router {
  const router = Router();

  router.get(
    '/',
    asyncRoute(async (_req, res) => {
      const projects = await Promise.all(
        (await app.db.projects.list()).map(async (project) => ({
          ...project,
          fileCount: await app.db.projects.countFiles(project.id),
        })),
      );
      res.json({ projects });
    }),
  );

  router.post(
    '/',
    asyncRoute(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const rootPath = assertProjectRoot(body.rootPath);
      const existing = await app.db.projects.findByRoot(rootPath);
      if (existing) {
        throw new NexusError('CONFLICT', `This directory is already registered as "${existing.name}"`);
      }
      const name = body.name ?? rootPath.split(/[\\/]/).filter(Boolean).pop() ?? 'Project';
      const project = await app.db.projects.create({
        name,
        rootPath,
        description: body.description,
        ignoredGlobs: body.ignoredGlobs,
      });

      // Index in the background so the HTTP request stays fast.
      const job = app.jobs.start('index', async ({ report }) => {
        report(0.1, 'Scanning files');
        const result = await app.indexer.index(project.id);
        report(1, `Indexed ${result.scanned} files`);
        return result;
      }, { referenceId: project.id });

      await app.db.observability.addActivity({
        kind: 'system',
        level: 'info',
        title: 'Project registered',
        detail: `${project.name} → ${project.rootPath}`,
        projectId: project.id,
        taskId: null,
        provider: null,
        status: 'completed',
      });

      res.status(201).json({ project, job });
    }),
  );

  router.get(
    '/:projectId',
    asyncRoute(async (req, res) => {
      const project = await app.db.projects.get(requireParam(req, 'projectId'));
      if (!project) throw new NexusError('NOT_FOUND', 'Project not found');
      res.json({
        project: { ...project, fileCount: await app.db.projects.countFiles(project.id) },
        indexRuns: await app.db.projects.recentIndexRuns(project.id, 5),
      });
    }),
  );

  router.patch(
    '/:projectId',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      const patch = parseBody(updateSchema, req.body);
      const updated = await app.db.projects.update(projectId, patch);
      if (!updated) throw new NexusError('NOT_FOUND', 'Project not found');
      app.context.invalidate(projectId);
      res.json({ project: updated });
    }),
  );

  router.delete(
    '/:projectId',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      const project = await app.db.projects.get(projectId);
      if (!project) throw new NexusError('NOT_FOUND', 'Project not found');
      // Snapshots and blob files are cleaned before the cascade delete.
      await app.snapshots.purgeProject(projectId);
      app.orchestrator.releaseTask(projectId);
      await app.db.projects.remove(projectId);
      app.context.invalidate(projectId);
      res.json({ removed: true, projectId });
    }),
  );

  /** Incremental scan. Runs sync but bounded (max 20k files) to keep the UI honest. */
  router.post(
    '/:projectId/scan',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      const force = Boolean((req.body as { force?: boolean })?.force);
      const project = await app.db.projects.get(projectId);
      if (!project) throw new NexusError('NOT_FOUND', 'Project not found');
      const job = app.jobs.start('index', async ({ report }) => {
        report(0.2, 'Scanning');
        const result = await app.indexer.index(projectId, { force });
        report(1, `+${result.added} ~${result.modified} -${result.removed}`);
        app.context.invalidate(projectId);
        return result;
      }, { referenceId: projectId });
      res.status(202).json({ job });
    }),
  );

  router.get(
    '/:projectId/analysis',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      try {
        res.json({ analysis: await app.analyzer.analyze(projectId) });
      } catch (err) {
        sendError(res, err);
      }
    }),
  );

  router.get(
    '/:projectId/tree',
    asyncRoute(async (req, res) => {
      res.json(await app.editor.listTree(requireParam(req, 'projectId')));
    }),
  );

  router.get(
    '/:projectId/files',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      const files = await app.db.projects.files(projectId);
      res.json({ files, total: files.length });
    }),
  );

  router.get(
    '/:projectId/file',
    asyncRoute(async (req, res) => {
      const projectId = requireParam(req, 'projectId');
      const relPath = String(req.query.path ?? '');
      if (!relPath) throw new NexusError('VALIDATION_FAILED', 'query param "path" is required');
      res.json(await app.editor.readFile(projectId, relPath));
    }),
  );

  return router;
}
