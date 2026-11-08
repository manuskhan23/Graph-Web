/**
 * Async storage contracts.
 *
 * Business logic depends on these interfaces only — never on SQLite or MongoDB.
 * Two implementations exist:
 *
 *   SQLite  `storage/sqlite/*`   synchronous driver wrapped in an async facade
 *   Mongo   `storage/mongo/*`    native async driver, selected by MONGODB_URI
 *
 * The async shape exists because MongoDB's driver is async: making the contract
 * async once is cheaper and far less error-prone than a blocking bridge.
 */
import type {
  ActivityEntry,
  AnalyticsSnapshot,
  ApprovalRequest,
  Conversation,
  Memory,
  MemoryCategory,
  Message,
  NotificationEntry,
  Project,
  ProjectFileRecord,
  ProviderUsageRecord,
  ScanResult,
  TaskRecord,
  TaskStatus,
  ToolExecutionRecord,
  WorkflowBlock,
  WorkflowDefinition,
  WorkflowExecution,
} from '../types.js';

export interface IndexedFileInput {
  relPath: string;
  language: string;
  size: number;
  hash: string;
  lines: number;
}

export interface ChunkInput {
  startLine: number;
  endLine: number;
  content: string;
  tokens: string;
  hash: string;
}

export interface ChunkRecord {
  id: string;
  relPath: string;
  startLine: number;
  endLine: number;
  content: string;
  tokens: string;
  hash: string;
}

export interface EmbeddingRecord {
  chunkId: string;
  vector: Float32Array;
}

export interface IndexRunRecord {
  id: string;
  projectId: string;
  startedAt: number;
  finishedAt: number | null;
  indexVersion: number;
  added: number;
  modified: number;
  removed: number;
  unchanged: number;
  skipped: number;
  status: string;
  error: string | null;
}

export interface SnapshotRecord {
  id: string;
  projectId: string;
  operationId: string | null;
  kind: 'pre-change' | 'manual' | 'scheduled';
  label: string;
  createdAt: number;
  hash: string;
  size: number;
  metadata: Record<string, unknown>;
}

export interface SnapshotFileRecord {
  id: string;
  snapshotId: string;
  relPath: string;
  hash: string;
  existed: boolean;
  blobPath: string | null;
  /** Inline content for small files; large files live in the blob store. */
  content: string | null;
}

export interface ApprovalInput {
  taskId: string | null;
  kind: ApprovalRequest['kind'];
  title: string;
  detail: string;
  risk: ApprovalRequest['risk'];
  payload: Record<string, unknown>;
}

export interface JobRecord {
  id: string;
  kind: string;
  referenceId: string | null;
  status: string;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
}

export interface AuditEntry {
  id: string;
  at: number;
  actor: string;
  action: string;
  subject: string;
  allowed: boolean;
  reason: string;
  metadata: unknown;
}

export interface AgentRecord {
  role: string;
  name: string;
  description: string;
  allowedTools: string[];
  mayWriteFiles: boolean;
}

/* ------------------------------------------------------------- contracts -- */

export interface ProjectStore {
  list(): Promise<Project[]>;
  get(projectId: string): Promise<Project | null>;
  findByRoot(rootPath: string): Promise<Project | null>;
  create(input: {
    name: string;
    rootPath: string;
    description?: string;
    ignoredGlobs?: string[];
    settings?: Record<string, unknown>;
  }): Promise<Project>;
  update(
    projectId: string,
    patch: Partial<Pick<Project, 'name' | 'description' | 'ignoredGlobs' | 'settings' | 'lastIndexedAt' | 'indexVersion'>>,
  ): Promise<Project | null>;
  remove(projectId: string): Promise<boolean>;

  files(projectId: string): Promise<ProjectFileRecord[]>;
  filesByPath(projectId: string): Promise<Map<string, ProjectFileRecord>>;
  getFile(projectId: string, relPath: string): Promise<ProjectFileRecord | null>;
  upsertFile(projectId: string, file: IndexedFileInput): Promise<void>;
  deleteFile(projectId: string, relPath: string): Promise<void>;
  countFiles(projectId: string): Promise<number>;

  replaceChunks(projectId: string, relPath: string, chunks: ChunkInput[]): Promise<void>;
  chunks(projectId: string): Promise<ChunkRecord[]>;

  startIndexRun(projectId: string, indexVersion: number): Promise<string>;
  finishIndexRun(
    runId: string,
    result: Omit<ScanResult, 'projectId' | 'durationMs'> & { error?: string },
  ): Promise<void>;
  recentIndexRuns(projectId: string, limit?: number): Promise<IndexRunRecord[]>;
}

export interface ConversationStore {
  list(projectId?: string | null): Promise<Conversation[]>;
  get(conversationId: string): Promise<Conversation | null>;
  create(input: { projectId: string | null; title: string }): Promise<Conversation>;
  rename(conversationId: string, title: string): Promise<void>;
  remove(conversationId: string): Promise<boolean>;
  messages(conversationId: string, limit?: number): Promise<Message[]>;
  addMessage(input: {
    conversationId: string;
    role: Message['role'];
    content: string;
    provider?: string | null;
    model?: string | null;
    toolCalls?: unknown[];
    attachments?: Message['attachments'];
    tokens?: number | null;
  }): Promise<Message>;
  recentHistory(conversationId: string, limit?: number): Promise<Message[]>;
}

