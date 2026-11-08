/**
 * Tasks, memories, workflows, snapshots, observability and embeddings for MongoDB.
 *
 * These are grouped in one module because they share no collection and each is a
 * direct translation of its SQL counterpart. Splitting them would add files
 * without adding clarity; the class boundary is the seam that matters.
 */
import type {
  ActivityEntry,
  AnalyticsSnapshot,
  ApprovalRequest,
  Memory,
  MemoryCategory,
  NotificationEntry,
  ProviderId,
  ProviderUsageRecord,
  TaskRecord,
  TaskStatus,
  ToolExecutionRecord,
  WorkflowDefinition,
  WorkflowExecution,
} from '../../types.js';
import { id, now } from '../driver.js';
import type {
  AgentRecord,
  ApprovalInput,
  AuditEntry,
  EmbeddingRecord,
  EmbeddingStore,
  JobRecord,
  MemoryStore,
  ObservabilityStore,
  SnapshotFileRecord,
  SnapshotRecord,
  SnapshotStore,
  TaskStore,
  WorkflowStore,
} from '../contracts.js';
import type { MongoHandle } from './client.js';

type Doc = Record<string, unknown>;

const nullish = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/* ------------------------------------------------------------------ tasks -- */

export class MongoTaskStore implements TaskStore {
  constructor(private readonly mongo: MongoHandle) {}
  private get col() {
    return this.mongo.collection('tasks');
  }

  private map(doc: Doc): TaskRecord {
    return {
      id: String(doc._id),
      projectId: nullish(doc.projectId),
      title: String(doc.title),
      description: String(doc.description ?? ''),
      status: String(doc.status) as TaskStatus,
      priority: Number(doc.priority ?? 5),
      agentRole: String(doc.agentRole) as TaskRecord['agentRole'],
      plan: (doc.plan as TaskRecord['plan']) ?? [],
      currentStepId: nullish(doc.currentStepId),
      progress: Number(doc.progress ?? 0),
      createdAt: Number(doc.createdAt),
      startedAt: doc.startedAt === null || doc.startedAt === undefined ? null : Number(doc.startedAt),
      finishedAt: doc.finishedAt === null || doc.finishedAt === undefined ? null : Number(doc.finishedAt),
      error: nullish(doc.error),
      checkpoint: (doc.checkpoint as Record<string, unknown>) ?? {},
      result: nullish(doc.result),
    };
  }

  async list(filter: { status?: TaskStatus; projectId?: string | null; limit?: number } = {}): Promise<TaskRecord[]> {
    const query: Doc = {};
    if (filter.status) query.status = filter.status;
    if (filter.projectId) query.projectId = filter.projectId;
    const docs = await this.col.find(query).sort({ createdAt: -1 }).limit(filter.limit ?? 100).toArray();
    return docs.map((doc) => this.map(doc));
  }

  async get(taskId: string): Promise<TaskRecord | null> {
    const doc = await this.col.findOne({ _id: taskId });
    return doc ? this.map(doc) : null;
  }

  async create(input: {
    projectId: string | null;
    conversationId?: string | null;
    title: string;
    description?: string;
    agentRole?: TaskRecord['agentRole'];
    status?: TaskStatus;
    priority?: number;
  }): Promise<TaskRecord> {
    const taskId = id('task');
    const doc: Doc = {
      _id: taskId,
      projectId: input.projectId,
      conversationId: input.conversationId ?? null,
      title: input.title,
      description: input.description ?? '',
      status: input.status ?? 'pending',
      priority: input.priority ?? 5,
      agentRole: input.agentRole ?? 'planning',
      plan: [],
      currentStepId: null,
      progress: 0,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
      error: null,
      checkpoint: {},
      result: null,
    };
    await this.col.insertOne(doc);
    return this.map(doc);
  }

