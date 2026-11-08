/**
 * Phase 10 — Workflow automation engine.
 *
 * Executes a graph of blocks (ai | file | terminal | browser | condition |
 * approval | delay | transform | test) from an entry node. Execution is
 * *pausable and resumable*: the cursor and log are persisted after every block,
 * so a paused or crashed execution can continue where it stopped.
 *
 * Condition blocks evaluate a whitelisted expression language — never `eval`.
 */
import { NexusError, describeError } from '../errors.js';
import type { WorkflowBlock, WorkflowDefinition, WorkflowExecution } from '../types.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ApprovalGate } from '../agents/approvals.js';

export interface WorkflowEngineDeps {
  db: Database;
  events?: EventBus;
  registry: ToolRegistry;
  approvals: ApprovalGate;
}

export interface WorkflowRunOptions {
  workflowId: string;
  projectId?: string | null;
  /** Seed variables available to transform/condition blocks. */
  variables?: Record<string, unknown>;
  maxBlocks?: number;
}

export class WorkflowEngine {
  private paused = new Set<string>();
  private cancelled = new Set<string>();
  private running = new Set<string>();

  constructor(private readonly deps: WorkflowEngineDeps) {}

  async list() {
    return await this.deps.db.workflows.list();
  }

  pause(executionId: string): void {
    this.paused.add(executionId);
  }

  cancel(executionId: string): void {
    this.cancelled.add(executionId);
  }

  isRunning(executionId: string): boolean {
    return this.running.has(executionId);
  }

  /** Start a new execution. */
  async run(options: WorkflowRunOptions): Promise<WorkflowExecution> {
    const workflow = await this.deps.db.workflows.get(options.workflowId);
    if (!workflow) throw new NexusError('NOT_FOUND', `Workflow not found: ${options.workflowId}`);
    if (workflow.blocks.length === 0) throw new NexusError('VALIDATION_FAILED', 'Workflow has no blocks');
    const execution = await this.deps.db.workflows.createExecution(workflow);
    return this.execute(execution, workflow, options);
  }

  /** Resume a paused or interrupted execution from its persisted cursor. */
  async resume(executionId: string): Promise<WorkflowExecution> {
    const execution = await this.deps.db.workflows.getExecution(executionId);
    if (!execution) throw new NexusError('NOT_FOUND', `Execution not found: ${executionId}`);
    if (execution.status === 'completed' || execution.status === 'cancelled') {
      throw new NexusError('TASK_STATE_INVALID', `Execution is already ${execution.status}`);
    }
    const workflow = await this.deps.db.workflows.get(execution.workflowId);
    if (!workflow) throw new NexusError('NOT_FOUND', 'Workflow no longer exists');
    this.paused.delete(executionId);
    execution.status = 'running';
    await this.deps.db.workflows.saveExecution(execution);
    return this.execute(execution, workflow, { workflowId: workflow.id, projectId: execution.projectId });
  }