export interface TaskStore {
  list(filter?: { status?: TaskStatus; projectId?: string | null; limit?: number }): Promise<TaskRecord[]>;
  get(taskId: string): Promise<TaskRecord | null>;
  create(input: {
    projectId: string | null;
    conversationId?: string | null;
    title: string;
    description?: string;
    agentRole?: TaskRecord['agentRole'];
    status?: TaskStatus;
    priority?: number;
  }): Promise<TaskRecord>;
  update(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null>;
  interrupted(): Promise<TaskRecord[]>;
  activeCount(): Promise<number>;
  completedStepIds(taskId: string): Promise<string[]>;
}

export interface MemoryStore {
  list(filter?: { projectId?: string | null; category?: MemoryCategory; limit?: number }): Promise<Memory[]>;
  get(memoryId: string): Promise<Memory | null>;
  create(input: {
    projectId: string | null;
    category: MemoryCategory;
    content: string;
    importance?: number;
    source?: Memory['source'];
  }): Promise<Memory>;
  update(
    memoryId: string,
    patch: { content?: string; category?: MemoryCategory; importance?: number },
  ): Promise<Memory | null>;
  remove(memoryId: string): Promise<boolean>;
  search(term: string, projectId?: string | null): Promise<Memory[]>;
  countByCategory(): Promise<Record<string, number>>;
}

export interface SnapshotStore {
  create(input: {
    projectId: string;
    operationId: string | null;
    kind: SnapshotRecord['kind'];
    label: string;
    hash: string;
    size: number;
    metadata?: Record<string, unknown>;
    files: { relPath: string; hash: string; existed: boolean; blobPath: string | null; content: string | null }[];
  }): Promise<SnapshotRecord>;
  get(snapshotId: string): Promise<SnapshotRecord | null>;
  list(projectId: string, limit?: number): Promise<SnapshotRecord[]>;
  files(snapshotId: string): Promise<SnapshotFileRecord[]>;
  findByOperation(operationId: string): Promise<SnapshotRecord | null>;
  expire(days: number): Promise<{ snapshots: number; blobs: string[] }>;
  count(projectId?: string): Promise<number>;
  /** Blob-dedupe lookups used by the snapshot service. */
  findBlobByHash(hash: string): Promise<string | null>;
  blobInUse(blobPath: string, exceptSnapshotId?: string): Promise<boolean>;
}

export interface WorkflowStore {
  list(): Promise<WorkflowDefinition[]>;
  get(workflowId: string): Promise<WorkflowDefinition | null>;
  create(input: {
    name: string;
    description?: string;
    projectId?: string | null;
    blocks: WorkflowBlock[];
    entry?: string | null;
    isTemplate?: boolean;
  }): Promise<WorkflowDefinition>;
  update(
    workflowId: string,
    patch: { name?: string; description?: string; blocks?: WorkflowBlock[]; entry?: string | null },
  ): Promise<WorkflowDefinition | null>;
  remove(workflowId: string): Promise<boolean>;
  createExecution(workflow: WorkflowDefinition): Promise<WorkflowExecution>;
  getExecution(executionId: string): Promise<WorkflowExecution | null>;
  saveExecution(exec: WorkflowExecution): Promise<void>;
  executions(workflowId: string, limit?: number): Promise<WorkflowExecution[]>;
  allExecutions(limit?: number): Promise<WorkflowExecution[]>;
}

export interface ObservabilityStore {
  addActivity(entry: Omit<ActivityEntry, 'id' | 'at'> & { at?: number }): Promise<string>;
  activity(filter?: { kind?: string; level?: string; limit?: number; projectId?: string }): Promise<ActivityEntry[]>;

  addNotification(input: { title: string; body: string; level: NotificationEntry['level'] }): Promise<NotificationEntry>;
  notifications(limit?: number): Promise<NotificationEntry[]>;
  markNotificationRead(notificationId: string): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  unreadNotificationCount(): Promise<number>;

  addToolExecution(record: Omit<ToolExecutionRecord, 'id' | 'createdAt'>): Promise<string>;
  toolExecutions(filter?: { taskId?: string; limit?: number }): Promise<(ToolExecutionRecord & { id: string })[]>;

  createApproval(input: ApprovalInput): Promise<ApprovalRequest>;
  getApproval(approvalId: string): Promise<ApprovalRequest | null>;
  approvals(filter?: { status?: ApprovalRequest['status']; limit?: number }): Promise<ApprovalRequest[]>;
  resolveApproval(
    approvalId: string,
    status: 'approved' | 'rejected' | 'expired',
    by?: string,
  ): Promise<ApprovalRequest | null>;

  recordUsage(record: Omit<ProviderUsageRecord, 'id' | 'createdAt'>): Promise<void>;
  usage(limit?: number): Promise<ProviderUsageRecord[]>;

  audit(input: {
    actor: string;
    action: string;
    subject?: string;
    allowed: boolean;
    reason?: string;
    metadata?: unknown;
  }): Promise<void>;
  auditEntries(limit?: number): Promise<AuditEntry[]>;

  upsertJob(job: {
    id: string;
    kind: string;
    referenceId?: string | null;
    status: string;
    progress: number;
    message: string;
  }): Promise<void>;
  jobs(limit?: number): Promise<JobRecord[]>;

  analytics(): Promise<AnalyticsSnapshot>;

  getSetting<T>(key: string, fallback: T): Promise<T>;
  setSetting(key: string, value: unknown): Promise<void>;

  upsertAgent(agent: AgentRecord): Promise<void>;
  agents(): Promise<AgentRecord[]>;
}

/** Ranking search results by vector similarity is backend-agnostic. */
export interface EmbeddingStore {
  /** Every stored vector for a project, for re-ranking. */
  list(projectId: string): Promise<EmbeddingRecord[]>;
  /** Insert or replace vectors for the given chunks. */
  upsert(
    projectId: string,
    model: string,
    entries: { chunkId: string; vector: Float32Array }[],
  ): Promise<void>;
  /** Drop vectors belonging to chunks that no longer exist. */
  removeForFile(projectId: string, relPath: string): Promise<void>;
}