  async update(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const set: Doc = {};
    for (const key of [
      'title',
      'description',
      'status',
      'priority',
      'agentRole',
      'plan',
      'currentStepId',
      'progress',
      'startedAt',
      'finishedAt',
      'error',
      'checkpoint',
      'result',
    ] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (Object.keys(set).length === 0) return this.get(taskId);
    const result = await this.col.updateOne({ _id: taskId }, { $set: set });
    if (result.matchedCount === 0) return null;
    return this.get(taskId);
  }

  async interrupted(): Promise<TaskRecord[]> {
    const docs = await this.col
      .find({ status: { $in: ['running', 'planning'] } })
      .sort({ createdAt: 1 })
      .limit(200)
      .toArray();
    return docs.map((doc) => this.map(doc));
  }

  async activeCount(): Promise<number> {
    return this.col.countDocuments({ status: { $in: ['running', 'planning', 'awaiting_approval'] } });
  }

  async completedStepIds(taskId: string): Promise<string[]> {
    const task = await this.get(taskId);
    return task ? task.plan.filter((step) => step.status === 'completed').map((step) => step.id) : [];
  }
}

/* --------------------------------------------------------------- memories -- */

export class MongoMemoryStore implements MemoryStore {
  constructor(private readonly mongo: MongoHandle) {}
  private get col() {
    return this.mongo.collection('memories');
  }

  private map(doc: Doc): Memory {
    return {
      id: String(doc._id),
      projectId: nullish(doc.projectId),
      category: String(doc.category) as MemoryCategory,
      content: String(doc.content),
      importance: Number(doc.importance ?? 3),
      createdAt: Number(doc.createdAt),
      updatedAt: Number(doc.updatedAt),
      revisions: (doc.revisions as Memory['revisions']) ?? [],
      source: String(doc.source) as Memory['source'],
    };
  }

  async list(
    filter: { projectId?: string | null; category?: MemoryCategory; limit?: number } = {},
  ): Promise<Memory[]> {
    const query: Doc = {};
    if (filter.projectId !== undefined) {
      // A project-scoped memory list also sees global (null-project) memories.
      if (filter.projectId === null) query.projectId = null;
      else query.$or = [{ projectId: filter.projectId }, { projectId: null }];
    }
    if (filter.category) query.category = filter.category;
    const docs = await this.col
      .find(query)
      .sort({ importance: -1, updatedAt: -1 })
      .limit(filter.limit ?? 200)
      .toArray();
    return docs.map((doc) => this.map(doc));
  }

  async get(memoryId: string): Promise<Memory | null> {
    const doc = await this.col.findOne({ _id: memoryId });
    return doc ? this.map(doc) : null;
  }

  async create(input: {
    projectId: string | null;
    category: MemoryCategory;
    content: string;
    importance?: number;
    source?: Memory['source'];
  }): Promise<Memory> {
    const memoryId = id('mem');
    const ts = now();
    const doc: Doc = {
      _id: memoryId,
      projectId: input.projectId,
      category: input.category,
      content: input.content,
      importance: input.importance ?? 3,
      createdAt: ts,
      updatedAt: ts,
      revisions: [],
      source: input.source ?? 'user',
    };
    await this.col.insertOne(doc);
    return this.map(doc);
  }

  async update(
    memoryId: string,
    patch: { content?: string; category?: MemoryCategory; importance?: number },
  ): Promise<Memory | null> {
    const current = await this.get(memoryId);
    if (!current) return null;
    const revisions = [...current.revisions, { at: current.updatedAt, content: current.content }].slice(-20);
    await this.col.updateOne(
      { _id: memoryId },
      {
        $set: {
          content: patch.content ?? current.content,
          category: patch.category ?? current.category,
          importance: patch.importance ?? current.importance,
          revisions,
          updatedAt: now(),
        },
      },
    );
    return this.get(memoryId);
  }

  async remove(memoryId: string): Promise<boolean> {
    const result = await this.col.deleteOne({ _id: memoryId });
    return result.deletedCount > 0;
  }

  async search(term: string, projectId?: string | null): Promise<Memory[]> {
    // Escape regex metacharacters: user text must never become a pattern.
    const safe = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query: Doc = { content: { $regex: safe, $options: 'i' } };
    if (projectId) query.$or = [{ projectId }, { projectId: null }];
    const docs = await this.col.find(query).sort({ importance: -1, updatedAt: -1 }).limit(50).toArray();
    return docs.map((doc) => this.map(doc));
  }

  async countByCategory(): Promise<Record<string, number>> {
    const rows = await this.col
      .aggregate([{ $group: { _id: '$category', c: { $sum: 1 } } }])
      .toArray();
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row._id)] = Number(row.c);
    return out;
  }
}

/* -------------------------------------------------------------- workflows -- */

