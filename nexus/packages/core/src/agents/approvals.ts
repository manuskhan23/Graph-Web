/**
 * Approval gate (§8 permission system).
 *
 * A risky tool call creates a real approval record, flips the owning task to
 * `awaiting_approval`, emits an event, and *blocks* until a human resolves it or
 * the timeout expires. Nothing is auto-approved: absence of a decision is a
 * denial, never a permission.
 */
import { NexusError } from '../errors.js';
import type { ApprovalRequest, RiskLevel } from '../types.js';
import type { ObservabilityStore } from '../storage/contracts.js';
import type { TaskStore } from '../storage/contracts.js';
import type { EventBus } from '../events/bus.js';
import type { SettingsService } from '../settings/service.js';

interface Pending {
  resolve: (decision: { approved: boolean; by: string }) => void;
  timer: NodeJS.Timeout;
}

export class ApprovalGate {
  private pending = new Map<string, Pending>();

  constructor(
    private readonly observability: ObservabilityStore,
    private readonly tasks: TaskStore,
    private readonly settings: SettingsService,
    private readonly events?: EventBus,
  ) {}

  /** True when policy allows running without asking a human. */
  needsApproval(risk: RiskLevel): boolean {
    if (risk === 'low') return false;
    const policy = this.settings.get().agent.requireApprovalFor;
    if (risk === 'high') return policy.high !== false;
    return policy.medium !== false;
  }

  async request(input: {
    taskId: string | null;
    kind: ApprovalRequest['kind'];
    title: string;
    detail: string;
    risk: RiskLevel;
    payload: Record<string, unknown>;
    timeoutMs?: number;
    /** Short-circuit for tests / explicit auto-approve below a risk threshold. */
    autoApprove?: boolean;
  }): Promise<{ approved: boolean; by: string; id: string }> {
    if (input.autoApprove) {
      const record = await this.observability.createApproval({
        taskId: input.taskId,
        kind: input.kind,
        title: input.title,
        detail: input.detail,
        risk: input.risk,
        payload: input.payload,
      });
      await this.observability.resolveApproval(record.id, 'approved', 'policy:auto');
      return { approved: true, by: 'policy:auto', id: record.id };
    }

    const record = await this.observability.createApproval({
      taskId: input.taskId,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      risk: input.risk,
      payload: input.payload,
    });

    if (input.taskId) {
      await this.tasks.update(input.taskId, { status: 'awaiting_approval' });
    }
    this.events?.emit('approval.required', input.title, { approvalId: record.id, risk: input.risk, detail: input.detail }, {
      taskId: input.taskId,
    });
    await this.observability.addNotification({
      title: 'Approval required',
      body: input.title,
      level: 'warn',
    });

    const timeoutMs = input.timeoutMs ?? 10 * 60 * 1000;
    const decision = await new Promise<{ approved: boolean; by: string }>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(record.id);
        void this.observability.resolveApproval(record.id, 'rejected', 'timeout');
        resolve({ approved: false, by: 'timeout' });
      }, timeoutMs);
      // NOTE: deliberately not unref'd — a pending human decision is real work
      // and must keep the process (and the awaiting request) alive.
      this.pending.set(record.id, { resolve, timer });
    });

    if (input.taskId) {
      await this.tasks.update(input.taskId, { status: decision.approved ? 'running' : 'running' });
    }
    await this.observability.audit({
      actor: decision.by,
      action: `approval.${decision.approved ? 'approved' : 'rejected'}`,
      subject: record.id,
      allowed: decision.approved,
      metadata: { kind: input.kind, risk: input.risk, title: input.title },
    });
    return { ...decision, id: record.id };
  }

  async resolve(approvalId: string, approved: boolean, by = 'user'): Promise<ApprovalRequest> {
    const record = await this.observability.getApproval(approvalId);
    if (!record) throw new NexusError('NOT_FOUND', `Approval not found: ${approvalId}`);
    if (record.status !== 'pending') {
      throw new NexusError('CONFLICT', `Approval already ${record.status}`);
    }
    await this.observability.resolveApproval(approvalId, approved ? 'approved' : 'rejected', by);
    const pending = this.pending.get(approvalId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(approvalId);
      pending.resolve({ approved, by });
    }
    this.events?.emit('approval.resolved', `${approved ? 'Approved' : 'Rejected'}: ${record.title}`, {
      approvalId,
      approved,
    }, { taskId: record.taskId });
    return (await this.observability.getApproval(approvalId))!;
  }

  /** Deny every pending approval owned by a task (used by cancellation). */
  async denyTask(taskId: string, reason: string): Promise<number> {
    let denied = 0;
    for (const record of (await this.observability.approvals({ status: 'pending' })).filter((r) => r.taskId === taskId)) {
      if (record.taskId !== taskId) continue;
      const pending = this.pending.get(record.id);
      await this.observability.resolveApproval(record.id, 'rejected', reason);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(record.id);
        pending.resolve({ approved: false, by: reason });
      }
      denied += 1;
    }
    return denied;
  }

  async list(status?: ApprovalRequest['status']): Promise<ApprovalRequest[]> {
    return await this.observability.approvals(status ? { status } : {});
  }

  /** On shutdown, pending approvals become denials so nothing hangs. */
  async dispose(): Promise<void> {
    for (const [approvalId, pending] of this.pending) {
      clearTimeout(pending.timer);
      try {
        await this.observability.resolveApproval(approvalId, 'expired', 'shutdown');
      } catch {
        /* database already closed */
      }
      pending.resolve({ approved: false, by: 'shutdown' });
    }
    this.pending.clear();
  }
}