  private async execute(
    execution: WorkflowExecution,
    workflow: WorkflowDefinition,
    options: WorkflowRunOptions,
  ): Promise<WorkflowExecution> {
    const maxBlocks = options.maxBlocks ?? 60;
    const variables: Record<string, unknown> = { ...(options.variables ?? {}) };
    let cursor = execution.cursor ?? workflow.entry;
    let executed = 0;
    this.running.add(execution.id);

    try {
      while (cursor) {
        if (executed >= maxBlocks) {
          // Persist the failure on the execution record and return it. Throwing
          // here would leave the execution stuck in 'running' forever.
          execution.status = 'failed';
          execution.error = `Workflow exceeded ${maxBlocks} block executions (possible infinite loop)`;
          execution.finishedAt = Date.now();
          await this.deps.db.workflows.saveExecution(execution);
          await this.deps.db.observability.addNotification({
            title: 'Workflow stopped',
            body: execution.error,
            level: 'error',
          });
          return execution;
        }
        if (this.cancelled.has(execution.id)) {
          execution.status = 'cancelled';
          execution.finishedAt = Date.now();
          await this.deps.db.workflows.saveExecution(execution);
          return execution;
        }
        if (this.paused.has(execution.id)) {
          execution.status = 'paused';
          execution.cursor = cursor;
          await this.deps.db.workflows.saveExecution(execution);
          return execution;
        }

        const block = workflow.blocks.find((b) => b.id === cursor);
        if (!block) {
          throw new NexusError('VALIDATION_FAILED', `Workflow references a missing block: ${cursor}`);
        }
        executed += 1;
        execution.cursor = block.id;
        this.deps.events?.emit(
          'workflow.step',
          `${workflow.name}: ${block.label}`,
          { executionId: execution.id, blockId: block.id, type: block.type },
          { projectId: workflow.projectId },
        );

        let result: { ok: boolean; detail: string; next?: string | null };
        try {
          result = await this.runBlock(block, { variables, execution, workflow, projectId: options.projectId ?? workflow.projectId ?? null });
        } catch (err) {
          result = { ok: false, detail: describeError(err) };
        }

        execution.log.push({
          at: Date.now(),
          blockId: block.id,
          type: block.type,
          status: result.ok ? 'success' : 'failed',
          detail: result.detail.slice(0, 2000),
        });
        await this.deps.db.workflows.saveExecution(execution);

        if (!result.ok) {
          execution.status = 'failed';
          execution.error = result.detail;
          execution.finishedAt = Date.now();
          await this.deps.db.workflows.saveExecution(execution);
          await this.deps.db.observability.addNotification({
            title: 'Workflow failed',
            body: `${workflow.name} — ${block.label}: ${result.detail.slice(0, 200)}`,
            level: 'error',
          });
          return execution;
        }

        // Choose the next node.
        if (result.next !== undefined) {
          cursor = result.next;
        } else if (block.type === 'condition' && result.next === undefined) {
          cursor = block.next;
        } else {
          cursor = block.next ?? null;
        }
      }

      execution.status = 'completed';
      execution.finishedAt = Date.now();
      execution.cursor = null;
      await this.deps.db.workflows.saveExecution(execution);
      await this.deps.db.observability.addNotification({
        title: 'Workflow completed',
        body: `${workflow.name} finished (${execution.log.length} blocks)`,
        level: 'success',
      });
      return execution;
    } finally {
      this.running.delete(execution.id);
      this.paused.delete(execution.id);
      this.cancelled.delete(execution.id);
    }
  }

