/** File system tools (read = low risk, write/delete = medium/high risk). */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { EditorService, EditOperation } from '../editor/service.js';
import type { SnapshotService } from '../snapshots/service.js';
import type { Database } from '../storage/db.js';
import { NexusError } from '../errors.js';
import { condense } from '../context/chunker.js';

const editOperationSchema = z.union([
  z.object({ kind: z.literal('create'), relPath: z.string().min(1), content: z.string() }),
  z.object({
    kind: z.literal('write'),
    relPath: z.string().min(1),
    content: z.string(),
    expectedHash: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal('replace'),
    relPath: z.string().min(1),
    search: z.string().min(1),
    replace: z.string(),
    expectedHash: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal('delete'), relPath: z.string().min(1), expectedHash: z.string().nullable().optional() }),
  z.object({
    kind: z.literal('move'),
    relPath: z.string().min(1),
    to: z.string().min(1),
    expectedHash: z.string().nullable().optional(),
  }),
  z.object({ kind: z.literal('mkdir'), relPath: z.string().min(1) }),
]);

export interface FileToolDeps {
  db: Database;
  editor: EditorService;
  snapshots: SnapshotService;
}

/**
 * The search engine is injected after construction (it depends on the model
 * router, which depends on settings). A tiny holder avoids a circular import.
 */
export interface SearchEngineLike {
  search(options: {
    projectId: string;
    query: string;
    pathFilter?: string;
    limit?: number;
  }): Promise<{
    hits: { relPath: string; startLine: number; endLine: number; snippet: string }[];
    strategy: string;
  }>;
}

export const searchEngineRef: { current: SearchEngineLike | null } = { current: null };

export function setSearchEngine(engine: SearchEngineLike | null): void {
  searchEngineRef.current = engine;
}

