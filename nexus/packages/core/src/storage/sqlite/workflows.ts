import type { WorkflowBlock, WorkflowDefinition, WorkflowExecution } from '../../types.js';
import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';
import type { WorkflowStore } from '../contracts.js';

export class SqliteWorkflowStore implements WorkflowStore {
  constructor(private readonly db: SqlDriver) {}

  private mapWorkflow(row: SqlRow): WorkflowDefinition {
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description ?? ''),
      projectId: row.project_id === null ? null : String(row.project_id),
      blocks: parseJson<WorkflowBlock[]>(row.blocks, []),
      entry: row.entry === null ? null : String(row.entry),
      isTemplate: Number(row.is_template) === 1,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapExecution(row: SqlRow): WorkflowExecution {
    return {
      id: String(row.id),
      workflowId: String(row.workflow_id),
      projectId: row.project_id === null ? null : String(row.project_id),
      status: String(row.status) as WorkflowExecution['status'],
      cursor: row.cursor === null ? null : String(row.cursor),
      log: parseJson<WorkflowExecution['log']>(row.log, []),
      startedAt: Number(row.started_at),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at),
      error: row.error === null ? null : String(row.error),
    };
  }

  async list(): Promise<WorkflowDefinition[]> {
    return this.db.all('SELECT * FROM workflows ORDER BY updated_at DESC').map((r) => this.mapWorkflow(r));
  }

  async get(workflowId: string): Promise<WorkflowDefinition | null> {
    const row = this.db.get('SELECT * FROM workflows WHERE id = ?', [workflowId]);
    return row ? this.mapWorkflow(row) : null;
  }

  async create(input: {
    name: string;
    description?: string;
    projectId?: string | null;
    blocks: WorkflowBlock[];
    entry?: string | null;
    isTemplate?: boolean;
  }): Promise<WorkflowDefinition> {
    const workflowId = id('wf');
    const ts = now();
    this.db.run(
      `INSERT INTO workflows (id, name, description, project_id, blocks, entry, is_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        workflowId,
        input.name,
        input.description ?? '',
        input.projectId ?? null,
        JSON.stringify(input.blocks),
        input.entry ?? input.blocks[0]?.id ?? null,
        input.isTemplate ? 1 : 0,
        ts,
        ts,
      ],
    );
    return (await this.get(workflowId))!;
  }

  async update(
    workflowId: string,
    patch: { name?: string; description?: string; blocks?: WorkflowBlock[]; entry?: string | null },
  ): Promise<WorkflowDefinition | null> {
    const current = await this.get(workflowId);
    if (!current) return null;
    this.db.run(
      'UPDATE workflows SET name = ?, description = ?, blocks = ?, entry = ?, updated_at = ? WHERE id = ?',
      [
        patch.name ?? current.name,
        patch.description ?? current.description,
        JSON.stringify(patch.blocks ?? current.blocks),
        patch.entry === undefined ? current.entry : patch.entry,
        now(),
        workflowId,
      ],
    );
    return await this.get(workflowId);
  }

  async remove(workflowId: string): Promise<boolean> {
    return this.db.run('DELETE FROM workflows WHERE id = ?', [workflowId]).changes > 0;
  }

  async createExecution(workflow: WorkflowDefinition): Promise<WorkflowExecution> {
    const executionId = id('wfx');
    this.db.run(
      `INSERT INTO workflow_executions (id, workflow_id, project_id, status, cursor, log, started_at)
       VALUES (?, ?, ?, 'running', ?, '[]', ?)`,
      [executionId, workflow.id, workflow.projectId, workflow.entry, now()],
    );
    return (await this.getExecution(executionId))!;
  }

  async getExecution(executionId: string): Promise<WorkflowExecution | null> {
    const row = this.db.get('SELECT * FROM workflow_executions WHERE id = ?', [executionId]);
    return row ? this.mapExecution(row) : null;
  }

  async saveExecution(exec: WorkflowExecution): Promise<void> {
    this.db.run(
      'UPDATE workflow_executions SET status = ?, cursor = ?, log = ?, finished_at = ?, error = ? WHERE id = ?',
      [exec.status, exec.cursor, JSON.stringify(exec.log), exec.finishedAt, exec.error, exec.id],
    );
  }

  async executions(workflowId: string, limit = 30): Promise<WorkflowExecution[]> {
    return this.db
      .all('SELECT * FROM workflow_executions WHERE workflow_id = ? ORDER BY started_at DESC LIMIT ?', [
        workflowId,
        limit,
      ])
      .map((r) => this.mapExecution(r));
  }

  async allExecutions(limit = 100): Promise<WorkflowExecution[]> {
    return this.db
      .all('SELECT * FROM workflow_executions ORDER BY started_at DESC LIMIT ?', [limit])
      .map((r) => this.mapExecution(r));
  }
}
