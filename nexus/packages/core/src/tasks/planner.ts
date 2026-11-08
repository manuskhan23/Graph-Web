/**
 * Phase 5 — Task planner.
 *
 * Two modes:
 *  - `planWithModel`: asks Gemini for a structured plan (JSON), then validates it
 *    against the tool registry. Anything referencing an unknown tool, exceeding
 *    the step budget, or containing a cycle is rejected and repaired.
 *  - `planHeuristic`: deterministic fallback used when no provider is configured
 *    or the model returns unusable output. It produces a real, executable plan.
 *
 * Plan validation is deliberately strict: a plan is a safety boundary, not prose.
 */
import type { PlanStep, RiskLevel } from '../types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { ModelRouter } from '../providers/router.js';
import { NexusError } from '../errors.js';
import { id } from '../storage/driver.js';

export interface PlanInput {
  request: string;
  projectName?: string;
  projectSummary?: string;
  agentRole: string;
  maxSteps?: number;
  allowedRisk?: RiskLevel;
}

export interface Plan {
  title: string;
  steps: PlanStep[];
  source: 'model' | 'heuristic';
  notes: string[];
}

const RISK_ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

const PLAN_SCHEMA_HINT = `Return JSON of the shape:
{
  "title": "short task title",
  "steps": [
    { "title": "step title", "detail": "what to do and why",
      "toolId": "one of the available tool ids, or null for a reasoning step",
      "toolInput": { },
      "dependsOn": ["id of earlier step"],
      "verifyWith": "how this step's result will be checked" }
  ]
}`;

