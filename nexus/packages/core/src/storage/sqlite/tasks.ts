import type { PlanStep, TaskRecord, TaskStatus } from '../../types.js';
import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';
import type { TaskStore } from '../contracts.js';

export class SqliteTaskStore implements TaskStore {
  constructor(private readonly db: SqlDriver) {}

  private map(row: SqlRow): TaskRecord {
    return {
      id: String(row.id),
      projectId: row.project_id === null ? null : String(row.project_id),
      title: String(row.title),
      description: String(row.description ?? ''),
      status: String(row.status) as TaskStatus,
      priority: Number(row.priority),
      agentRole: String(row.agent_role) as TaskRecord['agentRole'],
      plan: parseJson<PlanStep[]>(row.plan, []),
      currentStepId: row.current_step_id === null ? null : String(row.current_step_id),
      progress: Number(row.progress),
      createdAt: Number(row.created_at),
      startedAt: row.started_at === null ? null : Number(row.started_at),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at),
      error: row.error === null ? null : String(row.error),
      checkpoint: parseJson<Record<string, unknown>>(row.checkpoint, {}),
      result: row.result === null ? null : String(row.result),
    };
  }

  async list(filter: { status?: TaskStatus; projectId?: string | null; limit?: number } = {}): Promise<TaskRecord[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.projectId) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    params.push(filter.limit ?? 100);
    return this.db
      .all(
        `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY created_at DESC LIMIT ?`,
        params,
      )
      .map((r) => this.map(r));
  }

  async get(taskId: string): Promise<TaskRecord | null> {
    const row = this.db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
    return row ? this.map(row) : null;
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
    this.db.run(
      `INSERT INTO tasks (id, project_id, conversation_id, title, description, status, priority, agent_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        taskId,
        input.projectId,
        input.conversationId ?? null,
        input.title,
        input.description ?? '',
        input.status ?? 'pending',
        input.priority ?? 5,
        input.agentRole ?? 'planning',
        now(),
      ],
    );
    return (await this.get(taskId))!;
  }

  async update(taskId: string, patch: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const current = await this.get(taskId);
    if (!current) return null;
    this.db.run(
      `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, agent_role = ?, plan = ?,
        current_step_id = ?, progress = ?, started_at = ?, finished_at = ?, error = ?, checkpoint = ?, result = ?
       WHERE id = ?`,
      [
        patch.title ?? current.title,
        patch.description ?? current.description,
        patch.status ?? current.status,
        patch.priority ?? current.priority,
        patch.agentRole ?? current.agentRole,
        JSON.stringify(patch.plan ?? current.plan),
        patch.currentStepId === undefined ? current.currentStepId : patch.currentStepId,
        patch.progress ?? current.progress,
        patch.startedAt === undefined ? current.startedAt : patch.startedAt,
        patch.finishedAt === undefined ? current.finishedAt : patch.finishedAt,
        patch.error === undefined ? current.error : patch.error,
        JSON.stringify(patch.checkpoint ?? current.checkpoint),
        patch.result === undefined ? current.result : patch.result,
        taskId,
      ],
    );
    return await this.get(taskId);
  }

  /** Tasks left mid-flight by a crash — used by interruption recovery. */
  async interrupted(): Promise<TaskRecord[]> {
    return this.db
      .all("SELECT * FROM tasks WHERE status IN ('running','planning') ORDER BY created_at")
      .map((r) => this.map(r));
  }

  async activeCount(): Promise<number> {
    const row = this.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM tasks WHERE status IN ('running','planning','awaiting_approval')",
    );
    return Number(row?.c ?? 0);
  }

  async completedStepIds(taskId: string): Promise<string[]> {
    const task = await this.get(taskId);
    return task ? task.plan.filter((s) => s.status === 'completed').map((s) => s.id) : [];
  }
}