export class MongoWorkflowStore implements WorkflowStore {
  constructor(private readonly mongo: MongoHandle) {}
  private get col() {
    return this.mongo.collection('workflows');
  }
  private get execs() {
    return this.mongo.collection('workflow_executions');
  }

  private mapWorkflow(doc: Doc): WorkflowDefinition {
    return {
      id: String(doc._id),
      name: String(doc.name),
      description: String(doc.description ?? ''),
      projectId: nullish(doc.projectId),
      blocks: (doc.blocks as WorkflowDefinition['blocks']) ?? [],
      entry: nullish(doc.entry),
      isTemplate: Boolean(doc.isTemplate),
      createdAt: Number(doc.createdAt),
      updatedAt: Number(doc.updatedAt),
    };
  }

  private mapExecution(doc: Doc): WorkflowExecution {
    return {
      id: String(doc._id),
      workflowId: String(doc.workflowId),
      projectId: nullish(doc.projectId),
      status: String(doc.status) as WorkflowExecution['status'],
      cursor: nullish(doc.cursor),
      log: (doc.log as WorkflowExecution['log']) ?? [],
      startedAt: Number(doc.startedAt),
      finishedAt: doc.finishedAt === null || doc.finishedAt === undefined ? null : Number(doc.finishedAt),
      error: nullish(doc.error),
    };
  }

  async list(): Promise<WorkflowDefinition[]> {
    const docs = await this.col.find({}).sort({ updatedAt: -1 }).limit(200).toArray();
    return docs.map((doc) => this.mapWorkflow(doc));
  }

  async get(workflowId: string): Promise<WorkflowDefinition | null> {
    const doc = await this.col.findOne({ _id: workflowId });
    return doc ? this.mapWorkflow(doc) : null;
  }

  async create(input: {
    name: string;
    description?: string;
    projectId?: string | null;
    blocks: WorkflowDefinition['blocks'];
    entry?: string | null;
    isTemplate?: boolean;
  }): Promise<WorkflowDefinition> {
    const workflowId = id('wf');
    const ts = now();
    const doc: Doc = {
      _id: workflowId,
      name: input.name,
      description: input.description ?? '',
      projectId: input.projectId ?? null,
      blocks: input.blocks,
      entry: input.entry ?? input.blocks[0]?.id ?? null,
      isTemplate: Boolean(input.isTemplate),
      createdAt: ts,
      updatedAt: ts,
    };
    await this.col.insertOne(doc);
    return this.mapWorkflow(doc);
  }

  async update(
    workflowId: string,
    patch: { name?: string; description?: string; blocks?: WorkflowDefinition['blocks']; entry?: string | null },
  ): Promise<WorkflowDefinition | null> {
    const current = await this.get(workflowId);
    if (!current) return null;
    await this.col.updateOne(
      { _id: workflowId },
      {
        $set: {
          name: patch.name ?? current.name,
          description: patch.description ?? current.description,
          blocks: patch.blocks ?? current.blocks,
          entry: patch.entry === undefined ? current.entry : patch.entry,
          updatedAt: now(),
        },
      },
    );
    return this.get(workflowId);
  }

  async remove(workflowId: string): Promise<boolean> {
    const result = await this.col.deleteOne({ _id: workflowId });
    if (result.deletedCount === 0) return false;
    await this.execs.deleteMany({ workflowId });
    return true;
  }

  async createExecution(workflow: WorkflowDefinition): Promise<WorkflowExecution> {
    const executionId = id('wfx');
    const doc: Doc = {
      _id: executionId,
      workflowId: workflow.id,
      projectId: workflow.projectId,
      status: 'running',
      cursor: workflow.entry,
      log: [],
      startedAt: now(),
      finishedAt: null,
      error: null,
    };
    await this.execs.insertOne(doc);
    return this.mapExecution(doc);
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const doc = await this.execs.findOne({ _id: executionId });
    return doc ? this.mapExecution(doc) : null;
  }

  async saveExecution(exec: WorkflowExecution): Promise<void> {
    await this.execs.updateOne(
      { _id: exec.id },
      {
        $set: {
          status: exec.status,
          cursor: exec.cursor,
          log: exec.log,
          finishedAt: exec.finishedAt,
          error: exec.error,
        },
      },
    );
  }

