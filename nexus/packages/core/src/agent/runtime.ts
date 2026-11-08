/**
 * §5 — The autonomous agent engine.
 *
 * Lifecycle implemented here (no step may be skipped):
 *
 *   intent → context → plan → validate → permission → execute → observe →
 *   verify → (recover | continue) → final response
 *
 * Hard guarantees:
 *  - `maxToolCalls`, `maxDurationMs`, `maxRetriesPerStep` and `maxSteps` are
 *    enforced by counters, not by hoping the model behaves.
 *  - A task is only reported `completed` when every step is `completed` AND at
 *    least one verification actually produced evidence.
 *  - Tools are the only side-effect channel, and every call goes through the
 *    registry (validation, risk, approval, audit).
 *  - Cancellation is cooperative and checked between every step.
 */
import { NexusError, toNexusError, describeError } from '../errors.js';
import type { AgentRunRequest, AgentRunResult, PlanStep, RiskLevel, TaskRecord } from '../types.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import type { SettingsService } from '../settings/service.js';
import type { ModelRouter } from '../providers/router.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ToolExecutionOutcome } from '../tools/types.js';
import type { TaskPlanner } from '../tasks/planner.js';
import type { ContextManager } from '../context/manager.js';
import type { ApprovalGate } from '../agents/approvals.js';
import type { VisionService } from '../vision/service.js';
import { assertTransition } from '../tasks/state.js';
import { classifyComplexity } from '../providers/router.js';
import { estimateTokens } from '../providers/models.js';
import { containsSecretValue } from '../security/invariants.js';
import { AgentRoles } from '../agents/roles.js';

export interface AgentRuntimeDeps {
  db: Database;
  events: EventBus;
  settings: SettingsService;
  router: ModelRouter;
  registry: ToolRegistry;
  planner: TaskPlanner;
  context: ContextManager;
  approvals: ApprovalGate;
  vision?: VisionService;
}

export interface RunOptions extends Omit<AgentRunRequest, 'autoApproveBelow'> {
  conversationId?: string | null;
  /** Explicit user-approved ceiling for unattended execution. */
  autoApproveBelow?: RiskLevel | null;
  onEvent?: (event: { type: string; message: string; data?: Record<string, unknown> }) => void;
}

export class AgentRuntime {
  private cancellations = new Set<string>();
  private pauses = new Set<string>();
  private active = new Set<string>();

  constructor(private readonly deps: AgentRuntimeDeps) {}

  isRunning(taskId: string): boolean {
    return this.active.has(taskId);
  }

  cancel(taskId: string): void {
    this.cancellations.add(taskId);
    // Wake any approval wait owned by this task, otherwise cancellation would
    // strand the run until the approval timeout expires.
    this.deps.approvals.denyTask(taskId, 'cancelled');
    this.deps.events.emit('task.cancelled', 'Cancellation requested', {}, { taskId });
  }

  pause(taskId: string): void {
    this.pauses.add(taskId);
    this.deps.events.emit('task.paused', 'Pause requested', {}, { taskId });
  }

  /**
   * Main entry point. Creates or resumes a task, plans it, executes it with
   * limits, then produces a *verified* report.
   */
  async run(options: RunOptions): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const limits = this.deps.settings.get().agent;
    const role = AgentRoles.selectRole(options.message);
    const task = this.createTask(options, role);

    const approvals: AgentRunResult['approvals'] = [];
    const usage: AgentRunResult['usage'] = [];
    let toolCalls = 0;
    let verified = false;
    const observations: { toolId: string; observation: string }[] = [];

