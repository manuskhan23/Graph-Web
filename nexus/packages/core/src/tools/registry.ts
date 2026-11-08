/**
 * Central tool registry (§4.6, §8).
 *
 * Responsibilities:
 *  - registration + descriptor listing (used to build provider tool schemas)
 *  - schema validation of every input
 *  - agent-role allow-list enforcement
 *  - risk assessment → approval gate
 *  - timeout + structured logging + audit trail
 *  - a single funnel for every side effect in the application
 */
import { toNexusError, NexusError } from '../errors.js';
import type { RiskLevel, ToolDescriptor } from '../types.js';
import type { ObservabilityStore } from '../storage/contracts.js';
import type { EventBus } from '../events/bus.js';
import type { ApprovalGate } from '../agents/approvals.js';
import type { ToolContext, ToolDefinition, ToolExecutionOutcome } from './types.js';
import { id } from '../storage/driver.js';

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<unknown, unknown>>();

  constructor(
    private readonly observability: ObservabilityStore,
    private readonly approvals: ApprovalGate,
    private readonly events?: EventBus,
  ) {}

  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (this.tools.has(tool.descriptor.id)) {
      throw new Error(`Tool already registered: ${tool.descriptor.id}`);
    }
    this.tools.set(tool.descriptor.id, tool as unknown as ToolDefinition<unknown, unknown>);
  }

  registerAll(tools: ToolDefinition<unknown, unknown>[]): void {
    for (const tool of tools) this.register(tool);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  get(toolId: string): ToolDefinition<unknown, unknown> | undefined {
    return this.tools.get(toolId);
  }

  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()].map((t) => t.descriptor).sort((a, b) => a.id.localeCompare(b.id));
  }

  descriptorsForRole(role: string): ToolDescriptor[] {
    return [...this.tools.values()]
      .filter((t) => t.allowedRoles.length === 0 || t.allowedRoles.includes(role))
      .map((t) => t.descriptor)
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * Execute a tool with full validation, permission and audit handling.
   * Never throws for tool-level failures — returns a structured outcome so the
   * agent loop can observe and recover instead of crashing.
   */
  async execute(
    toolId: string,
    rawInput: unknown,
    ctx: Omit<ToolContext, 'executionId' | 'approved'> & { approved?: boolean },
  ): Promise<ToolExecutionOutcome> {
    const startedAt = Date.now();
    const executionId = id('call');
    const tool = this.tools.get(toolId);

    if (!tool) {
      const outcome: ToolExecutionOutcome = {
        toolId,
        ok: false,
        summary: `Unknown tool: ${toolId}`,
        observation: `Tool '${toolId}' does not exist. Available tools: ${this.descriptors().map((d) => d.id).join(', ')}`,
        durationMs: Date.now() - startedAt,
        approved: false,
        denied: true,
        error: { code: 'TOOL_NOT_FOUND', message: `Unknown tool: ${toolId}` },
      };
      await this.recordExecution(executionId, toolId, rawInput, ctx, outcome, 'low');
      return outcome;
    }

    const descriptor = tool.descriptor;

    // 1. Role permission
    if (tool.allowedRoles.length > 0 && !tool.allowedRoles.includes(ctx.agentRole)) {
      const outcome: ToolExecutionOutcome = {
        toolId,
        ok: false,
        summary: `Role '${ctx.agentRole}' may not use ${toolId}`,
        observation: `Permission denied: the ${ctx.agentRole} agent cannot call ${toolId}.`,
        durationMs: Date.now() - startedAt,
        approved: false,
        denied: true,
        error: { code: 'PERMISSION_DENIED', message: `Role ${ctx.agentRole} not allowed to call ${toolId}` },
      };
      await this.recordExecution(executionId, toolId, rawInput, ctx, outcome, descriptor.risk);
      void this.auditDenied(ctx, toolId, outcome.summary);
      return outcome;
    }

    // 2. Schema validation
    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
      const outcome: ToolExecutionOutcome = {
        toolId,
        ok: false,
        summary: `Invalid input for ${toolId}`,
        observation: `Invalid input: ${details}`,
        durationMs: Date.now() - startedAt,
        approved: false,
        denied: false,
        error: { code: 'VALIDATION_FAILED', message: details },
      };
      await this.recordExecution(executionId, toolId, rawInput, ctx, outcome, descriptor.risk);
      return outcome;
    }

    // 3. Risk / approval gate
    let approved = ctx.approved === true;
    let risk: RiskLevel = descriptor.risk;
    const preflight = tool.preflight ? await tool.preflight(parsed.data, { ...ctx, executionId, approved }) : null;
    if (preflight) risk = preflight.risk;
    const requiresHuman = descriptor.requiresApproval || Boolean(preflight) || risk === 'high';

    if (!approved && requiresHuman && this.approvals.needsApproval(risk)) {
      const decision = await this.approvals.request({
        taskId: ctx.taskId,
        kind: descriptor.category === 'terminal' ? 'command' : descriptor.category === 'browser' ? 'browser' : 'tool',
        title: `${descriptor.name} requires approval`,
        detail: preflight?.reason ?? descriptor.description,
        risk,
        payload: { toolId, input: sanitizeInput(parsed.data as Record<string, unknown>) },
      });
      approved = decision.approved;
      if (!approved) {
        const outcome: ToolExecutionOutcome = {
          toolId,
          ok: false,
          summary: `Approval ${decision.by === 'timeout' ? 'timed out' : 'rejected'} for ${descriptor.name}`,
          observation: `The user rejected approval for ${toolId}. Do not retry this action without new instructions.`,
          durationMs: Date.now() - startedAt,
          approved: false,
          denied: true,
          error: { code: 'APPROVAL_REJECTED', message: 'Human rejected the action' },
        };
        await this.recordExecution(executionId, toolId, rawInput, ctx, outcome, risk);
        return outcome;
      }
    }

    // 4. Execute with timeout
    this.events?.emit('tool.started', `Running ${descriptor.name}`, { toolId, risk }, {
      taskId: ctx.taskId,
      projectId: ctx.projectId,
    });

    const timeoutMs = descriptor.timeoutMs;
    let outcome: ToolExecutionOutcome;
    try {
      const result = await withTimeout(
        tool.execute(parsed.data, { ...ctx, executionId, approved }),
        timeoutMs,
        descriptor.name,
      );
      outcome = {
        toolId,
        ok: result.ok,
        summary: result.summary,
        observation: result.observation,
        durationMs: Date.now() - startedAt,
        approved,
        denied: false,
        data: result.data,
        ...(result.ok ? {} : { error: { code: 'TOOL_FAILED', message: result.summary } }),
      };
    } catch (err) {
      const nexus = toNexusError(err);
      outcome = {
        toolId,
        ok: false,
        summary: nexus.message,
        observation: `Tool ${toolId} failed: [${nexus.code}] ${nexus.message}`,
        durationMs: Date.now() - startedAt,
        approved,
        denied: nexus.code === 'APPROVAL_REJECTED' || nexus.code === 'PERMISSION_DENIED',
        error: { code: nexus.code, message: nexus.message },
      };
    }

    await this.recordExecution(executionId, toolId, rawInput, ctx, outcome, risk);
    this.events?.emit(
      outcome.ok ? 'tool.completed' : 'tool.failed',
      `${descriptor.name}: ${outcome.ok ? 'ok' : 'failed'}`,
      { toolId, durationMs: outcome.durationMs, summary: outcome.summary },
      { taskId: ctx.taskId, projectId: ctx.projectId },
    );
    await this.observability.addActivity({
      kind: 'tool',
      level: outcome.ok ? 'info' : outcome.denied ? 'warn' : 'error',
      title: `${descriptor.name}`,
      detail: outcome.summary,
      projectId: ctx.projectId,
      taskId: ctx.taskId,
      provider: null,
      status: outcome.ok ? 'success' : outcome.denied ? 'denied' : 'failed',
    });
    return outcome;
  }

  /** Convert descriptors to provider-facing function schemas. */
  toolSchemas(role: string) {
    return this.descriptorsForRole(role).map((descriptor) => ({
      name: descriptor.id,
      description: `${descriptor.description} (risk: ${descriptor.risk})`,
      parameters: descriptor.inputSchema,
    }));
  }

  private async recordExecution(
    executionId: string,
    toolId: string,
    input: unknown,
    ctx: { projectId: string | null; taskId: string | null },
    outcome: ToolExecutionOutcome,
    risk: RiskLevel,
  ): Promise<void> {
    try {
      await this.observability.addToolExecution({
        taskId: ctx.taskId,
        projectId: ctx.projectId,
        toolId,
        input: sanitizeInput(isRecord(input) ? input : { value: String(input) }),
        output: outcome.data === undefined ? { summary: outcome.summary } : outcome.data,
        status: outcome.ok ? 'success' : outcome.denied ? 'denied' : 'failed',
        risk,
        durationMs: outcome.durationMs,
        error: outcome.error ? `[${outcome.error.code}] ${outcome.error.message}` : null,
      });
      await this.observability.audit({
        actor: 'agent',
        action: 'tool.execute',
        subject: toolId,
        allowed: outcome.ok,
        reason: outcome.ok ? '' : outcome.summary,
        metadata: { executionId, risk, taskId: ctx.taskId },
      });
    } catch (err) {
      console.error('[nexus][tools] failed to record execution:', err);
    }
  }

  private async auditDenied(ctx: { taskId: string | null; agentRole: string }, toolId: string, reason: string): Promise<void> {
    try {
      await this.observability.audit({
        actor: ctx.agentRole,
        action: 'tool.execute',
        subject: toolId,
        allowed: false,
        reason,
        metadata: { taskId: ctx.taskId },
      });
    } catch {
      /* audit failures must not break execution */
    }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new NexusError('TOOL_TIMEOUT', `${label} timed out after ${timeoutMs} ms`, { retryable: true }));
    }, timeoutMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Strip anything secret-looking before persisting tool input. */
export function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (/key|secret|token|password|credential/i.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    if (typeof value === 'string') {
      out[key] = value.length > 4000 ? `${value.slice(0, 4000)}…[truncated]` : value;
      continue;
    }
    if (Array.isArray(value)) {
      out[key] = value.slice(0, 50);
      continue;
    }
    out[key] = value;
  }
  return out;
}