  async executions(workflowId: string, limit = 30): Promise<WorkflowExecution[]> {
    const docs = await this.execs.find({ workflowId }).sort({ startedAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => this.mapExecution(doc));
  }

  async allExecutions(limit = 100): Promise<WorkflowExecution[]> {
    const docs = await this.execs.find({}).sort({ startedAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => this.mapExecution(doc));
  }
}

/* -------------------------------------------------------------- snapshots -- */

export class MongoSnapshotStore implements SnapshotStore {
  constructor(private readonly mongo: MongoHandle) {}
  private get col() {
    return this.mongo.collection('file_snapshots');
  }
  private get files_() {
    return this.mongo.collection('snapshot_files');
  }

  private map(doc: Doc): SnapshotRecord {
    return {
      id: String(doc._id),
      projectId: String(doc.projectId),
      operationId: nullish(doc.operationId),
      kind: String(doc.kind) as SnapshotRecord['kind'],
      label: String(doc.label),
      createdAt: Number(doc.createdAt),
      hash: String(doc.hash),
      size: Number(doc.size),
      metadata: (doc.metadata as Record<string, unknown>) ?? {},
    };
  }

  async create(input: {
    projectId: string;
    operationId: string | null;
    kind: SnapshotRecord['kind'];
    label: string;
    hash: string;
    size: number;
    metadata?: Record<string, unknown>;
    files: { relPath: string; hash: string; existed: boolean; blobPath: string | null; content: string | null }[];
  }): Promise<SnapshotRecord> {
    const snapshotId = id('snap');
    const doc: Doc = {
      _id: snapshotId,
      projectId: input.projectId,
      operationId: input.operationId,
      kind: input.kind,
      label: input.label,
      createdAt: now(),
      hash: input.hash,
      size: input.size,
      metadata: input.metadata ?? {},
    };
    await this.col.insertOne(doc);
    if (input.files.length > 0) {
      await this.files_.insertMany(
        input.files.map((file, index) => ({
          _id: `${snapshotId}:${index}`,
          snapshotId,
          relPath: file.relPath,
          hash: file.hash,
          existed: file.existed,
          blobPath: file.blobPath,
          content: file.content,
        })),
      );
    }
    return this.map(doc);
  }

  async get(snapshotId: string): Promise<SnapshotRecord | null> {
    const doc = await this.col.findOne({ _id: snapshotId });
    return doc ? this.map(doc) : null;
  }

  async list(projectId: string, limit = 100): Promise<SnapshotRecord[]> {
    const docs = await this.col.find({ projectId }).sort({ createdAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => this.map(doc));
  }

  async files(snapshotId: string): Promise<SnapshotFileRecord[]> {
    const docs = await this.files_.find({ snapshotId }).limit(20_000).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      snapshotId: String(doc.snapshotId),
      relPath: String(doc.relPath),
      hash: String(doc.hash),
      existed: Boolean(doc.existed),
      blobPath: nullish(doc.blobPath),
      content: nullish(doc.content),
    }));
  }

  async findByOperation(operationId: string): Promise<SnapshotRecord | null> {
    const docs = await this.col.find({ operationId }).sort({ createdAt: -1 }).limit(1).toArray();
    return docs[0] ? this.map(docs[0]) : null;
  }

  async expire(days: number): Promise<{ snapshots: number; blobs: string[] }> {
    const cutoff = now() - days * 86_400_000;
    const old = await this.col.find({ createdAt: { $lt: cutoff } }).limit(10_000).toArray();
    const blobs: string[] = [];
    for (const doc of old) {
      for (const file of await this.files(String(doc._id))) {
        if (file.blobPath) blobs.push(file.blobPath);
      }
    }
    if (old.length > 0) {
      const ids = old.map((doc) => String(doc._id));
      await this.col.deleteMany({ _id: { $in: ids } });
      await this.files_.deleteMany({ snapshotId: { $in: ids } });
    }
    return { snapshots: old.length, blobs };
  }

  async count(projectId?: string): Promise<number> {
    return this.col.countDocuments(projectId ? { projectId } : {});
  }

  async findBlobByHash(hash: string): Promise<string | null> {
    const doc = await this.files_.findOne({ hash, blobPath: { $ne: null } });
    return doc ? nullish(doc.blobPath) : null;
  }

  async blobInUse(blobPath: string, exceptSnapshotId?: string): Promise<boolean> {
    const query: Doc = { blobPath };
    if (exceptSnapshotId) query.snapshotId = { $ne: exceptSnapshotId };
    return (await this.files_.countDocuments(query)) > 0;
  }
}

