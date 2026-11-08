/**
 * Typed API client. Always uses a relative URL: the UI is served by the same
 * Express process (or proxied by Vite), so the browser never needs to know the
 * backend host and never calls localhost directly.
 */
import type {
  AgentRunResult,
  AnalyticsSnapshot,
  ActivityEntry,
  AppSettings,
  ApprovalRequest,
  ArchitectureIssue,
  BrowserSessionInfo,
  Conversation,
  Memory,
  Message,
  NexusEvent,
  PlanStep,
  Project,
  ProjectAnalysis,
  ProviderId,
  ProviderStatus,
  RiskLevel,
  ScanResult,
  SearchResponse,
  SettingsResponse,
  TaskRecord,
  ToolDescriptor,
  WorkflowDefinition,
  WorkflowExecution,
} from '../types';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  if (!response.ok) {
    const body = payload as { error?: { code?: string; message?: string; retryable?: boolean } };
    throw new ApiError(
      body?.error?.code ?? 'HTTP_ERROR',
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error?.retryable ?? false,
    );
  }
  return payload as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<unknown> ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export interface ProjectWithCount extends Project {
  fileCount: number;
}

export const api = {
  health: () =>
    get<{
      status: string;
      database: { version: number };
      providers: ProviderId[];
      browser: { driver: string; available: boolean; reason?: string };
      version: string;
    }>('/health'),

  /* ------------------------------------------------------------ projects */
  listProjects: () => get<{ projects: ProjectWithCount[] }>('/projects'),
  createProject: (body: { rootPath: string; name?: string; description?: string }) =>
    post<{ project: Project; job: { id: string } }>('/projects', body),
  getProject: (projectId: string) =>
    get<{ project: ProjectWithCount; indexRuns: Record<string, unknown>[] }>(`/projects/${projectId}`),
  updateProject: (projectId: string, body: Partial<Project>) =>
    patch<{ project: Project }>(`/projects/${projectId}`, body),
  removeProject: (projectId: string) => del<{ removed: boolean }>(`/projects/${projectId}`),
  scanProject: (projectId: string, force = false) =>
    post<{ job: { id: string } }>(`/projects/${projectId}/scan`, { force }),
  analysis: (projectId: string) => get<{ analysis: ProjectAnalysis }>(`/projects/${projectId}/analysis`),
  tree: (projectId: string) =>
    get<{ root: string; files: { relPath: string; language: string; size: number; lines: number; hash: string }[]; directories: { path: string; files: number }[] }>(
      `/projects/${projectId}/tree`,
    ),
  readFile: (projectId: string, path: string) =>
    get<{ relPath: string; content: string; hash: string; lines: number }>(
      `/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    ),

  /* --------------------------------------------------------------- agent */
  runAgent: (body: {
    projectId: string | null;
    message: string;
    conversationId?: string | null;
    autoApproveBelow?: RiskLevel | null;
    attachments?: { name: string; mimeType: string; base64: string }[];
  }) => post<AgentRunResult & { conversationId: string }>('/agent/run', body),
  agents: () => get<{ agents: { role: string; name: string; description: string; allowedTools: string[]; mayWriteFiles: boolean }[] }>('/agent/roles'),
  leases: () => get<{ leases: { leaseId: string; role: string; taskId: string; files: string[] }[] }>('/agent/leases'),

  /* ----------------------------------------------------------- approvals */
  approvals: (status?: string) =>
    get<{ approvals: ApprovalRequest[] }>(`/agent/approvals${status ? `?status=${status}` : ''}`),
  resolveApproval: (approvalId: string, approved: boolean) =>
    post<{ approval: ApprovalRequest }>(`/agent/approvals/${approvalId}`, { approved }),

  /* --------------------------------------------------------------- tasks */
  tasks: (params: { status?: string; projectId?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, String(value));
    }
    const suffix = query.toString();
    return get<{ tasks: TaskRecord[] }>(`/tasks${suffix ? `?${suffix}` : ''}`);
  },
  task: (taskId: string) =>
    get<{
      task: TaskRecord;
      toolExecutions: { id: string; toolId: string; status: string; durationMs: number; error: string | null; createdAt: number }[];
      approvals: ApprovalRequest[];
    }>(`/tasks/${taskId}`),
  cancelTask: (taskId: string) => post<{ cancelled: boolean }>(`/tasks/${taskId}/cancel`),
  pauseTask: (taskId: string) => post<{ paused: boolean }>(`/tasks/${taskId}/pause`),
  resumeTask: (taskId: string) => post<AgentRunResult>(`/tasks/${taskId}/resume`),

  /* ------------------------------------------------------- conversations */
  conversations: (projectId?: string) =>
    get<{ conversations: Conversation[] }>(`/conversations${projectId ? `?projectId=${projectId}` : ''}`),
  messages: (conversationId: string) => get<{ messages: Message[] }>(`/conversations/${conversationId}/messages`),
  createConversation: (title: string, projectId: string | null) =>
    post<{ conversation: Conversation }>('/conversations', { title, projectId }),
  deleteConversation: (conversationId: string) => del<{ removed: boolean }>(`/conversations/${conversationId}`),

  /* ------------------------------------------------------------ terminal */
  runCommand: (projectId: string, command: string, approved = false) =>
    post<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean; durationMs: number }>(
      '/terminal/run',
      { projectId, command, approved },
    ),
  startProcess: (projectId: string, command: string) =>
    post<{ process: { id: string; pid: number | null; status: string } }>('/terminal/start', { projectId, command }),
  processes: () =>
    get<{ processes: { id: string; command: string; status: string; pid: number | null; exitCode: number | null; startedAt: number }[] }>(
      '/terminal/processes',
    ),
  processDetail: (processId: string) =>
    get<{ process: { status: string; exitCode: number | null }; output: { stdout: string; stderr: string } }>(
      `/terminal/processes/${processId}`,
    ),
  stopProcess: (processId: string) => post<{ process: { status: string } }>(`/terminal/processes/${processId}/stop`),
  restartProcess: (processId: string) => post<{ process: { status: string } }>(`/terminal/processes/${processId}/restart`),
  terminalHistory: () => get<{ history: { at: number; command: string; status: string }[] }>('/terminal/history'),

  /* -------------------------------------------------------------- editor */
  stageEdit: (projectId: string, operations: unknown[], label?: string) =>
    post<{
      operationId: string;
      snapshotId: string;
      summary: { files: number; additions: number; deletions: number };
      changes: { relPath: string; diff: { relPath: string; additions: number; deletions: number; lines: { type: string; text: string; oldLine: number | null; newLine: number | null }[] } | null }[];
    }>('/editor/stage', { projectId, operations, label }),
  applyEdit: (operationId: string) => post<{ applied: string[]; snapshotId: string }>('/editor/apply', { operationId }),
  discardEdit: (operationId: string) => post<{ discarded: boolean }>('/editor/discard', { operationId }),
  stagedEdit: (operationId: string) => get<Record<string, unknown>>(`/editor/staged/${operationId}`),

  /* ----------------------------------------------------------- snapshots */
  snapshots: (projectId: string) =>
    get<{ snapshots: { id: string; label: string; kind: string; createdAt: number; size: number; fileCount: number }[] }>(
      `/snapshots?projectId=${projectId}`,
    ),
  createSnapshot: (projectId: string, label: string) =>
    post<{ snapshotId: string }>('/snapshots', { projectId, label }),
  snapshot: (snapshotId: string) =>
    get<{ id: string; label: string; createdAt: number; files: { relPath: string; hash: string; existed: boolean }[] }>(
      `/snapshots/${snapshotId}`,
    ),
  restoreSnapshot: (snapshotId: string) =>
    post<{ restored: string[]; created: string[]; deleted: string[]; safetySnapshotId: string | null }>(
      `/snapshots/${snapshotId}/restore`,
      {},
    ),

  /* -------------------------------------------------------------- search */
  search: (body: { projectId: string; query: string; limit?: number; pathFilter?: string }) =>
    post<SearchResponse>('/search', body),
  embedProject: (projectId: string) => post<{ job: { id: string } }>('/search/embed', { projectId }),

  /* -------------------------------------------------------------- memory */
  memories: (projectId?: string) =>
    get<{ memories: Memory[]; stats: { byCategory: Record<string, number>; enabled: boolean } }>(
      `/memory${projectId ? `?projectId=${projectId}` : ''}`,
    ),
  createMemory: (body: { content: string; category: string; projectId?: string | null; importance?: number }) =>
    post<{ memory: Memory }>('/memory', body),
  updateMemory: (memoryId: string, body: { content?: string; category?: string; importance?: number }) =>
    patch<{ memory: Memory }>(`/memory/${memoryId}`, body),
  deleteMemory: (memoryId: string) => del<{ removed: boolean }>(`/memory/${memoryId}`),
  exportMemories: (projectId?: string) =>
    fetch(`${BASE}/memory/export${projectId ? `?projectId=${projectId}` : ''}`).then((r) => r.text()),
  importMemories: (json: string) => post<{ imported: number; skipped: number }>('/memory/import', { json }),

  /* ----------------------------------------------------------- workflows */
  workflows: () => get<{ workflows: WorkflowDefinition[] }>('/workflows'),
  workflowTemplates: () => get<{ templates: Omit<WorkflowDefinition, 'id' | 'createdAt' | 'updatedAt'>[] }>('/workflows/templates'),
  createWorkflow: (body: { name: string; description?: string; projectId?: string | null; blocks: WorkflowDefinition['blocks']; entry?: string | null }) =>
    post<{ workflow: WorkflowDefinition }>('/workflows', body),
  workflow: (workflowId: string) =>
    get<{ workflow: WorkflowDefinition; executions: WorkflowExecution[] }>(`/workflows/${workflowId}`),
  deleteWorkflow: (workflowId: string) => del<{ removed: boolean }>(`/workflows/${workflowId}`),
  runWorkflow: (workflowId: string, projectId: string | null) =>
    post<{ execution: WorkflowExecution }>(`/workflows/${workflowId}/run`, { projectId }),
  pauseWorkflow: (executionId: string) => post<{ paused: boolean }>(`/workflows/executions/${executionId}/pause`),
  resumeWorkflow: (executionId: string) => post<{ execution: WorkflowExecution }>(`/workflows/executions/${executionId}/resume`),

  /* ------------------------------------------------------------- browser */
  browserStatus: () => get<{ driver: string; available: boolean; reason?: string }>('/browser/status'),
  browserSessions: () => get<{ sessions: BrowserSessionInfo[] }>('/browser/sessions'),
  openBrowser: (headless = true) => post<{ session: BrowserSessionInfo }>('/browser/sessions', { headless }),
  closeBrowser: (sessionId: string) => del<{ closed: boolean }>(`/browser/sessions/${sessionId}`),
  browserAction: (body: { sessionId: string; action: string; url?: string; selector?: string; value?: string; name?: string }) =>
    post<{ detail: string; url?: string; screenshotPath?: string }>('/browser/action', body),

  /* -------------------------------------------------------------- vision */
  analyzeImage: (body: { imageBase64?: string; imagePath?: string; prompt: string; projectId?: string | null }) =>
    post<{ analysis: string; model: string }>('/vision/analyze', body),

  /* ----------------------------------------------------------- analytics */
  analytics: () =>
    get<{ analytics: AnalyticsSnapshot; usage: Record<string, unknown>[]; jobs: { id: string; kind: string; status: string; progress: number; message: string }[] }>(
      '/analytics',
    ),

  /* ------------------------------------------------------------ activity */
  activity: (params: { kind?: string; level?: string; limit?: number } = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
    const suffix = query.toString();
    return get<{ activity: ActivityEntry[] }>(`/activity${suffix ? `?${suffix}` : ''}`);
  },
  notifications: () =>
    get<{ notifications: { id: string; title: string; body: string; level: string; read: boolean; at: number }[]; unread: number }>(
      '/activity/notifications',
    ),
  markNotificationsRead: (id?: string) => post<{ unread: number }>('/activity/notifications/read', { id }),
  auditLog: () => get<{ audit: Record<string, unknown>[] }>('/activity/audit'),

  /* ------------------------------------------------------------ settings */
  settings: () => get<SettingsResponse>('/settings'),
  updateSettings: (body: DeepPartial<AppSettings>) => patch<{ settings: AppSettings; keys: SettingsResponse['keys'] }>('/settings', body),
  setApiKey: (provider: ProviderId, key: string) => post<SettingsResponse>('/settings/keys', { provider, key }),
  clearApiKey: (provider: ProviderId) => del<SettingsResponse>(`/settings/keys/${provider}`),

  /* ---------------------------------------------------------------- meta */
  tools: () => get<{ tools: ToolDescriptor[] }>('/tools'),
  providers: () => get<{ providers: ProviderStatus[]; models: Record<string, unknown>[] }>('/providers'),
  jobs: () => get<{ jobs: { id: string; kind: string; status: string; progress: number; message: string }[] }>('/jobs'),
};

export type { PlanStep, ArchitectureIssue, ScanResult, NexusEvent };
export { post, get };
