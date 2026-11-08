/**
 * NEXUS AI — shared domain contracts.
 *
 * This module is the single source of truth for every payload that crosses a
 * boundary (REST, SSE, IPC). Backend, Electron and the React renderer all import
 * these types, so a contract change breaks compilation everywhere it matters.
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  | 'failed'
  | 'completed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type ProviderId = 'gemini' | 'groq';

export type AgentRole =
  | 'planning'
  | 'coding'
  | 'debugging'
  | 'testing'
  | 'analyst'
  | 'browser'
  | 'documentation';

/** ---------------------------------------------------------------- projects */

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  lastIndexedAt: number | null;
  indexVersion: number;
  ignoredGlobs: string[];
  settings: Record<string, unknown>;
}

export interface ProjectFileRecord {
  id: number;
  projectId: string;
  relPath: string;
  language: string;
  size: number;
  hash: string;
  lines: number;
  indexedAt: number;
}

export interface TechnologyFact {
  name: string;
  category: 'language' | 'framework' | 'library' | 'database' | 'tool' | 'runtime';
  version?: string;
  evidence: string;
}

export interface FileInsight {
  relPath: string;
  kind: 'component' | 'route' | 'model' | 'service' | 'util' | 'config' | 'test' | 'entry' | 'other';
  symbols: string[];
  imports: string[];
  exports: string[];
  lines: number;
}

export interface ArchitectureIssue {
  id: string;
  title: string;
  severity: 'info' | 'warning' | 'error';
  detail: string;
  files: string[];
}

export interface ProjectAnalysis {
  projectId: string;
  generatedAt: number;
  overview: string;
  technologies: TechnologyFact[];
  folderRoles: { path: string; role: string; files: number }[];
  files: FileInsight[];
  endpoints: { method: string; path: string; file: string; line: number }[];
  models: { name: string; file: string; fields: string[] }[];
  scripts: Record<string, string>;
  issues: ArchitectureIssue[];
  stats: {
    filesIndexed: number;
    totalLines: number;
    languageBreakdown: Record<string, number>;
    dependencyCount: number;
  };
}

export interface ScanResult {
  projectId: string;
  scanned: number;
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
  skipped: number;
  durationMs: number;
  indexVersion: number;
}

/** ------------------------------------------------------------------ search */

export interface SearchHit {
  relPath: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  matchType: 'keyword' | 'semantic' | 'hybrid' | 'symbol';
  /** True when text is verbatim source; false when it is a model-produced summary. */
  isSourceContent: boolean;
}

export interface SearchResponse {
  query: string;
  projectId: string | null;
  hits: SearchHit[];
  tookMs: number;
  strategy: 'keyword' | 'hybrid';
}

/** ------------------------------------------------------------------ memory */

export type MemoryCategory =
  | 'preference'
  | 'project_instruction'
  | 'coding_standard'
  | 'architecture_decision'
  | 'tech_stack'
  | 'task_outcome'
  | 'development_decision'
  | 'command';

export interface Memory {
  id: string;
  projectId: string | null;
  category: MemoryCategory;
  content: string;
  importance: number;
  createdAt: number;
  updatedAt: number;
  /** Append-only history entries are stored as JSON in revisions. */
  revisions: { at: number; content: string }[];
  source: 'user' | 'agent' | 'import';
}

/** ------------------------------------------------------------------- tasks */

export interface PlanStep {
  id: string;
  title: string;
  detail: string;
  toolId: string | null;
  toolInput: Record<string, unknown>;
  dependsOn: string[];
  verifyWith: string | null;
  status: StepStatus;
  attempts: number;
  result: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface TaskRecord {
  id: string;
  projectId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  priority: number;
  agentRole: AgentRole;
  plan: PlanStep[];
  currentStepId: string | null;
  progress: number;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  checkpoint: Record<string, unknown>;
  result: string | null;
}

/** ------------------------------------------------------------------- tools */

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  risk: RiskLevel;
  category: 'project' | 'file' | 'terminal' | 'browser' | 'ai' | 'memory' | 'workflow';
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  timeoutMs: number;
  requiresProject: boolean;
  requiresApproval: boolean;
}

export interface ToolExecutionRecord {
  id: string;
  taskId: string | null;
  projectId: string | null;
  toolId: string;
  input: Record<string, unknown>;
  output: unknown;
  status: 'success' | 'failed' | 'denied' | 'timeout';
  risk: RiskLevel;
  durationMs: number;
  error: string | null;
  createdAt: number;
}

/** -------------------------------------------------------------- approvals */

export interface ApprovalRequest {
  id: string;
  taskId: string | null;
  kind: 'tool' | 'command' | 'browser' | 'edit';
  title: string;
  detail: string;
  risk: RiskLevel;
  payload: Record<string, unknown>;
  createdAt: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  resolvedAt: number | null;
  resolvedBy: string | null;
}

/** ---------------------------------------------------------------- providers */

export interface ProviderCapabilities {
  text: boolean;
  vision: boolean;
  tools: boolean;
  json: boolean;
  embeddings: boolean;
  audio: boolean;
}

export interface ProviderModelInfo {
  provider: ProviderId;
  modelId: string;
  label: string;
  capabilities: ProviderCapabilities;
  contextWindow: number;
  maxOutput: number;
  /** USD per 1M input / output tokens when a public price exists. */
  pricing: { input: number; output: number } | null;
}