/* ---------------------------------------------------------- observability -- */

export class MongoObservabilityStore implements ObservabilityStore {
  constructor(private readonly mongo: MongoHandle) {}

  private get activity_() {
    return this.mongo.collection('activity_logs');
  }
  private get notifications_() {
    return this.mongo.collection('notifications');
  }
  private get toolExecs() {
    return this.mongo.collection('tool_executions');
  }
  private get approvals_() {
    return this.mongo.collection('approvals');
  }
  private get usage_() {
    return this.mongo.collection('provider_usage');
  }
  private get audit_() {
    return this.mongo.collection('audit_log');
  }
  private get jobs_() {
    return this.mongo.collection('jobs');
  }
  private get settings_() {
    return this.mongo.collection('app_settings');
  }
  private get agents_() {
    return this.mongo.collection('agents');
  }

  async addActivity(entry: Omit<ActivityEntry, 'id' | 'at'> & { at?: number }): Promise<string> {
    // Activity ids are monotonic in SQLite (rowid). Mongo has no such sequence, so
    // a zero-padded timestamp+random keeps them sortable and unique.
    const activityId = `${(entry.at ?? now()).toString().padStart(15, '0')}-${id('a')}`;
    await this.activity_.insertOne({
      _id: activityId,
      at: entry.at ?? now(),
      kind: entry.kind,
      level: entry.level,
      title: entry.title,
      detail: entry.detail,
      projectId: entry.projectId,
      taskId: entry.taskId,
      provider: entry.provider,
      status: entry.status,
    });
    return activityId;
  }

  async activity(
    filter: { kind?: string; level?: string; limit?: number; projectId?: string } = {},
  ): Promise<ActivityEntry[]> {
    const query: Doc = {};
    if (filter.kind) query.kind = filter.kind;
    if (filter.level) query.level = filter.level;
    if (filter.projectId) query.projectId = filter.projectId;
    const docs = await this.activity_.find(query).sort({ at: -1 }).limit(filter.limit ?? 100).toArray();
    return docs.map((doc) => ({
      id: Number(String(doc._id).split('-')[0]),
      at: Number(doc.at),
      kind: String(doc.kind) as ActivityEntry['kind'],
      level: String(doc.level) as ActivityEntry['level'],
      title: String(doc.title),
      detail: String(doc.detail),
      projectId: nullish(doc.projectId),
      taskId: nullish(doc.taskId),
      provider: doc.provider === null || doc.provider === undefined ? null : (String(doc.provider) as ProviderId),
      status: String(doc.status),
    }));
  }

  /* notifications */

  async addNotification(input: { title: string; body: string; level: NotificationEntry['level'] }): Promise<NotificationEntry> {
    const notificationId = id('ntf');
    const at = now();
    await this.notifications_.insertOne({
      _id: notificationId,
      at,
      title: input.title,
      body: input.body,
      level: input.level,
      read: false,
    });
    return { id: notificationId, at, title: input.title, body: input.body, level: input.level, read: false };
  }

