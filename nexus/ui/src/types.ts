/**
 * Renderer-side view of the shared contracts. These mirror
 * `packages/core/src/types.ts`; the backend is the source of truth and the
 * `typecheck` script verifies the backend half. Keeping a local copy lets the UI
 * build without a cross-package TS project reference.
 */
export type RiskLevel = 'low' | 'medium' | 'high';
export type ProviderId = 'gemini' | 'groq';
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
export type AgentRole = 'planning' | 'coding' | 'debugging' | 'testing' | 'analyst' | 'browser' | 'documentation';

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

export interface TechnologyFact {
  name: string;
  category: 'language' | 'framework' | 'library' | 'database' | 'tool' | 'runtime';
  version?: string;
  evidence: string;
}

export interface FileInsight {
  relPath: string;
  kind: string;
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

export interface Conversation {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider: string | null;
  model: string | null;
  toolCalls: unknown[];
  attachments: { name: string; mimeType: string }[];
  tokens: number | null;
  createdAt: number;
}

export interface Memory {
  id: string;
  projectId: string | null;
  category: string;
  content: string;
  importance: number;
  createdAt: number;
  updatedAt: number;
  revisions: { at: number; content: string }[];
  source: 'user' | 'agent' | 'import';
}

export interface SearchHit {
  relPath: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  matchType: string;
  isSourceContent: boolean;
}

export interface SearchResponse {
  query: string;
  projectId: string | null;
  hits: SearchHit[];
  tookMs: number;
  strategy: 'keyword' | 'hybrid';
}

export interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  risk: RiskLevel;
  category: string;
  timeoutMs: number;
  requiresProject: boolean;
  requiresApproval: boolean;
}

export interface ProviderStatus {
  provider: ProviderId;
  configured: boolean;
  models: { modelId: string; label: string; contextWindow: number; capabilities: Record<string, boolean> }[];
  defaultModel: string | null;
  lastError: string | null;
}

export interface WorkflowBlock {
  id: string;
  type: 'ai' | 'file' | 'terminal' | 'browser' | 'condition' | 'approval' | 'delay' | 'transform' | 'test';
  label: string;
  config: Record<string, unknown>;
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
  log: { at: number; blockId: string; type: string; status: string; detail: string }[];
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface BrowserSessionInfo {
  id: string;
  headless: boolean;
  url: string;
  createdAt: number;
}

export interface ActivityEntry {
  id: number;
  at: number;
  kind: string;
  level: 'info' | 'warn' | 'error';
  title: string;
  detail: string;
  projectId: string | null;
  taskId: string | null;
  provider: ProviderId | null;
  status: string;
}

export interface AnalyticsSnapshot {
  generatedAt: number;
  tasks: { total: number; byStatus: Record<string, number>; successRate: number | null; avgDurationMs: number | null };
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
    logging: { level: string; retentionDays: number };
  };
  projects: { defaultIgnoreGlobs: string[] };
}

export interface SettingsResponse {
  settings: AppSettings;
  keys: Record<ProviderId, { configured: boolean; masked: string | null; source: string }>;
}

export interface NexusEvent {
  id: number;
  type: string;
  at: number;
  taskId: string | null;
  projectId: string | null;
  message: string;
  data: Record<string, unknown>;
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

export interface DesktopBridge {
  isDesktop: true;
  selectDirectory(): Promise<string | null>;
  setApiKey(provider: ProviderId, key: string): Promise<{ ok: boolean }>;
  getKeyStatus(): Promise<{ encryptionAvailable: boolean; gemini: boolean; groq: boolean }>;
  clearApiKey(provider: ProviderId): Promise<{ ok: boolean }>;
  notify(title: string, body: string): Promise<{ shown: boolean }>;
  window: { minimize: () => Promise<unknown>; toggleMaximize: () => Promise<unknown>; close: () => Promise<unknown> };
  openExternal(url: string): Promise<{ ok: boolean }>;
  appInfo(): Promise<Record<string, unknown>>;
  backendUrl(): Promise<string>;
}

declare global {
  interface Window {
    nexus?: DesktopBridge;
  }
}