  private async runBlock(
    block: WorkflowBlock,
    ctx: {
      variables: Record<string, unknown>;
      execution: WorkflowExecution;
      workflow: WorkflowDefinition;
      projectId: string | null;
    },
  ): Promise<{ ok: boolean; detail: string; next?: string | null }> {
    const { variables, projectId } = ctx;
    const config = block.config as Record<string, unknown>;

    switch (block.type) {
      case 'ai': {
        if (!projectId) {
          const prompt = this.interpolate(String(config.prompt ?? ''), variables);
          variables.lastAiResult = prompt ? `(no project context) ${prompt.slice(0, 200)}` : '';
          return { ok: true, detail: 'AI block requires a project; recorded prompt only' };
        }
        const tool = 'project.analyze';
        const outcome = await this.deps.registry.execute(tool, { focus: config.focus }, {
          projectId,
          taskId: null,
          agentRole: 'analyst',
        });
        variables.lastAiResult = outcome.observation;
        return { ok: outcome.ok, detail: outcome.summary };
      }
      case 'file': {
        const toolId = String(config.toolId ?? 'file.search');
        const input = this.interpolateObject(config.input ?? {}, variables);
        const outcome = await this.deps.registry.execute(toolId, input, {
          projectId,
          taskId: null,
          agentRole: 'coding',
        });
        variables.lastFileResult = outcome.data;
        return { ok: outcome.ok, detail: outcome.summary };
      }
      case 'terminal': {
        const command = this.interpolate(String(config.command ?? ''), variables);
        if (!command) return { ok: false, detail: 'terminal block has no command' };
        const outcome = await this.deps.registry.execute('terminal.run', { command }, {
          projectId,
          taskId: null,
          agentRole: 'testing',
        });
        variables.lastCommand = { command, output: outcome.observation };
        return { ok: outcome.ok, detail: outcome.summary };
      }
      case 'test': {
        const command = String(config.command ?? 'npm test --if-present');
        const outcome = await this.deps.registry.execute('terminal.run', { command }, {
          projectId,
          taskId: null,
          agentRole: 'testing',
        });
        variables.lastTest = { ok: outcome.ok, output: outcome.observation };
        return { ok: outcome.ok, detail: outcome.summary };
      }
      case 'browser': {
        const action = String(config.action ?? 'inspect');
        const sessionId = variables.browserSessionId as string | undefined;
        if (action === 'open') {
          const outcome = await this.deps.registry.execute('browser.open', { headless: config.headless ?? true }, {
            projectId,
            taskId: null,
            agentRole: 'browser',
          });
          const data = outcome.data as { sessionId?: string } | undefined;
          if (data?.sessionId) variables.browserSessionId = data.sessionId;
          return { ok: outcome.ok, detail: outcome.summary };
        }
        if (!sessionId) return { ok: false, detail: 'browser block requires an open session (use an open block first)' };
        const toolId =
          action === 'goto' ? 'browser.goto' : action === 'screenshot' ? 'browser.screenshot' : action === 'interact' ? 'browser.interact' : 'browser.inspect';
        const input =
          action === 'goto'
            ? { sessionId, url: this.interpolate(String(config.url ?? ''), variables) }
            : action === 'interact'
              ? {
                  sessionId,
                  action: config.interact ?? 'click',
                  selector: this.interpolate(String(config.selector ?? ''), variables),
                  value: this.interpolate(String(config.value ?? ''), variables),
                }
              : action === 'screenshot'
                ? { sessionId, name: 'workflow' }
                : { sessionId, what: 'text' };
        const outcome = await this.deps.registry.execute(toolId, input, {
          projectId,
          taskId: null,
          agentRole: 'browser',
        });
        variables.lastBrowser = outcome.data;
        return { ok: outcome.ok, detail: outcome.summary };
      }
      case 'condition': {
        const expression = String(config.expression ?? 'true');
        const outcome = evaluateCondition(expression, variables);
        return {
          ok: true,
          detail: `${expression} → ${outcome}`,
          next: outcome ? block.next ?? null : block.onFalse ?? null,
        };
      }
      case 'approval': {
        const decision = await this.deps.approvals.request({
          taskId: null,
          kind: 'tool',
          title: String(config.title ?? `Workflow checkpoint: ${ctx.workflow.name}`),
          detail: String(config.detail ?? 'Approve to continue the workflow'),
          risk: (config.risk as 'low' | 'medium' | 'high') ?? 'medium',
          payload: { workflowId: ctx.workflow.id, executionId: ctx.execution.id, blockId: block.id },
        });
        return {
          ok: decision.approved,
          detail: decision.approved ? `approved by ${decision.by}` : `rejected by ${decision.by}`,
        };
      }
      case 'delay': {
        const ms = Math.min(Number(config.ms ?? 500), 60_000);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return { ok: true, detail: `waited ${ms} ms` };
      }
      case 'transform': {
        const value = this.interpolate(String(config.value ?? ''), variables);
        const target = String(config.variable ?? 'transformed');
        variables[target] = config.asJson ? safeParseJson(value) : value;
        return { ok: true, detail: `set ${target}` };
      }
      default:
        return { ok: false, detail: `Unsupported block type: ${String(block.type)}` };
    }
  }

  /** `{{variable}}` substitution — no expression evaluation. */
  private interpolate(text: string, variables: Record<string, unknown>): string {
    return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, path: string) => {
      let current: unknown = variables;
      for (const key of path.split('.')) {
        if (current && typeof current === 'object') current = (current as Record<string, unknown>)[key];
        else return '';
      }
      return current === undefined ? '' : typeof current === 'string' ? current : JSON.stringify(current);
    });
  }

  private interpolateObject(value: unknown, variables: Record<string, unknown>): unknown {
    if (typeof value === 'string') return this.interpolate(value, variables);
    if (Array.isArray(value)) return value.map((v) => this.interpolateObject(v, variables));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        out[key] = this.interpolateObject(inner, variables);
      }
      return out;
    }
    return value;
  }
}

/**
 * Tiny safe expression evaluator for condition blocks.
 * Grammar: <operand> <op> <operand>  or  <operand>
 * Operands are variable paths, quoted strings, numbers, true/false/null.
 * Supported ops: == != > >= < <= contains startsWith endsWith
 */