export function createFileTools(deps: FileToolDeps): ToolDefinition<unknown, unknown>[] {
  const { db, editor, snapshots } = deps;

  const readFile: ToolDefinition<{ relPath: string; startLine?: number; endLine?: number }, unknown> = {
    descriptor: {
      id: 'file.read',
      name: 'Read file',
      description: 'Read a UTF-8 text file inside the active project. Returns numbered lines plus the content hash needed for safe edits.',
      risk: 'low',
      category: 'file',
      timeoutMs: 15_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          relPath: { type: 'string', description: 'Path relative to the project root' },
          startLine: { type: 'number', description: 'Optional 1-based first line' },
          endLine: { type: 'number', description: 'Optional 1-based last line' },
        },
        required: ['relPath'],
      },
      outputSchema: { type: 'object', properties: { content: { type: 'string' }, hash: { type: 'string' } } },
    },
    schema: z.object({
      relPath: z.string().min(1),
      startLine: z.number().int().positive().optional(),
      endLine: z.number().int().positive().optional(),
    }),
    outputSchema: z.object({ content: z.string(), hash: z.string(), lines: z.number() }),
    allowedRoles: [],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const file = editor.readFile(ctx.projectId!, input.relPath);
      const lines = file.content.split(/\r?\n/);
      const start = input.startLine ?? 1;
      const end = input.endLine ?? lines.length;
      const slice = lines.slice(start - 1, end);
      const numbered = slice.map((line, index) => `${start + index}: ${line}`).join('\n');
      return {
        ok: true,
        summary: `Read ${input.relPath} (${slice.length}/${lines.length} lines)`,
        data: { content: file.content, hash: file.hash, lines: lines.length },
        observation: `File ${input.relPath} (hash ${file.hash.slice(0, 12)}):\n${condense(numbered, 500)}`,
      };
    },
  };

  const listFiles: ToolDefinition<{ pathPrefix?: string; limit?: number }, unknown> = {
    descriptor: {
      id: 'file.list',
      name: 'List project files',
      description: 'List indexed files with language, size and line counts. Use before reading to locate relevant files.',
      risk: 'low',
      category: 'file',
      timeoutMs: 10_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          pathPrefix: { type: 'string', description: 'Only paths starting with this prefix' },
          limit: { type: 'number', description: 'Max files to return (default 200)' },
        },
      },
      outputSchema: { type: 'object', properties: { files: { type: 'array' } } },
    },
    schema: z.object({ pathPrefix: z.string().optional(), limit: z.number().int().min(1).max(2000).optional() }),
    outputSchema: z.object({ files: z.array(z.object({ relPath: z.string(), language: z.string(), lines: z.number() })) }),
    allowedRoles: [],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const limit = input.limit ?? 200;
      const files = db.projects
        .files(ctx.projectId!)
        .filter((f) => !input.pathPrefix || f.relPath.startsWith(input.pathPrefix))
        .slice(0, limit);
      const listing = files.map((f) => `${f.relPath} (${f.language}, ${f.lines} lines)`).join('\n');
      return {
        ok: true,
        summary: `Listed ${files.length} files`,
        data: { files: files.map((f) => ({ relPath: f.relPath, language: f.language, lines: f.lines })) },
        observation: files.length ? `Project files:\n${listing}` : 'No indexed files matched.',
      };
    },
  };

  const searchFiles: ToolDefinition<{ query: string; pathPrefix?: string; limit?: number }, unknown> = {
    descriptor: {
      id: 'file.search',
      name: 'Search code',
      description: 'Ranked code search across the indexed project. Returns file paths with line numbers and snippets.',
      risk: 'low',
      category: 'file',
      timeoutMs: 20_000,
      requiresProject: true,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Natural language or identifier query' },
          pathPrefix: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
      outputSchema: { type: 'object', properties: { hits: { type: 'array' } } },
    },
    schema: z.object({
      query: z.string().min(1),
      pathPrefix: z.string().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: z.object({ hits: z.array(z.unknown()) }),
    allowedRoles: [],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const engine = searchEngineRef.current;
      if (!engine) throw new NexusError('INTERNAL', 'Search engine is not wired into the tool context');
      const result = await engine.search({
        projectId: ctx.projectId,
        query: input.query,
        pathFilter: input.pathPrefix,
        limit: input.limit ?? 8,
      });
      const observation = result.hits
        .map((h) => `--- ${h.relPath}:${h.startLine}-${h.endLine}\n${h.snippet}`)
        .join('\n\n');
      return {
        ok: true,
        summary: `Found ${result.hits.length} match(es)`,
        data: { hits: result.hits },
        observation: result.hits.length ? observation : `No matches for "${input.query}".`,
      };
    },
  };

  const stagedEdits = new Map<string, { operationId: string; changeCount: number; snapshotId: string }>();

  const proposeEdit: ToolDefinition<{ operations: EditOperation[]; label?: string }, unknown> = {
    descriptor: {
      id: 'file.edit',
      name: 'Edit files',
      description:
        'Propose file edits. Validates paths, detects conflicts against the hash you read, creates a rollback snapshot and returns a diff. Changes are applied only when applied via file.applyEdit or user approval.',
      risk: 'medium',
      category: 'file',
      timeoutMs: 30_000,
      requiresProject: true,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short description of the change' },
          operations: {
            type: 'array',
            description: 'Edit operations',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['create', 'write', 'replace', 'delete', 'move', 'mkdir'] },
                relPath: { type: 'string' },
                content: { type: 'string' },
                search: { type: 'string' },
                replace: { type: 'string' },
                to: { type: 'string' },
                expectedHash: { type: 'string' },
              },
              required: ['kind', 'relPath'],
            },
          },
        },
        required: ['operations'],
      },
      outputSchema: { type: 'object', properties: { operationId: { type: 'string' }, diffs: { type: 'array' } } },
    },
    schema: z.object({
      operations: z.array(editOperationSchema).min(1).max(40),
      label: z.string().max(200).optional(),
    }),
    outputSchema: z.object({
      operationId: z.string(),
      snapshotId: z.string(),
      diffs: z.array(z.object({ relPath: z.string(), additions: z.number(), deletions: z.number(), unified: z.string() })),
    }),
    // Only agents that are allowed to write files may stage changes.
    allowedRoles: ['coding', 'debugging', 'testing', 'documentation'],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const staged = editor.stage(ctx.projectId!, input.operations as EditOperation[], input.label ?? 'Agent edit');
      stagedEdits.set(staged.operationId, {
        operationId: staged.operationId,
        changeCount: staged.changes.length,
        snapshotId: staged.snapshotId,
      });
      const diffs = staged.changes
        .filter((c) => c.diff)
        .map((c) => ({
          relPath: c.relPath,
          additions: c.diff!.additions,
          deletions: c.diff!.deletions,
          unified: c.diff!.unified,
        }));
      const summaryLine = `${staged.summary.files} file(s), +${staged.summary.additions}/-${staged.summary.deletions}`;
      return {
        ok: true,
        summary: `Staged edit set ${staged.operationId} (${summaryLine})`,
        data: { operationId: staged.operationId, snapshotId: staged.snapshotId, diffs },
        observation: `Staged changes (${summaryLine}). operationId=${staged.operationId}. Diffs:\n${diffs
          .map((d) => d.unified)
          .join('\n')
          .slice(0, 12_000)}`,
      };
    },
  };

  const applyEdit: ToolDefinition<{ operationId: string }, unknown> = {
    descriptor: {
      id: 'file.applyEdit',
      name: 'Apply staged edits',
      description: 'Write a previously staged edit set to disk. Re-verifies file hashes so concurrent user edits are never overwritten.',
      risk: 'high',
      category: 'file',
      timeoutMs: 30_000,
      requiresProject: true,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: { operationId: { type: 'string' } },
        required: ['operationId'],
      },
      outputSchema: { type: 'object', properties: { applied: { type: 'array' } } },
    },
    schema: z.object({ operationId: z.string().min(1) }),
    outputSchema: z.object({ applied: z.array(z.string()), snapshotId: z.string() }),
    allowedRoles: ['coding', 'debugging', 'testing', 'documentation'],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const result = editor.apply(input.operationId);
      stagedEdits.delete(input.operationId);
      return {
        ok: true,
        summary: `Applied ${result.applied.length} change(s)`,
        data: { applied: result.applied, snapshotId: result.snapshotId },
        observation: `Applied: ${result.applied.join(', ')}. Rollback snapshot: ${result.snapshotId}.`,
      };
    },
  };

  const restore: ToolDefinition<{ snapshotId: string; relPaths?: string[] }, unknown> = {
    descriptor: {
      id: 'file.restoreSnapshot',
      name: 'Restore snapshot',
      description: 'Restore files from a rollback snapshot. Takes a safety snapshot first so the restore itself is reversible.',
      risk: 'high',
      category: 'file',
      timeoutMs: 30_000,
      requiresProject: true,
      requiresApproval: true,
      inputSchema: {
        type: 'object',
        properties: { snapshotId: { type: 'string' }, relPaths: { type: 'array', items: { type: 'string' } } },
        required: ['snapshotId'],
      },
      outputSchema: { type: 'object', properties: { restored: { type: 'array' } } },
    },
    schema: z.object({ snapshotId: z.string().min(1), relPaths: z.array(z.string()).optional() }),
    outputSchema: z.object({ restored: z.array(z.string()), created: z.array(z.string()), deleted: z.array(z.string()) }),
    allowedRoles: ['coding', 'debugging', 'testing', 'documentation'],
    async execute(input, ctx) {
      requireProject(ctx.projectId);
      const result = snapshots.restore(input.snapshotId, input.relPaths);
      return {
        ok: true,
        summary: `Restored ${result.restored.length + result.created.length} file(s)`,
        data: { restored: result.restored, created: result.created, deleted: result.deleted, safety: result.safetySnapshotId },
        observation: `Restored ${result.restored.length}, created ${result.created.length}, deleted ${result.deleted.length}. Safety snapshot: ${result.safetySnapshotId}.`,
      };
    },
  };

  return [readFile, listFiles, searchFiles, proposeEdit, applyEdit, restore] as ToolDefinition<unknown, unknown>[];
}

function requireProject(projectId: string | null): asserts projectId is string {
  if (!projectId) throw new NexusError('VALIDATION_FAILED', 'This tool requires an active project');
}