export class TaskPlanner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly router: ModelRouter | null,
  ) {}

  /** Ask the model for a plan; fall back to the heuristic if that fails. */
  async createPlan(input: PlanInput): Promise<Plan> {
    if (this.router && this.router.configuredProviders().length > 0) {
      try {
        const plan = await this.planWithModel(input);
        if (plan.steps.length > 0) return plan;
      } catch (err) {
        console.warn('[nexus][planner] model planning failed, using heuristic:', (err as Error).message);
      }
    }
    return this.planHeuristic(input);
  }

  async planWithModel(input: PlanInput): Promise<Plan> {
    const router = this.router!;
    const tools = this.registry.descriptorsForRole(input.agentRole);
    const maxSteps = input.maxSteps ?? 10;
    const toolList = tools
      .map((t) => `- ${t.id} (${t.risk} risk): ${t.description}`)
      .join('\n');

    const result = await router.complete(
      {
        system: `You plan software engineering work for an autonomous agent. You may ONLY use the listed tools.
Never invent tool ids. Keep plans to at most ${maxSteps} steps. Each step must be independently verifiable.
${PLAN_SCHEMA_HINT}
Available tools:
${toolList}`,
        messages: [
          {
            role: 'user',
            content: [
              input.projectName ? `Project: ${input.projectName}` : '',
              input.projectSummary ? `Project summary: ${input.projectSummary}` : '',
              `Request: ${input.request}`,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        json: true,
        temperature: 0.2,
        maxOutputTokens: 2000,
        purpose: 'plan',
        timeoutMs: 60_000,
      },
      { capability: 'text', complexity: 'complex', purpose: 'plan', containsProjectData: true },
    );

    const parsed = parsePlanJson(result.text);
    const notes: string[] = [];
    const steps = this.validateSteps(parsed.steps, input.agentRole, maxSteps, input.allowedRisk, notes);
    if (steps.length === 0) {
      throw new NexusError('VALIDATION_FAILED', 'Model returned no valid steps');
    }
    return { title: parsed.title || deriveTitle(input.request), steps, source: 'model', notes };
  }

  /**
   * Deterministic plan derived from the workspace state. This is a real plan, not
   * a placeholder: it inspects, analyses, then proposes a change and verification.
   */
  planHeuristic(input: PlanInput): Plan {
    const request = input.request;
    const lower = request.toLowerCase();
    const notes = ['Planned deterministically (no model planner available).'];
    const wantsCodeChange = /(add|implement|create|fix|refactor|update|change|remove|rename|write|build)/.test(lower);
    const wantsTests = /(test|verify|validate|check)/.test(lower);
    const wantsRun = /(run|start|dev server|serve)/.test(lower);

    const steps: PlanStep[] = [];
    const push = (step: Omit<PlanStep, 'status' | 'attempts' | 'result' | 'error' | 'startedAt' | 'finishedAt'>) => {
      steps.push({
        ...step,
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      });
    };

    push({
      id: 'inspect',
      title: 'Inspect the project',
      detail: 'Refresh the incremental index and locate files related to the request.',
      toolId: 'project.scan',
      toolInput: {},
      dependsOn: [],
      verifyWith: 'scan reports an index version and a non-zero file count',
    });

    if (input.projectName) {
      push({
        id: 'analyze',
        title: 'Analyse architecture and relevant code',
        detail: 'Extract stack, endpoints, models and search the code relevant to the request.',
        toolId: 'project.analyze',
        toolInput: { focus: extractFocus(request) },
        dependsOn: ['inspect'],
        verifyWith: 'analysis returns technologies and at least one relevant file',
      });
      push({
        id: 'search',
        title: 'Locate the code to change',
        detail: `Search the codebase for terms drawn from the request.`,
        toolId: 'file.search',
        toolInput: { query: extractFocus(request) || request.slice(0, 120), limit: 8 },
        dependsOn: ['analyze'],
        verifyWith: 'search returns ranked hits with file and line references',
      });
    }

    if (wantsCodeChange && input.projectName) {
      // A deterministic planner cannot author code. It must not emit an edit step
      // with empty operations (that would either fail or, worse, silently do
      // nothing while the report claimed a change). Instead the plan records the
      // prerequisite work and states plainly that authoring needs a model.
      push({
        id: 'locate',
        title: 'Collect the candidate files',
        detail: 'Enumerate the indexed files so the exact paths are known before any edit is proposed.',
        toolId: 'file.list',
        toolInput: { limit: 200 },
        dependsOn: ['search'],
        verifyWith: 'file list is returned with paths, languages and line counts',
      });
      notes.push(
        'No model planner is available, so this plan stops at inspection. Authoring code changes requires a configured Gemini or Groq model.',
      );
    }

    push({
      id: 'verify',
      title: 'Verify the result',
      detail: 'Run the project build or tests, or re-read the changed files to confirm the outcome.',
      toolId: 'terminal.run',
      toolInput: { command: 'npm run build --if-present' },
      dependsOn: wantsCodeChange ? ['locate'] : ['inspect'],
      verifyWith: 'command exits with code 0',
    });

    if (wantsTests) {
      push({
        id: 'test',
        title: 'Run the test suite',
        detail: 'Execute the project tests and report failures.',
        toolId: 'terminal.run',
        toolInput: { command: 'npm test --if-present' },
        dependsOn: ['verify'],
        verifyWith: 'test command exits with code 0',
      });
    }

    if (wantsRun) {
      push({
        id: 'serve',
        title: 'Start the development server',
        detail: 'Launch the dev server as a managed process and check its output for readiness.',
        toolId: 'terminal.startProcess',
        toolInput: { command: 'npm run dev --if-present' },
        dependsOn: ['verify'],
        verifyWith: 'process reaches running state and prints a listening URL',
      });
    }

    const validated = this.validateSteps(
      steps.map((s) => ({
        title: s.title,
        detail: s.detail,
        toolId: s.toolId,
        toolInput: s.toolInput,
        dependsOn: s.dependsOn,
        verifyWith: s.verifyWith,
        id: s.id,
      })),
      input.agentRole,
      12,
      input.allowedRisk,
      notes,
    );
    return { title: deriveTitle(request), steps: validated, source: 'heuristic', notes };
  }

  /**
   * Validate a proposed step list: known tools, role permissions, acyclicity,
   * bounded length, and risk ceiling.
   */
  validateSteps(
    raw: {
      id?: string;
      title: string;
      detail: string;
      toolId: string | null;
      toolInput: Record<string, unknown>;
      dependsOn: string[];
      verifyWith: string | null;
    }[],
    agentRole: string,
    maxSteps: number,
    allowedRisk: RiskLevel | undefined,
    notes: string[],
  ): PlanStep[] {
    const allowed = new Set(this.registry.descriptorsForRole(agentRole).map((d) => d.id));
    const riskLimit = RISK_ORDER[allowedRisk ?? 'high'];
    const steps: PlanStep[] = [];
    const ids = new Set<string>();

    for (const [index, item] of raw.slice(0, maxSteps).entries()) {
      const stepId = sanitizeId(item.id ?? `step_${index + 1}`);
      if (ids.has(stepId)) {
        notes.push(`Dropped duplicate step id ${stepId}`);
        continue;
      }
      let toolId: string | null = item.toolId ?? null;
      if (toolId && !allowed.has(toolId)) {
        notes.push(`Replaced unknown tool '${toolId}' with a reasoning step`);
        toolId = null;
      }
      if (toolId) {
        const descriptor = this.registry.get(toolId)!.descriptor;
        if (RISK_ORDER[descriptor.risk] > riskLimit) {
          notes.push(`Dropped '${item.title}' because ${toolId} exceeds the allowed risk`);
          continue;
        }
      }
      ids.add(stepId);
      steps.push({
        id: stepId,
        title: String(item.title || `Step ${index + 1}`).slice(0, 160),
        detail: String(item.detail ?? '').slice(0, 1200),
        toolId,
        toolInput: isRecord(item.toolInput) ? item.toolInput : {},
        dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.filter((d) => typeof d === 'string') : [],
        verifyWith: item.verifyWith ? String(item.verifyWith).slice(0, 300) : null,
        status: 'pending',
        attempts: 0,
        result: null,
        error: null,
        startedAt: null,
        finishedAt: null,
      });
    }

    // Drop dependencies that point at missing steps, then break cycles.
    const known = new Set(steps.map((s) => s.id));
    for (const step of steps) {
      step.dependsOn = step.dependsOn.filter((dep) => known.has(dep) && dep !== step.id);
    }
    const cycle = findCycle(steps);
    if (cycle) {
      notes.push(`Removed circular dependency: ${cycle.join(' → ')}`);
      const last = cycle[cycle.length - 1]!;
      const step = steps.find((s) => s.id === last);
      if (step) step.dependsOn = [];
    }
    return steps;
  }
}

function parsePlanJson(text: string): {
  title: string;
  steps: {
    id?: string;
    title: string;
    detail: string;
    toolId: string | null;
    toolInput: Record<string, unknown>;
    dependsOn: string[];
    verifyWith: string | null;
  }[];
} {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new NexusError('VALIDATION_FAILED', 'Planner returned no JSON');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    throw new NexusError('VALIDATION_FAILED', `Planner returned invalid JSON: ${(err as Error).message}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.steps)) {
    throw new NexusError('VALIDATION_FAILED', 'Plan JSON is missing a steps array');
  }
  const steps = parsed.steps
    .filter((s): s is Record<string, unknown> => isRecord(s))
    .map((s) => ({
      id: typeof s.id === 'string' ? s.id : undefined,
      title: typeof s.title === 'string' ? s.title : 'Step',
      detail: typeof s.detail === 'string' ? s.detail : '',
      toolId: typeof s.toolId === 'string' ? s.toolId : null,
      toolInput: isRecord(s.toolInput) ? s.toolInput : {},
      dependsOn: Array.isArray(s.dependsOn) ? (s.dependsOn as string[]) : [],
      verifyWith: typeof s.verifyWith === 'string' ? s.verifyWith : null,
    }));
  return { title: typeof parsed.title === 'string' ? parsed.title : '', steps };
}

function findCycle(steps: PlanStep[]): string[] | null {
  const state = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const visit = (stepId: string): string[] | null => {
    const current = state.get(stepId) ?? 0;
    if (current === 1) return [...stack.slice(stack.indexOf(stepId)), stepId];
    if (current === 2) return null;
    state.set(stepId, 1);
    stack.push(stepId);
    const step = steps.find((s) => s.id === stepId);
    for (const dep of step?.dependsOn ?? []) {
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(stepId, 2);
    return null;
  };
  for (const step of steps) {
    const cycle = visit(step.id);
    if (cycle) return cycle;
  }
  return null;
}

function deriveTitle(request: string): string {
  const clean = request.replace(/\s+/g, ' ').trim();
  if (clean.length <= 70) return clean || 'Untitled task';
  return `${clean.slice(0, 67)}…`;
}

function extractFocus(request: string): string {
  const stop = new Set(['add', 'the', 'a', 'an', 'to', 'my', 'me', 'please', 'can', 'you', 'fix', 'update', 'implement', 'create', 'and', 'for', 'with', 'in', 'on', 'of']);
  const words = request
    .toLowerCase()
    .replace(/[^a-z0-9\s._/-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return words.slice(0, 5).join(' ');
}

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || id('step');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