  async notifications(limit = 50): Promise<NotificationEntry[]> {
    const docs = await this.notifications_.find({}).sort({ at: -1 }).limit(limit).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      at: Number(doc.at),
      title: String(doc.title),
      body: String(doc.body),
      level: String(doc.level) as NotificationEntry['level'],
      read: Boolean(doc.read),
    }));
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    await this.notifications_.updateOne({ _id: notificationId }, { $set: { read: true } });
  }

  async markAllNotificationsRead(): Promise<void> {
    await this.notifications_.updateMany({ read: false }, { $set: { read: true } });
  }

  async unreadNotificationCount(): Promise<number> {
    return this.notifications_.countDocuments({ read: false });
  }

  /* tool executions */

  async addToolExecution(record: Omit<ToolExecutionRecord, 'id' | 'createdAt'>): Promise<string> {
    const execId = id('exec');
    await this.toolExecs.insertOne({
      _id: execId,
      taskId: record.taskId,
      projectId: record.projectId,
      toolId: record.toolId,
      input: record.input,
      output: record.output ?? null,
      status: record.status,
      risk: record.risk,
      durationMs: record.durationMs,
      error: record.error,
      createdAt: now(),
    });
    return execId;
  }

  async toolExecutions(filter: { taskId?: string; limit?: number } = {}): Promise<(ToolExecutionRecord & { id: string })[]> {
    const query: Doc = {};
    if (filter.taskId) query.taskId = filter.taskId;
    const docs = await this.toolExecs.find(query).sort({ createdAt: -1 }).limit(filter.limit ?? 100).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      taskId: nullish(doc.taskId),
      projectId: nullish(doc.projectId),
      toolId: String(doc.toolId),
      input: (doc.input as Record<string, unknown>) ?? {},
      output: doc.output ?? null,
      status: String(doc.status) as ToolExecutionRecord['status'],
      risk: String(doc.risk) as ToolExecutionRecord['risk'],
      durationMs: Number(doc.durationMs),
      error: nullish(doc.error),
      createdAt: Number(doc.createdAt),
    }));
  }

  /* approvals */

  async createApproval(input: ApprovalInput): Promise<ApprovalRequest> {
    const approvalId = id('apr');
    const doc: Doc = {
      _id: approvalId,
      taskId: input.taskId,
      kind: input.kind,
      title: input.title,
      detail: input.detail,
      risk: input.risk,
      payload: input.payload,
      status: 'pending',
      createdAt: now(),
      resolvedAt: null,
      resolvedBy: null,
    };
    await this.approvals_.insertOne(doc);
    return this.mapApproval(doc);
  }

  private mapApproval(doc: Doc): ApprovalRequest {
    return {
      id: String(doc._id),
      taskId: nullish(doc.taskId),
      kind: String(doc.kind) as ApprovalRequest['kind'],
      title: String(doc.title),
      detail: String(doc.detail),
      risk: String(doc.risk) as ApprovalRequest['risk'],
      payload: (doc.payload as Record<string, unknown>) ?? {},
      createdAt: Number(doc.createdAt),
      status: String(doc.status) as ApprovalRequest['status'],
      resolvedAt: doc.resolvedAt === null || doc.resolvedAt === undefined ? null : Number(doc.resolvedAt),
      resolvedBy: nullish(doc.resolvedBy),
    };
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    const doc = await this.approvals_.findOne({ _id: approvalId });
    return doc ? this.mapApproval(doc) : null;
  }

  async approvals(filter: { status?: ApprovalRequest['status']; limit?: number } = {}): Promise<ApprovalRequest[]> {
    const query: Doc = {};
    if (filter.status) query.status = filter.status;
    const docs = await this.approvals_.find(query).sort({ createdAt: -1 }).limit(filter.limit ?? 50).toArray();
    return docs.map((doc) => this.mapApproval(doc));
  }

  async resolveApproval(
    approvalId: string,
    status: 'approved' | 'rejected' | 'expired',
    by = 'user',
  ): Promise<ApprovalRequest | null> {
    const result = await this.approvals_.updateOne(
      { _id: approvalId },
      { $set: { status, resolvedAt: now(), resolvedBy: by } },
    );
    if (result.matchedCount === 0) return null;
    return this.getApproval(approvalId);
  }

  /* usage */

  async recordUsage(record: Omit<ProviderUsageRecord, 'id' | 'createdAt'>): Promise<void> {
    await this.usage_.insertOne({
      _id: id('use'),
      provider: record.provider,
      modelId: record.modelId,
      purpose: record.purpose,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      tokensSource: record.tokensSource,
      latencyMs: record.latencyMs,
      ok: record.ok,
      errorClass: record.errorClass,
      costUsd: record.costUsd,
      createdAt: now(),
    });
  }

  async usage(limit = 200): Promise<ProviderUsageRecord[]> {
    const docs = await this.usage_.find({}).sort({ createdAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      provider: String(doc.provider) as ProviderId,
      modelId: String(doc.modelId),
      purpose: String(doc.purpose),
      inputTokens: doc.inputTokens === null || doc.inputTokens === undefined ? null : Number(doc.inputTokens),
      outputTokens: doc.outputTokens === null || doc.outputTokens === undefined ? null : Number(doc.outputTokens),
      tokensSource: String(doc.tokensSource) as ProviderUsageRecord['tokensSource'],
      latencyMs: Number(doc.latencyMs),
      ok: Boolean(doc.ok),
      errorClass: nullish(doc.errorClass),
      costUsd: doc.costUsd === null || doc.costUsd === undefined ? null : Number(doc.costUsd),
      createdAt: Number(doc.createdAt),
    }));
  }

  /* audit */

  async audit(input: {
    actor: string;
    action: string;
    subject?: string;
    allowed: boolean;
    reason?: string;
    metadata?: unknown;
  }): Promise<void> {
    await this.audit_.insertOne({
      _id: id('aud'),
      at: now(),
      actor: input.actor,
      action: input.action,
      subject: input.subject ?? '',
      allowed: input.allowed,
      reason: input.reason ?? '',
      metadata: input.metadata ?? {},
    });
  }

  async auditEntries(limit = 100): Promise<AuditEntry[]> {
    const docs = await this.audit_.find({}).sort({ at: -1 }).limit(limit).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      at: Number(doc.at),
      actor: String(doc.actor),
      action: String(doc.action),
      subject: String(doc.subject ?? ''),
      allowed: Boolean(doc.allowed),
      reason: String(doc.reason ?? ''),
      metadata: doc.metadata ?? {},
    }));
  }

  /* jobs */

  async upsertJob(job: {
    id: string;
    kind: string;
    referenceId?: string | null;
    status: string;
    progress: number;
    message: string;
  }): Promise<void> {
    const ts = now();
    await this.jobs_.updateOne(
      { _id: job.id },
      {
        $set: { status: job.status, progress: job.progress, message: job.message, updatedAt: ts },
        $setOnInsert: { kind: job.kind, referenceId: job.referenceId ?? null, createdAt: ts },
      },
      { upsert: true },
    );
  }

  async jobs(limit = 50): Promise<JobRecord[]> {
    const docs = await this.jobs_.find({}).sort({ updatedAt: -1 }).limit(limit).toArray();
    return docs.map((doc) => ({
      id: String(doc._id),
      kind: String(doc.kind),
      referenceId: nullish(doc.referenceId),
      status: String(doc.status),
      progress: Number(doc.progress),
      message: String(doc.message),
      createdAt: Number(doc.createdAt),
      updatedAt: Number(doc.updatedAt),
    }));
  }

  /* analytics — aggregation pipeline, same definitions as the SQL version */

  async analytics(): Promise<AnalyticsSnapshot> {
    const taskRows = await this.mongo
      .collection('tasks')
      .aggregate([
        {
          $group: {
            _id: '$status',
            c: { $sum: 1 },
            avgMs: {
              $avg: {
                $cond: [
                  { $and: [{ $ne: ['$finishedAt', null] }, { $ne: ['$startedAt', null] }] },
                  { $subtract: ['$finishedAt', '$startedAt'] },
                  null,
                ],
              },
            },
          },
        },
      ])
      .toArray();

    const byStatus: Record<string, number> = {};
    let total = 0;
    let avgAccum = 0;
    let avgCount = 0;
    for (const row of taskRows) {
      byStatus[String(row._id)] = Number(row.c);
      total += Number(row.c);
      if (row.avgMs !== null && row.avgMs !== undefined) {
        avgAccum += Number(row.avgMs) * Number(row.c);
        avgCount += Number(row.c);
      }
    }
    const succeeded = byStatus.completed ?? 0;
    const failed = byStatus.failed ?? 0;
    const successRate = succeeded + failed === 0 ? null : succeeded / (succeeded + failed);

    const providerRows = await this.mongo
      .collection('provider_usage')
      .aggregate([
        {
          $group: {
            _id: { provider: '$provider', modelId: '$modelId' },
            requests: { $sum: 1 },
            failures: { $sum: { $cond: ['$ok', 0, 1] } },
            inTokens: { $sum: { $ifNull: ['$inputTokens', 0] } },
            outTokens: { $sum: { $ifNull: ['$outputTokens', 0] } },
            cost: { $sum: '$costUsd' },
            avgLatency: { $avg: '$latencyMs' },
          },
        },
        { $sort: { requests: -1 } },
      ])
      .toArray();

    const toolRows = await this.mongo
      .collection('tool_executions')
      .aggregate([
        {
          $group: {
            _id: '$toolId',
            calls: { $sum: 1 },
            failures: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 0, 1] } },
            avgMs: { $avg: '$durationMs' },
          },
        },
        { $sort: { calls: -1 } },
      ])
      .toArray();

    const snapshotCount = await this.mongo.collection('file_snapshots').countDocuments({});
    const editedFiles = await this.mongo
      .collection('tool_executions')
      .countDocuments({ toolId: { $regex: '^editor\\.' } });
    const workflowRows = await this.mongo
      .collection('workflow_executions')
      .aggregate([{ $group: { _id: '$status', c: { $sum: 1 } } }])
      .toArray();
    const wfByStatus: Record<string, number> = {};
    for (const row of workflowRows) wfByStatus[String(row._id)] = Number(row.c);

    return {
      generatedAt: now(),
      tasks: {
        total,
        byStatus,
        successRate,
        avgDurationMs: avgCount === 0 ? null : Math.round(avgAccum / avgCount),
      },
      providers: providerRows.map((row) => {
        const key = row._id as { provider: string; modelId: string };
        return {
          provider: key.provider as ProviderId,
          modelId: key.modelId,
          requests: Number(row.requests),
          failures: Number(row.failures),
          inputTokens: Number(row.inTokens),
          outputTokens: Number(row.outTokens),
          estimatedCostUsd: row.cost === null || row.cost === undefined ? null : Number(row.cost),
          avgLatencyMs:
            row.avgLatency === null || row.avgLatency === undefined ? null : Math.round(Number(row.avgLatency)),
        };
      }),
      tools: toolRows.map((row) => ({
        toolId: String(row._id),
        calls: Number(row.calls),
        failures: Number(row.failures),
        avgDurationMs: row.avgMs === null || row.avgMs === undefined ? null : Math.round(Number(row.avgMs)),
      })),
      files: { snapshots: snapshotCount, modified: editedFiles },
      workflows: {
        executions: Object.values(wfByStatus).reduce((a, b) => a + b, 0),
        completed: wfByStatus.completed ?? 0,
        failed: wfByStatus.failed ?? 0,
      },
    };
  }

  /* settings + agents */

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const doc = await this.settings_.findOne({ _id: key });
    if (!doc) return fallback;
    return ((doc.value as T | undefined) ?? fallback) as T;
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.settings_.updateOne(
      { _id: key },
      { $set: { value, updatedAt: now() } },
      { upsert: true },
    );
  }

  async upsertAgent(agent: AgentRecord): Promise<void> {
    await this.agents_.updateOne(
      { _id: agent.role },
      {
        $set: {
          name: agent.name,
          description: agent.description,
          allowedTools: agent.allowedTools,
          mayWriteFiles: agent.mayWriteFiles,
        },
      },
      { upsert: true },
    );
  }

  async agents(): Promise<AgentRecord[]> {
    const docs = await this.agents_.find({}).sort({ _id: 1 }).limit(100).toArray();
    return docs.map((doc) => ({
      role: String(doc._id),
      name: String(doc.name),
      description: String(doc.description),
      allowedTools: (doc.allowedTools as string[]) ?? [],
      mayWriteFiles: Boolean(doc.mayWriteFiles),
    }));
  }
}