export interface ProviderUsageRecord {
  id: number;
  provider: ProviderId;
  modelId: string;
  purpose: string;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensSource: 'provider' | 'estimated';
  latencyMs: number;
  ok: boolean;
  errorClass: string | null;
  costUsd: number | null;
  createdAt: number;
}

export interface ProviderStatus {
  provider: ProviderId;
  configured: boolean;
  models: ProviderModelInfo[];
  defaultModel: string | null;
  lastError: string | null;
}

/** ------------------------------------------------------------------ events */

export type NexusEventType =
  | 'task.started'
  | 'task.updated'
  | 'task.completed'
  | 'task.failed'
  | 'task.paused'
  | 'task.cancelled'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'approval.required'
  | 'approval.resolved'
  | 'process.started'
  | 'process.output'
  | 'process.exited'
  | 'browser.action'
  | 'provider.fallback'
  | 'workflow.step'
  | 'chat.delta'
  | 'job.updated'
  | 'notice';

export interface NexusEvent {
  id: number;
  type: NexusEventType;
  at: number;
  taskId: string | null;
  projectId: string | null;
  message: string;
  data: Record<string, unknown>;
}

/** What a streaming chat chunk looks like on the wire. */
export interface ChatDelta {
  messageId: string;
  delta: string;
  done: boolean;
  provider?: ProviderId;
  model?: string;
  error?: string;
}

/** ---------------------------------------------------------------- workflows */

export type WorkflowBlockType =
  | 'ai'
  | 'file'
  | 'terminal'
  | 'browser'
  | 'condition'
  | 'approval'
  | 'delay'
  | 'transform'
  | 'test';

export interface WorkflowBlock {
  id: string;
  type: WorkflowBlockType;
  label: string;
  config: Record<string, unknown>;
  /** When empty the block chains to the next block in `blocks`. */
  next: string | null;
  onFalse: string | null;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  projectId: string | null;
  blocks: WorkflowBlock[];
  entry: string | null;
  isTemplate: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowExecution {
  id: string;
  workflowId: string;
  projectId: string | null;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  cursor: string | null;
  log: { at: number; blockId: string; type: WorkflowBlockType; status: string; detail: string }[];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

/** ----------------------------------------------------------------- browsers */

export interface BrowserSessionInfo {
  id: string;
  headless: boolean;
  url: string;
  createdAt: number;
}

export interface BrowserActionResult {
  sessionId: string;
  action: string;
  ok: boolean;
  detail: string;
  url?: string;
  screenshotPath?: string;
}

/** ------------------------------------------------------------------ activity */

export interface ActivityEntry {
  id: number;
  at: number;
  kind: 'task' | 'tool' | 'workflow' | 'process' | 'browser' | 'provider' | 'system';
  level: 'info' | 'warn' | 'error';
  title: string;
  detail: string;
  projectId: string | null;
  taskId: string | null;
  provider: ProviderId | null;
  status: string;
}

export interface NotificationEntry {
  id: string;
  at: number;
  title: string;
  body: string;
  level: 'info' | 'warn' | 'error' | 'success';
  read: boolean;
}

/** ---------------------------------------------------------------- analytics */

export interface AnalyticsSnapshot {
  generatedAt: number;
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    successRate: number | null;
    avgDurationMs: number | null;
  };
  providers: {
    provider: ProviderId;
    modelId: string;
    requests: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd: number | null;
    avgLatencyMs: number | null;
  }[];
  tools: { toolId: string; calls: number; failures: number; avgDurationMs: number | null }[];
  files: { modified: number; snapshots: number };
  workflows: { executions: number; completed: number; failed: number };
}

/** ----------------------------------------------------------------- settings */

export interface AppSettings {
  ai: {
    defaultProvider: ProviderId;
    geminiModel: string;
    groqModel: string;
    temperature: number;
    maxOutputTokens: number;
    allowCrossProviderFallback: boolean;
  };
  agent: {
    maxToolCalls: number;
    maxDurationMs: number;
    maxRetriesPerStep: number;
    maxContextTokens: number;
    maxConcurrentTasks: number;
    requireApprovalFor: { medium: boolean; high: boolean };
  };
  app: {
    theme: 'monochrome';
    notifications: boolean;
    memoryEnabled: boolean;
    terminal: { shell: 'powershell' | 'cmd' | 'bash'; timeoutMs: number };
    browser: { headless: boolean; defaultTimeoutMs: number };
    logging: { level: 'debug' | 'info' | 'warn' | 'error'; retentionDays: number };
  };
  projects: { defaultIgnoreGlobs: string[] };
}

export interface SettingsResponse {
  settings: AppSettings;
  /** Masked values only. Raw secrets never leave the backend. */
  keys: Record<ProviderId, { configured: boolean; masked: string | null; source: string }>;
}

/** ---------------------------------------------------------------- agent API */

export interface AgentRunRequest {
  projectId: string | null;
  message: string;
  autoApproveBelow: RiskLevel | null;
  attachments?: { name: string; mimeType: string; base64: string }[];
}

export interface AgentRunResult {
  taskId: string;
  status: TaskStatus;
  answer: string;
  steps: PlanStep[];
  toolCalls: number;
  durationMs: number;
  verified: boolean;
  approvals: ApprovalRequest[];
  usage: { provider: ProviderId; model: string; inputTokens: number | null; outputTokens: number | null }[];
}

/** -------------------------------------------------------------- error shape */

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; retryable: boolean };
}

export interface AgentDescriptor {
  role: AgentRole;
  name: string;
  description: string;
  allowedTools: string[];
  mayWriteFiles: boolean;
}
