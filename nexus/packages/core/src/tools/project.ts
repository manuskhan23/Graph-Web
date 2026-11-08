/** Project intelligence tools: scan, analyze, architecture facts. */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { Database } from '../storage/db.js';
import type { ProjectIndexer } from '../project/indexer.js';
import type { ProjectAnalyzer } from '../project/analyzer.js';
import { NexusError } from '../errors.js';

export function createProjectTools(
  db: Database,
  indexer: ProjectIndexer,
  analyzer: ProjectAnalyzer,
): ToolDefinition<unknown, unknown>[] {
  const scanProject: ToolDefinition<{ force?: boolean }, unknown> = {
    descriptor: {
      id: 'project.scan',
      name: 'Scan project',
      description: 'Re-index the project incrementally (only changed files are re-read) and report added/modified/removed counts.',
      risk: 'low',
      category: 'project',
      timeoutMs: 120_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: { force: { type: 'boolean' } } },
      outputSchema: { type: 'object', properties: { added: { type: 'number' } } },
    },
    schema: z.object({ force: z.boolean().optional() }),
    outputSchema: z.object({ added: z.number(), modified: z.number(), removed: z.number(), indexVersion: z.number() }),
    allowedRoles: [],
    async execute(input, ctx) {
      if (!ctx.projectId) throw new NexusError('VALIDATION_FAILED', 'A project is required');
      const result = await indexer.index(ctx.projectId, { force: input.force });
      return {
        ok: true,
        summary: `Indexed: +${result.added} ~${result.modified} -${result.removed} (v${result.indexVersion})`,
        data: {
          added: result.added,
          modified: result.modified,
          removed: result.removed,
          indexVersion: result.indexVersion,
        },
        observation: `Index updated to v${result.indexVersion}: ${result.added} added, ${result.modified} modified, ${result.removed} removed, ${result.unchanged} unchanged (${result.durationMs} ms).`,
      };
    },
  };

  const analyzeProject: ToolDefinition<{ focus?: string }, unknown> = {
    descriptor: {
      id: 'project.analyze',
      name: 'Analyze architecture',
      description:
        'Static architecture analysis: technology stack, folder roles, entry points, API endpoints, data models and detected architectural issues.',
      risk: 'low',
      category: 'project',
      timeoutMs: 60_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { focus: { type: 'string', description: 'Optional area of interest, e.g. "auth" or "database"' } },
      },
      outputSchema: { type: 'object', properties: { technologies: { type: 'array' } } },
    },
    schema: z.object({ focus: z.string().optional() }),
    outputSchema: z.object({ technologies: z.array(z.unknown()), issues: z.array(z.unknown()), endpoints: z.array(z.unknown()) }),
    allowedRoles: [],
    async execute(input, ctx) {
      if (!ctx.projectId) throw new NexusError('VALIDATION_FAILED', 'A project is required');
      const analysis = await analyzer.analyze(ctx.projectId);
      const project = await db.projects.get(ctx.projectId);
      const focus = input.focus?.toLowerCase();
      const relevantFiles = focus
        ? analysis.files.filter(
            (f) =>
              f.relPath.toLowerCase().includes(focus) ||
              f.symbols.some((s) => s.toLowerCase().includes(focus)),
          )
        : [];

      const observation = [
        `Overview: ${analysis.overview}`,
        `Stack: ${analysis.technologies.map((t) => t.name).join(', ') || 'none detected'}`,
        `Scripts: ${Object.entries(analysis.scripts).map(([k, v]) => `${k}="${v}"`).join(' · ') || 'none'}`,
        `Endpoints (${analysis.endpoints.length}): ${analysis.endpoints.slice(0, 15).map((e) => `${e.method} ${e.path} (${e.file}:${e.line})`).join(', ')}`,
        `Models (${analysis.models.length}): ${analysis.models.slice(0, 10).map((m) => m.name).join(', ')}`,
        `Folders: ${analysis.folderRoles.map((f) => `${f.path}→${f.role}`).join(', ')}`,
        `Issues: ${analysis.issues.map((i) => `[${i.severity}] ${i.title}`).join('; ') || 'none'}`,
        focus && relevantFiles.length ? `Files matching "${input.focus}": ${relevantFiles.slice(0, 12).map((f) => f.relPath).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      return {
        ok: true,
        summary: `Analyzed ${analysis.stats.filesIndexed} files for ${project?.name ?? ctx.projectId}`,
        data: {
          overview: analysis.overview,
          technologies: analysis.technologies,
          endpoints: analysis.endpoints,
          models: analysis.models,
          issues: analysis.issues,
          stats: analysis.stats,
          folderRoles: analysis.folderRoles,
        },
        observation,
      };
    },
  };

  const dependencies: ToolDefinition<Record<string, unknown>, unknown> = {
    descriptor: {
      id: 'project.dependencies',
      name: 'List dependencies',
      description: 'Return declared dependencies and scripts from package manifests, plus per-file import edges.',
      risk: 'low',
      category: 'project',
      timeoutMs: 30_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', properties: { dependencies: { type: 'object' } } },
    },
    schema: z.object({}).passthrough(),
    outputSchema: z.object({ dependencies: z.record(z.unknown()), scripts: z.record(z.string()), imports: z.record(z.unknown()) }),
    allowedRoles: [],
    async execute(_input, ctx) {
      if (!ctx.projectId) throw new NexusError('VALIDATION_FAILED', 'A project is required');
      const analysis = await analyzer.analyze(ctx.projectId);
      const project = await db.projects.get(ctx.projectId);
      const pkgPath = project ? `${project.rootPath}/package.json` : '';
      let deps: Record<string, string> = {};
      try {
        const { readFileSync } = await import('node:fs');
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
      } catch {
        deps = {};
      }
      const imports: Record<string, string[]> = {};
      for (const file of analysis.files) {
        if (file.imports.length > 0) imports[file.relPath] = file.imports;
      }
      return {
        ok: true,
        summary: `${Object.keys(deps).length} dependencies, ${Object.keys(imports).length} files with imports`,
        data: { dependencies: deps, scripts: analysis.scripts, imports },
        observation: `Dependencies: ${Object.keys(deps).join(', ') || 'none'}\nScripts: ${Object.keys(analysis.scripts).join(', ') || 'none'}`,
      };
    },
  };

  return [scanProject, analyzeProject, dependencies] as ToolDefinition<unknown, unknown>[];
}