/* ------------------------------------------------------------- embeddings -- */

export class MongoEmbeddingStore implements EmbeddingStore {
  constructor(private readonly mongo: MongoHandle) {}
  private get col() {
    return this.mongo.collection('embeddings');
  }

  async list(projectId: string): Promise<EmbeddingRecord[]> {
    const docs = await this.col.find({ projectId }).limit(200_000).toArray();
    return docs.map((doc) => ({
      chunkId: String(doc.chunkId),
      vector: new Float32Array((doc.vector as number[]) ?? []),
    }));
  }

  async upsert(projectId: string, model: string, entries: { chunkId: string; vector: Float32Array }[]): Promise<void> {
    // Stored as a plain number array: readable in the shell and portable across
    // BSON binary subtypes, at the cost of some size.
    for (const entry of entries) {
      if (entry.vector.length === 0) continue;
      await this.col.updateOne(
        { chunkId: entry.chunkId },
        {
          $set: {
            projectId,
            chunkId: entry.chunkId,
            vector: Array.from(entry.vector),
            dim: entry.vector.length,
            model,
            createdAt: now(),
          },
        },
        { upsert: true },
      );
    }
  }

  async removeForFile(projectId: string, relPath: string): Promise<void> {
    const chunks = await this.mongo.collection('file_chunks').find({ projectId, relPath }).limit(20_000).toArray();
    if (chunks.length === 0) return;
    await this.col.deleteMany({ chunkId: { $in: chunks.map((c) => String(c._id)) } });
  }
}
