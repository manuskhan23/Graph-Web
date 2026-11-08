/**
 * Tool contract. A tool is the ONLY way the agent can affect the outside world.
 * Each tool declares its schema, risk, permissions and timeout; the registry
 * enforces all of that before a single side effect happens.
 */
import type { z } from 'zod';
import type { RiskLevel, ToolDescriptor } from '../types.js';

export interface ToolContext {
  projectId: string | null;
  taskId: string | null;
  /** Resolved action id for correlating logs/snapshots. */
  executionId: string;
  /** Human approval already obtained for this call (from the approval gate). */
  approved: boolean;
  /** Agent role performing the call — used for per-role tool allow-lists. */
  agentRole: string;
  signal?: AbortSignal;
  /** Budget accounting: incremented by the registry per call. */
  onProgress?: (message: string) => void;
}

export interface ToolResult<T = unknown> {
  ok: boolean;
  summary: string;
  data?: T;
  /** Content handed back to the model as an observation. */
  observation: string;
  requiresApproval?: {
    reason: string;
    risk: RiskLevel;
    payload: Record<string, unknown>;
  };
}

export interface ToolDefinition<I = unknown, O = unknown> {
  descriptor: ToolDescriptor;
  schema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Roles allowed to call this tool. Empty = every role. */
  allowedRoles: string[];
  execute(input: I, ctx: ToolContext): Promise<ToolResult<O>>;
  /** Optional pre-flight: return a reason to require approval. */
  preflight?(input: I, ctx: ToolContext): Promise<{ reason: string; risk: RiskLevel } | null>;
}

export interface ToolExecutionOutcome {
  toolId: string;
  ok: boolean;
  summary: string;
  observation: string;
  durationMs: number;
  approved: boolean;
  denied: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}