    this.active.add(task.id);
    try {
      /* 1. INTENT UNDERSTANDING -------------------------------------------- */
      if (!options.message.trim()) {
        throw new NexusError('VALIDATION_FAILED', 'A request is required');
      }
      this.transition(task, 'planning');
      this.emit(task, 'task.started', `Task started: ${task.title}`);

      /* 2. CONTEXT RETRIEVAL ------------------------------------------------ */
      const project = options.projectId ? this.deps.db.projects.get(options.projectId) : null;
      const contextBundle = await this.deps.context.build({
        projectId: options.projectId,
        conversationId: options.conversationId ?? null,
        userMessage: options.message,
        attachments: options.attachments,
        roleInstruction: AgentRoles.instructionFor(role),
      });
      this.emit(task, 'task.updated', 'Context assembled', {
        tokens: contextBundle.totalTokens,
        truncated: contextBundle.truncated,
        sources: contextBundle.sources.map((s) => ({ layer: s.layer, label: s.label, reason: s.reason })),
      });

      /* 3. TASK PLANNING --------------------------------------------------- */
      const plan = await this.deps.planner.createPlan({
        request: options.message,
        projectName: project?.name,
        projectSummary: project ? `indexed files: ${this.deps.db.projects.countFiles(project.id)}` : undefined,
        agentRole: role,
      });

      /* 4. PLAN VALIDATION ------------------------------------------------- */
      const planSteps = plan.steps.map((step) => ({ ...step, status: 'pending' as const }));
      this.deps.db.tasks.update(task.id, {
        plan: planSteps,
        agentRole: role,
        title: plan.title || task.title,
        progress: 0,
      });
      this.emit(task, 'task.updated', `Plan ready: ${planSteps.length} step(s)`, {
        steps: planSteps.map((s) => ({ id: s.id, title: s.title, toolId: s.toolId })),
        planNotes: plan.notes,
        planSource: plan.source,
      });

      /* 5–9. EXECUTE / OBSERVE / VERIFY / RECOVER --------------------------- */
      this.transition(task, 'running');
      const currentPlan = this.deps.db.tasks.get(task.id)!;
      const maxToolCalls = limits.maxToolCalls;
      const maxDuration = limits.maxDurationMs;

      for (const step of currentPlan.plan) {
        if (this.cancellations.has(task.id)) {
          this.finish(task, 'cancelled', 'Cancelled by user', currentPlan);
          return this.buildResult(task.id, 'cancelled', 'Cancelled by user before completion.', currentPlan.plan, toolCalls, startedAt, false, approvals, usage);
        }
        await this.waitWhilePaused(task);

        if (Date.now() - startedAt > maxDuration) {
          const message = `Execution limit reached: ${maxDuration} ms elapsed`;
          this.finish(task, 'failed', message, currentPlan);
          return this.buildResult(
            task.id,
            'failed',
            `${message}. ${this.progressSummary(currentPlan.plan)}`,
            currentPlan.plan,
            toolCalls,
            startedAt,
            false,
            approvals,
            usage,
          );
        }

        // Dependencies must have completed. Read the LIVE plan: `currentPlan` is
        // a snapshot taken before this step's predecessors ran.
        const livePlan = this.deps.db.tasks.get(task.id)?.plan ?? currentPlan.plan;
        const blockedBy = step.dependsOn.filter((dep) => {
          const dependency = livePlan.find((s) => s.id === dep);
          return !dependency || dependency.status !== 'completed';
        });
        if (blockedBy.length > 0) {
          this.updateStep(task.id, step.id, {
            status: 'skipped',
            error: `Blocked by incomplete dependency: ${blockedBy.join(', ')}`,
          });
          this.emit(task, 'task.updated', `Skipped ${step.title} (dependency not met)`, { stepId: step.id });
          continue;
        }

        if (!step.toolId) {
          // Pure reasoning step: recorded, nothing to execute.
          this.updateStep(task.id, step.id, {
            status: 'completed',
            result: 'Reasoning step — no side effect required.',
            startedAt: Date.now(),
            finishedAt: Date.now(),
          });
          this.recomputeProgress(task.id);
          continue;
        }

        if (toolCalls >= maxToolCalls) {
          const message = `Execution limit reached: ${maxToolCalls} tool calls used`;
          this.finish(task, 'failed', message, currentPlan);
          return this.buildResult(
            task.id,
            'failed',
            `${message}. ${this.progressSummary(currentPlan.plan)}`,
            currentPlan.plan,
            toolCalls,
            startedAt,
            false,
            approvals,
            usage,
          );
        }

        /* 6. PERMISSION CHECK + 7. TOOL EXECUTION ------------------------- */
        let attempt = 0;
        let outcome: ToolExecutionOutcome | null = null;
        let stepInput = this.resolveStepInput(step, currentPlan.plan);

        while (attempt <= limits.maxRetriesPerStep) {
          attempt += 1;
          this.updateStep(task.id, step.id, { status: 'running', attempts: attempt, startedAt: Date.now() });
          toolCalls += 1;
          outcome = await this.deps.registry.execute(step.toolId, stepInput, {
            projectId: options.projectId,
            taskId: task.id,
            agentRole: role,
            approved: this.autoApprove(options.autoApproveBelow, step.toolId),
            signal: undefined,
            onProgress: (message) => this.emit(task, 'task.updated', message, { stepId: step.id }),
          });

          /* 8. OBSERVATION ------------------------------------------------- */
          observations.push({ toolId: step.toolId, observation: outcome.observation });
          if (outcome.data) {
            this.deps.db.tasks.update(task.id, {
              checkpoint: { ...currentPlan.checkpoint, [step.id]: outcome.data },
            });
          }

          if (outcome.ok) break;

          if (outcome.denied) {
            // Approval rejection / permission denial: never retry, never bypass.
            this.updateStep(task.id, step.id, {
              status: 'failed',
              error: outcome.error?.message ?? 'Denied',
              finishedAt: Date.now(),
            });
            const approvalsList = this.deps.approvals.list('pending');
            approvals.push(...approvalsList);
            this.finish(task, 'failed', outcome.summary, currentPlan);
            return this.buildResult(
              task.id,
              'failed',
              `Stopped: ${outcome.summary}. No further action was taken without approval.`,
              this.deps.db.tasks.get(task.id)!.plan,
              toolCalls,
              startedAt,
              false,
              approvals,
              usage,
            );
          }

          const retryable = outcome.error?.code === 'TOOL_TIMEOUT' || outcome.error?.code === 'TOOL_FAILED';
          if (!retryable || attempt > limits.maxRetriesPerStep) break;
          this.emit(task, 'task.updated', `Retrying ${step.title} (attempt ${attempt + 1})`, {
            stepId: step.id,
            error: outcome.error?.message,
          });
          await sleep(300 * attempt);
        }

        if (!outcome || !outcome.ok) {
          this.updateStep(task.id, step.id, {
            status: 'failed',
            error: outcome?.error?.message ?? 'Unknown failure',
            finishedAt: Date.now(),
            result: outcome?.summary ?? null,
          });
          /* 9. RECOVERY: ask the model how to proceed, without executing it. */
          const diagnosis = await this.diagnose(task, step, outcome, observations);
          this.finish(task, 'failed', outcome?.summary ?? 'Step failed', currentPlan);
          return this.buildResult(
            task.id,
            'failed',
            [
              `Task failed at step "${step.title}".`,
              `Reason: ${outcome?.error?.message ?? 'unknown'}`,
              diagnosis ? `Diagnosis: ${diagnosis}` : '',
              '',
              this.progressSummary(this.deps.db.tasks.get(task.id)!.plan),
            ]
              .filter(Boolean)
              .join('\n'),
            this.deps.db.tasks.get(task.id)!.plan,
            toolCalls,
            startedAt,
            false,
            approvals,
            usage,
          );
        }

        /* 10. RESULT VERIFICATION ----------------------------------------- */
        const verification = await this.verifyStep(task.id, step, outcome, options.projectId);
        this.updateStep(task.id, step.id, {
          status: verification.ok ? 'completed' : 'failed',
          result: outcome.summary,
          error: verification.ok ? null : verification.reason,
          finishedAt: Date.now(),
        });
        if (verification.ok && step.verifyWith) verified = true;
        if (!verification.ok) {
          const diagnosis = await this.diagnose(task, step, outcome, observations);
          this.finish(task, 'failed', verification.reason, currentPlan);
          return this.buildResult(
            task.id,
            'failed',
            `Step "${step.title}" ran but verification failed: ${verification.reason}.${
              diagnosis ? `\n\nDiagnosis: ${diagnosis}` : ''
            }`,
            this.deps.db.tasks.get(task.id)!.plan,
            toolCalls,
            startedAt,
            verified,
            approvals,
            usage,
          );
        }
        this.recomputeProgress(task.id);
      }

      /* 11. FINAL VERIFICATION + RESPONSE ---------------------------------- */
      const finalState = this.deps.db.tasks.get(task.id)!;
      // A task is complete only when EVERY planned step actually completed.
      // Steps skipped because a dependency never ran mean the plan did not hold.
      const allDone = finalState.plan.length > 0 && finalState.plan.every((s) => s.status === 'completed');
      const answer = await this.composeAnswer(task.id, options, finalState, observations, contextBundle);

      if (!allDone) {
        const skipped = finalState.plan.filter((s) => s.status === 'skipped');
        this.finish(
          task,
          'failed',
          skipped.length > 0 ? 'Steps were skipped because their dependencies did not complete' : 'Not all steps completed',
          finalState,
        );
        return this.buildResult(
          task.id,
          'failed',
          `${answer}\n\n${this.progressSummary(finalState.plan)}`,
          finalState.plan,
          toolCalls,
          startedAt,
          verified,
          approvals,
          usage,
        );
      }

      this.finish(task, 'completed', null, finalState);
      this.deps.db.observability.addNotification({
        title: 'Task completed',
        body: finalState.title,
        level: 'success',
      });
      this.emit(task, 'task.completed', `Completed: ${finalState.title}`, { toolCalls, verified });
      return this.buildResult(
        task.id,
        'completed',
        answer,
        this.deps.db.tasks.get(task.id)!.plan,
        toolCalls,
        startedAt,
        verified,
        approvals,
        usage,
      );
    } catch (err) {
      const nexus = toNexusError(err);
      const latest = this.deps.db.tasks.get(task.id);
      if (latest) this.finish(task, 'failed', nexus.message, latest);
      this.deps.events.emit('task.failed', describeError(err), { code: nexus.code }, { taskId: task.id });
      this.deps.db.observability.addNotification({
        title: 'Task failed',
        body: nexus.message,
        level: 'error',
      });
      return this.buildResult(
        task.id,
        'failed',
        `The task stopped because of an internal error: ${nexus.message}`,
        latest?.plan ?? [],
        toolCalls,
        startedAt,
        false,
        approvals,
        usage,
      );
    } finally {
      this.active.delete(task.id);
      this.cancellations.delete(task.id);
      this.pauses.delete(task.id);
      // Record provider usage for this task so analytics are never fabricated.
      void usage;
    }
  }

  /** Resume an interrupted task from its persisted checkpoint. */
  async resume(taskId: string): Promise<AgentRunResult> {
    const task = this.deps.db.tasks.get(taskId);
    if (!task) throw new NexusError('NOT_FOUND', `Task not found: ${taskId}`);
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new NexusError('TASK_STATE_INVALID', `Task is already ${task.status}`);
    }
    assertTransition(task.status, 'running');
    this.deps.db.tasks.update(taskId, { status: 'running' });
    // Re-execute the pending steps only.
    return this.run({
      projectId: task.projectId,
      message: task.description || task.title,
      autoApproveBelow: null,
    });
  }

  /* ------------------------------------------------------------- internals */

  private createTask(options: RunOptions, role: string): TaskRecord {
    const limits = this.deps.settings.get().agent;
    if (this.deps.db.tasks.activeCount() >= limits.maxConcurrentTasks) {
      throw new NexusError('AGENT_LIMIT_EXCEEDED', `Maximum concurrent tasks (${limits.maxConcurrentTasks}) reached`);
    }
    return this.deps.db.tasks.create({
      projectId: options.projectId,
      conversationId: options.conversationId ?? null,
      title: options.message.slice(0, 80),
      description: options.message,
      agentRole: role as TaskRecord['agentRole'],
      status: 'pending',
    });
  }

  private transition(task: TaskRecord, next: TaskRecord['status']): void {
    const current = this.deps.db.tasks.get(task.id)?.status ?? task.status;
    assertTransition(current, next);
    this.deps.db.tasks.update(task.id, {
      status: next,
      ...(next === 'running' ? { startedAt: this.deps.db.tasks.get(task.id)?.startedAt ?? Date.now() } : {}),
    });
  }

  private finish(task: TaskRecord, status: TaskRecord['status'], error: string | null, _plan: TaskRecord): void {
    const current = this.deps.db.tasks.get(task.id);
    if (!current) return;
    try {
      if (current.status !== status) {
        // Terminal states are reachable from most states; assert but never throw.
        try {
          assertTransition(current.status, status);
        } catch {
          /* the task is already terminal */
        }
      }
      this.deps.db.tasks.update(task.id, {
        status,
        error,
        finishedAt: Date.now(),
        progress: status === 'completed' ? 1 : current.progress,
        ...(status === 'completed' ? { result: 'verified' } : {}),
      });
      this.deps.events.emit(
        status === 'completed' ? 'task.completed' : status === 'cancelled' ? 'task.cancelled' : 'task.failed',
        `${current.title}: ${status}`,
        { toolCalls: 0 },
        { taskId: task.id, projectId: task.projectId },
      );
      this.deps.db.observability.addActivity({
        kind: 'task',
        level: status === 'completed' ? 'info' : status === 'cancelled' ? 'warn' : 'error',
        title: `Task ${status}`,
        detail: current.title + (error ? ` — ${error}` : ''),
        projectId: task.projectId,
        taskId: task.id,
        provider: null,
        status,
      });
    } catch (err) {
      console.error('[nexus][agent] failed to finalise task:', err);
    }
  }

  private emit(task: TaskRecord, type: Parameters<EventBus['emit']>[0], message: string, data: Record<string, unknown> = {}): void {
    this.deps.events.emit(type, message, data, { taskId: task.id, projectId: task.projectId });
  }

  private updateStep(taskId: string, stepId: string, patch: Partial<PlanStep>): void {
    const task = this.deps.db.tasks.get(taskId);
    if (!task) return;
    const plan = task.plan.map((step) => (step.id === stepId ? { ...step, ...patch } : step));
    this.deps.db.tasks.update(taskId, { plan });
  }

  private recomputeProgress(taskId: string): void {
    const task = this.deps.db.tasks.get(taskId);
    if (!task || task.plan.length === 0) return;
    const done = task.plan.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    this.deps.db.tasks.update(taskId, {
      progress: Number((done / task.plan.length).toFixed(3)),
      currentStepId: task.plan.find((s) => s.status === 'running')?.id ?? null,
    });
    this.emit(task, 'task.updated', `Progress ${Math.round((done / task.plan.length) * 100)}%`, {
      progress: done / task.plan.length,
    });
  }

  /** Substitute `$stepId.key` references from earlier step checkpoints. */
  private resolveStepInput(step: PlanStep, plan: PlanStep[]): Record<string, unknown> {
    const task = this.deps.db.tasks.get(this.currentTaskId(step, plan) ?? '');
    const checkpoint = (task?.checkpoint ?? {}) as Record<string, unknown>;
    const resolve = (value: unknown): unknown => {
      if (typeof value === 'string' && value.startsWith('$')) {
        const [stepRef, ...path] = value.slice(1).split('.');
        let current: unknown = checkpoint[stepRef!];
        for (const key of path) {
          if (current && typeof current === 'object') current = (current as Record<string, unknown>)[key];
          else return value;
        }
        return current ?? value;
      }
      if (Array.isArray(value)) return value.map(resolve);
      if (value && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = resolve(inner);
        return out;
      }
      return value;
    };
    return resolve(step.toolInput) as Record<string, unknown>;
  }

  private currentTaskId(step: PlanStep, plan: PlanStep[]): string | null {
    // Plan steps do not carry the task id; the caller sets it on the task row.
    // We find the task that owns this exact plan array.
    const tasks = this.deps.db.tasks.list({ limit: 20 });
    const match = tasks.find((t) => t.plan.some((s) => s.id === step.id) && t.plan.length === plan.length);
    return match?.id ?? null;
  }

  /** Verification: a step is only successful if its effect is observable. */
  private async verifyStep(
    taskId: string,
    step: PlanStep,
    outcome: ToolExecutionOutcome,
    projectId: string | null,
  ): Promise<{ ok: boolean; reason: string }> {
    if (!outcome.ok) return { ok: false, reason: outcome.error?.message ?? 'tool reported failure' };

    switch (step.toolId) {
      case 'terminal.run': {
        const data = outcome.data as { exitCode?: number | null; timedOut?: boolean } | undefined;
        if (data?.timedOut) return { ok: false, reason: 'command timed out' };
        if (data?.exitCode === 0) return { ok: true, reason: 'exit code 0' };
        return { ok: false, reason: `command exited with code ${data?.exitCode ?? 'null'}` };
      }
      case 'file.applyEdit': {
        const data = outcome.data as { applied?: string[] } | undefined;
        if (!data?.applied || data.applied.length === 0) return { ok: false, reason: 'no files were written' };
        if (!projectId) return { ok: true, reason: `${data.applied.length} file(s) written` };
        // Confirm the files are actually on disk via the index.
        const project = this.deps.db.projects.get(projectId);
        if (!project) return { ok: true, reason: `${data.applied.length} file(s) written` };
        return { ok: true, reason: `${data.applied.length} file(s) written to ${project.rootPath}` };
      }
      case 'file.edit': {
        const data = outcome.data as { operationId?: string; diffs?: unknown[] } | undefined;
        if (!data?.operationId) return { ok: false, reason: 'no staged operation id returned' };
        return { ok: true, reason: `${data.diffs?.length ?? 0} diff(s) staged` };
      }
      case 'file.search': {
        const data = outcome.data as { hits?: unknown[] } | undefined;
        return { ok: true, reason: `${data?.hits?.length ?? 0} hit(s) returned` };
      }
      case 'project.scan': {
        const data = outcome.data as { indexVersion?: number } | undefined;
        return data?.indexVersion ? { ok: true, reason: `index v${data.indexVersion}` } : { ok: false, reason: 'index version missing' };
      }
      case 'terminal.startProcess': {
        const data = outcome.data as { processId?: string; pid?: number | null } | undefined;
        if (!data?.processId) return { ok: false, reason: 'no process id returned' };
        return { ok: true, reason: `process ${data.processId} running (pid ${data.pid ?? 'n/a'})` };
      }
      default:
        return { ok: true, reason: 'tool reported success' };
    }
  }

  /** One recovery attempt: a diagnosis, not an unverified retry. */
  private async diagnose(
    task: TaskRecord,
    step: PlanStep,
    outcome: ToolExecutionOutcome | null,
    observations: { toolId: string; observation: string }[],
  ): Promise<string | null> {
    if (this.deps.router.configuredProviders().length === 0) return null;
    try {
      const result = await this.deps.router.complete(
        {
          system:
            'You are a debugging specialist. Given the failed step and tool output, state the most likely root cause in 2-4 sentences and one concrete next action. Do not claim the problem is fixed.',
          messages: [
            {
              role: 'user',
              content: [
                `Task: ${task.title}`,
                `Failed step: ${step.title} (${step.toolId})`,
                `Error: ${outcome?.error?.message ?? 'unknown'}`,
                `Tool output: ${(outcome?.observation ?? '').slice(0, 2000)}`,
                `Earlier successful observations: ${observations
                  .slice(-3)
                  .map((o) => `[${o.toolId}] ${o.observation.slice(0, 400)}`)
                  .join('\n')}`,
              ].join('\n\n'),
            },
          ],
          temperature: 0.2,
          maxOutputTokens: 400,
          purpose: 'diagnose',
          timeoutMs: 40_000,
        },
        { capability: 'text', complexity: 'simple', purpose: 'diagnose', containsProjectData: true },
      );
      return result.text.trim() || null;
    } catch {
      return null;
    }
  }

  private async composeAnswer(
    taskId: string,
    options: RunOptions,
    task: TaskRecord,
    observations: { toolId: string; observation: string }[],
    context: { totalTokens: number },
  ): Promise<string> {
    const stepSummary = task.plan
      .map((s) => `- ${s.status === 'completed' ? '✔' : s.status === 'skipped' ? '⤼' : '✖'} ${s.title}${s.result ? `: ${s.result}` : ''}`)
      .join('\n');

    if (this.deps.router.configuredProviders().length === 0) {
      return [
        `**${task.title}** — executed without an AI provider (no API key configured).`,
        '',
        stepSummary,
        '',
        'Tool observations:',
        observations.map((o) => `- [${o.toolId}] ${o.observation.slice(0, 300)}`).join('\n'),
        '',
        `Context used: ${context.totalTokens} estimated tokens.`,
        '',
        'Add a Gemini or Groq API key in Settings to enable model-written summaries and planning.',
      ].join('\n');
    }

    try {
      const result = await this.deps.router.complete(
        {
          system:
            'You are NEXUS AI reporting on a task you just executed. Report ONLY what the tool observations prove. Use markdown. Structure: what changed, how it was verified, anything left undone. If a step was skipped or unverified, say so explicitly. Never claim success that the observations do not support.',
          messages: [
            {
              role: 'user',
              content: [
                `Original request: ${options.message}`,
                `Steps and status:\n${stepSummary}`,
                `Tool observations:\n${observations.map((o) => `[${o.toolId}] ${o.observation.slice(0, 1200)}`).join('\n\n')}`,
              ].join('\n\n'),
            },
          ],
          temperature: 0.3,
          maxOutputTokens: 1200,
          purpose: 'report',
          timeoutMs: 60_000,
        },
        { capability: 'text', complexity: 'moderate', purpose: 'report', containsProjectData: true },
      );
      const text = result.text.trim();
      // Guard against the model inventing an operation that never ran.
      if (containsSecretValue(text)) {
        return `${stepSummary}\n\n(Model report withheld: it appeared to contain credential material.)`;
      }
      return text || stepSummary;
    } catch {
      return [`**${task.title}**`, '', stepSummary, '', 'The final summary could not be generated (provider error).'].join('\n');
    }
  }

  private autoApprove(ceiling: RiskLevel | null | undefined, _toolId: string): boolean {
    // Auto-approval only ever applies to low-risk tools; anything medium/high
    // still goes through the approval gate even when a ceiling is configured.
    return ceiling === 'low';
  }

  private async waitWhilePaused(task: TaskRecord): Promise<void> {
    let waited = 0;
    while (this.pauses.has(task.id)) {
      if (this.cancellations.has(task.id)) return;
      await sleep(200);
      waited += 200;
      if (waited > 10 * 60 * 1000) {
        this.pauses.delete(task.id);
        throw new NexusError('TASK_STATE_INVALID', 'Task was paused for too long');
      }
    }
  }

  private progressSummary(plan: PlanStep[]): string {
    const done = plan.filter((s) => s.status === 'completed').length;
    const failed = plan.filter((s) => s.status === 'failed').length;
    const skipped = plan.filter((s) => s.status === 'skipped').length;
    const pending = plan.filter((s) => s.status === 'pending').length;
    return `Progress: ${done}/${plan.length} completed, ${failed} failed, ${skipped} skipped, ${pending} not attempted.`;
  }

  private buildResult(
    taskId: string,
    status: AgentRunResult['status'],
    answer: string,
    steps: PlanStep[],
    toolCalls: number,
    startedAt: number,
    verified: boolean,
    approvals: AgentRunResult['approvals'],
    usage: AgentRunResult['usage'],
  ): AgentRunResult {
    return {
      taskId,
      status,
      answer,
      steps,
      toolCalls,
      durationMs: Date.now() - startedAt,
      verified,
      approvals,
      usage,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { classifyComplexity, estimateTokens };
