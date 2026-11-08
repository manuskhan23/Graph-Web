/** Phase 12 — memory tools (with the secret guard applied to every write). */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { MemoryStore } from '../storage/contracts.js';
import type { MemoryCategory } from '../types.js';
import { NexusError } from '../errors.js';
import { assertNoSecretValue } from '../security/invariants.js';

const CATEGORIES = [
  'preference',
  'project_instruction',
  'coding_standard',
  'architecture_decision',
  'tech_stack',
  'task_outcome',
  'development_decision',
  'command',
] as const;

export function createMemoryTools(memories: MemoryStore): ToolDefinition<unknown, unknown>[] {
  const remember: ToolDefinition<{ content: string; category: MemoryCategory; importance?: number }, unknown> = {
    descriptor: {
      id: 'memory.remember',
      name: 'Save memory',
      description:
        'Persist a durable fact, preference or decision. Never store secrets, API keys or passwords — those writes are rejected.',
      risk: 'low',
      category: 'memory',
      timeoutMs: 10_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The fact to remember, one sentence' },
          category: { type: 'string', enum: [...CATEGORIES] },
          importance: { type: 'number', description: '1-5' },
        },
        required: ['content', 'category'],
      },
      outputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    },
    schema: z.object({
      content: z.string().min(3).max(2000),
      category: z.enum(CATEGORIES),
      importance: z.number().int().min(1).max(5).optional(),
    }),
    outputSchema: z.object({ id: z.string(), category: z.string() }),
    allowedRoles: [],
    async execute(input, ctx) {
      assertNoSecretValue(input.content, 'memory.remember');
      const memory = await memories.create({
        projectId: ctx.projectId,
        category: input.category,
        content: input.content,
        importance: input.importance ?? 3,
        source: 'agent',
      });
      return {
        ok: true,
        summary: `Saved memory (${input.category})`,
        data: { id: memory.id, category: memory.category },
        observation: `Remembered [${memory.category}]: ${memory.content}`,
      };
    },
  };

  const recall: ToolDefinition<{ query?: string; category?: MemoryCategory; limit?: number }, unknown> = {
    descriptor: {
      id: 'memory.recall',
      name: 'Recall memory',
      description: 'Search stored long-term memories for this project and global preferences.',
      risk: 'low',
      category: 'memory',
      timeoutMs: 10_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          limit: { type: 'number' },
        },
      },
      outputSchema: { type: 'object', properties: { memories: { type: 'array' } } },
    },
    schema: z.object({
      query: z.string().optional(),
      category: z.enum(CATEGORIES).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    outputSchema: z.object({ memories: z.array(z.object({ id: z.string(), content: z.string(), category: z.string() })) }),
    allowedRoles: [],
    async execute(input, ctx) {
      const found = input.query
        ? await memories.search(input.query, ctx.projectId)
        : await memories.list({ projectId: ctx.projectId, category: input.category, limit: input.limit ?? 20 });
      const filtered = input.category ? found.filter((m) => m.category === input.category) : found;
      return {
        ok: true,
        summary: `Recalled ${filtered.length} memory item(s)`,
        data: {
          memories: filtered.slice(0, input.limit ?? 20).map((m) => ({
            id: m.id,
            content: m.content,
            category: m.category,
            importance: m.importance,
          })),
        },
        observation: filtered.length
          ? filtered.slice(0, input.limit ?? 20).map((m) => `[${m.category}] ${m.content}`).join('\n')
          : 'No matching memories.',
      };
    },
  };

  const forget: ToolDefinition<{ id: string }, unknown> = {
    descriptor: {
      id: 'memory.forget',
      name: 'Delete memory',
      description: 'Delete a stored memory by id. Requires approval.',
      risk: 'high',
      category: 'memory',
      timeoutMs: 10_000,
      requiresProject: false,
      requiresApproval: true,
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      outputSchema: { type: 'object', properties: { deleted: { type: 'boolean' } } },
    },
    schema: z.object({ id: z.string().min(1) }),
    outputSchema: z.object({ deleted: z.boolean() }),
    allowedRoles: [],
    async execute(input) {
      const ok = memories.remove(input.id);
      if (!ok) throw new NexusError('NOT_FOUND', `Memory not found: ${input.id}`);
      return {
        ok: true,
        summary: `Deleted memory ${input.id}`,
        data: { deleted: true },
        observation: `Memory ${input.id} deleted.`,
      };
    },
  };

  return [remember, recall, forget] as ToolDefinition<unknown, unknown>[];
}