export function evaluateCondition(expression: string, variables: Record<string, unknown>): boolean {
  const trimmed = expression.trim();
  if (trimmed === '' || trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  const opMatch = /\s(==|!=|>=|<=|>|<|contains|startsWith|endsWith)\s/.exec(trimmed);
  if (!opMatch) {
    return Boolean(resolveOperand(trimmed, variables));
  }
  const op = opMatch[1]!;
  const left = resolveOperand(trimmed.slice(0, opMatch.index), variables);
  const right = resolveOperand(trimmed.slice(opMatch.index + op.length + 2), variables);

  switch (op) {
    case '==':
      return looseEqual(left, right);
    case '!=':
      return !looseEqual(left, right);
    case '>':
      return Number(left) > Number(right);
    case '>=':
      return Number(left) >= Number(right);
    case '<':
      return Number(left) < Number(right);
    case '<=':
      return Number(left) <= Number(right);
    case 'contains':
      return String(left ?? '').includes(String(right ?? ''));
    case 'startsWith':
      return String(left ?? '').startsWith(String(right ?? ''));
    case 'endsWith':
      return String(left ?? '').endsWith(String(right ?? ''));
    default:
      return false;
  }
}

function resolveOperand(raw: string, variables: Record<string, unknown>): unknown {
  const token = raw.trim();
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    return token.slice(1, -1);
  }
  if (token === 'true') return true;
  if (token === 'false') return false;
  if (token === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(token)) return Number(token);
  let current: unknown = variables;
  for (const key of token.split('.')) {
    if (current && typeof current === 'object') current = (current as Record<string, unknown>)[key];
    else return undefined;
  }
  return current;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return String(a) === String(b);
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Built-in workflow templates (real, executable definitions). */
export function builtinTemplates(projectId: string | null): Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>[] {
  return [
    {
      name: 'Automated code review',
      description: 'Scan the project, analyse code quality, run tests and produce a review report.',
      projectId,
      isTemplate: true,
      entry: 'scan',
      blocks: [
        { id: 'scan', type: 'file', label: 'Scan codebase', config: { toolId: 'project.scan', input: {} }, next: 'analyze', onFalse: null },
        { id: 'analyze', type: 'ai', label: 'Analyse architecture', config: { focus: '' }, next: 'tests', onFalse: null },
        { id: 'tests', type: 'test', label: 'Run tests', config: { command: 'npm test --if-present' }, next: 'done', onFalse: 'done' },
        { id: 'done', type: 'transform', label: 'Collect report', config: { value: '{{lastAiResult}}', variable: 'report' }, next: null, onFalse: null },
      ],
    },
    {
      name: 'Build and verify',
      description: 'Install nothing, build the project, and fail the workflow if the build fails.',
      projectId,
      isTemplate: true,
      entry: 'build',
      blocks: [
        { id: 'build', type: 'terminal', label: 'Build', config: { command: 'npm run build --if-present' }, next: 'check', onFalse: null },
        { id: 'check', type: 'condition', label: 'Build ok?', config: { expression: 'lastCommand.output contains "error"' }, next: 'fail', onFalse: null },
        { id: 'fail', type: 'transform', label: 'Record failure', config: { value: 'build reported errors', variable: 'report' }, next: null, onFalse: null },
      ],
    },
    {
      name: 'UI smoke test',
      description: 'Open the dev server in a browser, capture a screenshot and inspect console errors.',
      projectId,
      isTemplate: true,
      entry: 'open',
      blocks: [
        { id: 'open', type: 'browser', label: 'Open browser', config: { action: 'open', headless: true }, next: 'goto', onFalse: null },
        { id: 'goto', type: 'browser', label: 'Navigate', config: { action: 'goto', url: 'http://localhost:5173' }, next: 'shot', onFalse: null },
        { id: 'shot', type: 'browser', label: 'Screenshot', config: { action: 'screenshot' }, next: 'errors', onFalse: null },
        { id: 'errors', type: 'browser', label: 'Read console errors', config: { action: 'inspect' }, next: null, onFalse: null },
      ],
    },
  ];
}
