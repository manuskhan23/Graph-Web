/**
 * Phase 12 — Persistent memory service.
 *
 * Wraps the repository with the policy layer: secret rejection on every write,
 * project scoping, export/import, and an off switch that hides memories from
 * context assembly without deleting them.
 */
import { z } from 'zod';
import { NexusError } from '../errors.js';
import type { Memory, MemoryCategory } from '../types.js';
import type { MemoryStore } from '../storage/contracts.js';
import type { SettingsService } from '../settings/service.js';
import { assertNoSecretValue, containsSecretValue } from '../security/invariants.js';
import { id } from '../storage/driver.js';

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

export const memoryInputSchema = z.object({
  content: z.string().min(3).max(4000),
  category: z.enum(CATEGORIES),
  projectId: z.string().nullable().optional(),
  importance: z.number().int().min(1).max(5).optional(),
});

export class MemoryService {
  constructor(
    private readonly repo: MemoryStore,
    private readonly settings: SettingsService,
  ) {}

  private ensureEnabled(): void {
    if (!this.settings.get().app.memoryEnabled) {
      throw new NexusError('PERMISSION_DENIED', 'Memory is disabled in Settings');
    }
  }

  async list(filter: { projectId?: string | null; category?: MemoryCategory; limit?: number } = {}): Promise<Memory[]> {
    if (!this.settings.get().app.memoryEnabled) return [];
    return await this.repo.list(filter);
  }

  async create(input: unknown): Promise<Memory> {
    this.ensureEnabled();
    const parsed = memoryInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new NexusError('VALIDATION_FAILED', 'Invalid memory', { details: parsed.error.flatten() });
    }
    assertNoSecretValue(parsed.data.content, 'memory.create');
    return await this.repo.create({
      projectId: parsed.data.projectId ?? null,
      category: parsed.data.category,
      content: parsed.data.content,
      importance: parsed.data.importance ?? 3,
      source: 'user',
    });
  }

  async update(memoryId: string, patch: unknown): Promise<Memory> {
    this.ensureEnabled();
    const schema = z.object({
      content: z.string().min(3).max(4000).optional(),
      category: z.enum(CATEGORIES).optional(),
      importance: z.number().int().min(1).max(5).optional(),
    });
    const parsed = schema.safeParse(patch);
    if (!parsed.success) throw new NexusError('VALIDATION_FAILED', 'Invalid memory update');
    if (parsed.data.content) assertNoSecretValue(parsed.data.content, 'memory.update');
    const updated = await this.repo.update(memoryId, parsed.data);
    if (!updated) throw new NexusError('NOT_FOUND', `Memory not found: ${memoryId}`);
    return updated;
  }

  async remove(memoryId: string): Promise<void> {
    if (!await this.repo.remove(memoryId)) throw new NexusError('NOT_FOUND', `Memory not found: ${memoryId}`);
  }

  async search(term: string, projectId?: string | null): Promise<Memory[]> {
    if (!this.settings.get().app.memoryEnabled) return [];
    return await this.repo.search(term, projectId);
  }

  async stats(): Promise<{ byCategory: Record<string, number>; enabled: boolean }> {
    return { byCategory: await this.repo.countByCategory(), enabled: this.settings.get().app.memoryEnabled };
  }

  /** JSON export. Secrets are filtered out defensively, not just on write. */
  async export(projectId?: string | null): Promise<string> {
    const memories = await this.repo.list({ projectId: projectId ?? undefined, limit: 10_000 });
    const safe = memories
      .filter((m) => !containsSecretValue(m.content))
      .map((m) => ({
        id: m.id,
        projectId: m.projectId,
        category: m.category,
        content: m.content,
        importance: m.importance,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        source: m.source,
      }));
    return JSON.stringify({ version: 1, exportedAt: Date.now(), memories: safe }, null, 2);
  }

  async import(json: string, projectId?: string | null): Promise<{ imported: number; skipped: number }> {
    this.ensureEnabled();
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new NexusError('VALIDATION_FAILED', 'Import file is not valid JSON');
    }
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { memories?: unknown[] })?.memories;
    if (!Array.isArray(list)) throw new NexusError('VALIDATION_FAILED', 'Import JSON has no memories array');

    let imported = 0;
    let skipped = 0;
    for (const item of list) {
      const candidate = item as Record<string, unknown>;
      const parsedItem = memoryInputSchema.safeParse({
        content: candidate.content,
        category: candidate.category,
        projectId: candidate.projectId ?? projectId ?? null,
        importance: candidate.importance,
      });
      if (!parsedItem.success || containsSecretValue(String(candidate.content ?? ''))) {
        skipped += 1;
        continue;
      }
      await this.repo.create({
        projectId: parsedItem.data.projectId ?? null,
        category: parsedItem.data.category,
        content: parsedItem.data.content,
        importance: parsedItem.data.importance ?? 3,
        source: 'import',
      });
      imported += 1;
    }
    return { imported, skipped };
  }

  /** Called by the agent after a verified task to record durable outcomes. */
  async recordOutcome(input: { projectId: string | null; summary: string }): Promise<Memory | null> {
    if (!this.settings.get().app.memoryEnabled) return null;
    if (containsSecretValue(input.summary)) return null;
    const content = `Task outcome (${new Date().toISOString().slice(0, 10)}): ${input.summary.slice(0, 500)}`;
    try {
      return await this.repo.create({
        projectId: input.projectId,
        category: 'task_outcome',
        content,
        importance: 2,
        source: 'agent',
      });
    } catch {
      return null;
    }
  }
}

export { id };
