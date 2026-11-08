/**
 * Phase 9 — Multi-agent orchestration.
 *
 * A single orchestrator owns all agent activity. Its jobs:
 *  - register the 7 role agents in storage (so the UI shows real config)
 *  - route a request to a role
 *  - hand out *file leases* so two agents can never edit the same file at once
 *  - aggregate results and detect conflicts
 *
 * Agents never call each other directly; they return results to the orchestrator.
 */
import { NexusError } from '../errors.js';
import type { AgentDescriptor, AgentRole } from '../types.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import type { ToolRegistry } from '../tools/registry.js';
import { AGENT_DESCRIPTORS, AgentRoles } from './roles.js';
import { id } from '../storage/driver.js';

export interface DelegationRequest {
  role: AgentRole;
  taskId: string;
  projectId: string | null;
  /** Files the agent intends to write. Leased before execution. */
  files: string[];
}

export interface Lease {
  leaseId: string;
  taskId: string;
  role: AgentRole;
  files: string[];
  acquiredAt: number;
}

export interface OrchestrationResult {
  role: AgentRole;
  agent: string;
  allowedTools: string[];
  lease: Lease | null;
  conflicts: { file: string; heldBy: string }[];
}

export class AgentOrchestrator {
  /** Resolves when role definitions have been persisted. */
  readonly ready: Promise<void>;
  private leases = new Map<string, Lease>();
  private delegations: { at: number; role: AgentRole; taskId: string; files: string[]; status: string }[] = [];

  constructor(
    private readonly db: Database,
    private readonly events?: EventBus,
    private readonly registry?: ToolRegistry,
  ) {
    // Seeding is kicked off once; async callers may await `ready`.
    this.ready = this.seedAgents();
  }

  /** Persist role definitions so the UI and analytics read from real rows. */
  private async seedAgents(): Promise<void> {
    for (const agent of AGENT_DESCRIPTORS) {
      await this.db.observability.upsertAgent({
        role: agent.role,
        name: agent.name,
        description: agent.description,
        allowedTools: this.registry ? this.registry.descriptorsForRole(agent.role).map((d) => d.id) : agent.allowedTools,
        mayWriteFiles: agent.mayWriteFiles,
      });
    }
  }

  async agents(): Promise<AgentDescriptor[]> {
    await this.ready;
    const stored = await this.db.observability.agents();
    return stored.map((row) => ({
      role: row.role as AgentRole,
      name: row.name,
      description: row.description,
      allowedTools: row.allowedTools,
      mayWriteFiles: row.mayWriteFiles,
    }));
  }

  async agentFor(role: AgentRole): Promise<AgentDescriptor> {
    const agent = (await this.agents()).find((a) => a.role === role);
    if (!agent) throw new NexusError('NOT_FOUND', `Unknown agent role: ${role}`);
    return agent;
  }

  route(message: string): AgentRole {
    return AgentRoles.selectRole(message);
  }

  /**
   * Acquire a lease over the requested files. Returns conflicts rather than
   * silently proceeding, so the caller can queue, reassign or abort.
   */
  async delegate(request: DelegationRequest): Promise<OrchestrationResult> {
    const agent = await this.agentFor(request.role);
    const conflicts = this.findConflicts(request.files, request.taskId);

    if (conflicts.length > 0) {
      this.delegations.push({
        at: Date.now(),
        role: request.role,
        taskId: request.taskId,
        files: request.files,
        status: 'blocked',
      });
      this.events?.emit('task.updated', `File conflict detected for ${agent.name}`, {
        conflicts,
        taskId: request.taskId,
      });
      return { role: request.role, agent: agent.name, allowedTools: agent.allowedTools, lease: null, conflicts };
    }

    const lease: Lease = {
      leaseId: id('lease'),
      taskId: request.taskId,
      role: request.role,
      files: [...new Set(request.files)],
      acquiredAt: Date.now(),
    };
    if (lease.files.length > 0) this.leases.set(lease.leaseId, lease);
    this.delegations.push({
      at: Date.now(),
      role: request.role,
      taskId: request.taskId,
      files: request.files,
      status: 'granted',
    });
    if (this.delegations.length > 200) this.delegations.shift();
    return { role: request.role, agent: agent.name, allowedTools: agent.allowedTools, lease, conflicts: [] };
  }

  release(leaseId: string): boolean {
    return this.leases.delete(leaseId);
  }

  releaseTask(taskId: string): void {
    for (const [leaseId, lease] of this.leases) {
      if (lease.taskId === taskId) this.leases.delete(leaseId);
    }
  }

  activeLeases(): Lease[] {
    return [...this.leases.values()];
  }

  history(limit = 50) {
    return this.delegations.slice(-limit).reverse();
  }

  private findConflicts(files: string[], taskId: string): { file: string; heldBy: string }[] {
    const conflicts: { file: string; heldBy: string }[] = [];
    for (const lease of this.leases.values()) {
      if (lease.taskId === taskId) continue;
      for (const file of files) {
        if (lease.files.includes(file)) {
          conflicts.push({ file, heldBy: `${lease.role} (task ${lease.taskId})` });
        }
      }
    }
    return conflicts;
  }

  /** Aggregate per-role results into one report for the user. */
  async aggregate(results: { role: AgentRole; summary: string; ok: boolean }[]): Promise<string> {
    if (results.length === 0) return 'No agent produced a result.';
    const lines: string[] = [];
    for (const result of results) {
      const agent = await this.agentFor(result.role);
      lines.push(`${result.ok ? '✔' : '✖'} **${agent.name}** — ${result.summary}`);
    }
    return lines.join('\n');
  }
}
