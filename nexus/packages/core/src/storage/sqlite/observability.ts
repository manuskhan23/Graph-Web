import type {
  ActivityEntry,
  AnalyticsSnapshot,
  ApprovalRequest,
  NotificationEntry,
  ProviderId,
  ProviderUsageRecord,
  RiskLevel,
  ToolDescriptor,
  ToolExecutionRecord,
} from '../../types.js';
import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';
import type { AuditEntry, JobRecord, ObservabilityStore } from '../contracts.js';

export class SqliteObservabilityStore implements ObservabilityStore {
  constructor(private readonly db: SqlDriver) {}

  /* ------------------------------------------------------------ activity */

  async addActivity(entry: Omit<ActivityEntry, 'id' | 'at'> & { at?: number }): Promise<string> {
    const res = this.db.run(
      `INSERT INTO activity_logs (at, kind, level, title, detail, project_id, task_id, provider, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.at ?? now(),
        entry.kind,
        entry.level,
        entry.title,
        entry.detail,
        entry.projectId,
        entry.taskId,
        entry.provider,
        entry.status,
      ],
    );
    return String(res.lastInsertRowid);
  }

  async activity(filter: { kind?: string; level?: string; limit?: number; projectId?: string } = {}): Promise<ActivityEntry[]> {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.kind) {
      where.push('kind = ?');
      params.push(filter.kind);
    }
    if (filter.level) {
      where.push('level = ?');
      params.push(filter.level);
    }
    if (filter.projectId) {
      where.push('project_id = ?');
      params.push(filter.projectId);
    }
    params.push(filter.limit ?? 100);
    return this.db
      .all(
        `SELECT * FROM activity_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY at DESC LIMIT ?`,
        params,
      )
      .map((r) => ({
        id: Number(r.id),
        at: Number(r.at),
        kind: String(r.kind) as ActivityEntry['kind'],
        level: String(r.level) as ActivityEntry['level'],
        title: String(r.title),
        detail: String(r.detail),
        projectId: r.project_id === null ? null : String(r.project_id),
        taskId: r.task_id === null ? null : String(r.task_id),
        provider: r.provider === null ? null : (String(r.provider) as ProviderId),
        status: String(r.status),
      }));
  }

  /* ------------------------------------------------------ notifications */

  async addNotification(input: { title: string; body: string; level: NotificationEntry['level'] }): Promise<NotificationEntry> {
    const notificationId = id('ntf');
    this.db.run('INSERT INTO notifications (id, at, title, body, level, is_read) VALUES (?, ?, ?, ?, ?, 0)', [
      notificationId,
      now(),
      input.title,
      input.body,
      input.level,
    ]);
    return (await this.notifications(1))[0]!;
  }

  async notifications(limit = 50): Promise<NotificationEntry[]> {
    return this.db.all('SELECT * FROM notifications ORDER BY at DESC LIMIT ?', [limit]).map((r) => ({
      id: String(r.id),
      at: Number(r.at),
      title: String(r.title),
      body: String(r.body),
      level: String(r.level) as NotificationEntry['level'],
      read: Number(r.is_read) === 1,
    }));
  }

  async markNotificationRead(notificationId: string): Promise<void> {
    this.db.run('UPDATE notifications SET is_read = 1 WHERE id = ?', [notificationId]);
  }

  async markAllNotificationsRead(): Promise<void> {
    this.db.run('UPDATE notifications SET is_read = 1 WHERE is_read = 0');
  }

  async unreadNotificationCount(): Promise<number> {
    const row = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM notifications WHERE is_read = 0');
    return Number(row?.c ?? 0);
  }

  /* ------------------------------------------------------- tool records */

  async addToolExecution(record: Omit<ToolExecutionRecord, 'id' | 'createdAt'>): Promise<string> {
    const execId = id('exec');
    this.db.run(
      `INSERT INTO tool_executions (id, task_id, project_id, tool_id, tool_input, output, status, risk, duration_ms, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        execId,
        record.taskId,
        record.projectId,
        record.toolId,
        JSON.stringify(record.input),
        JSON.stringify(record.output ?? null),
        record.status,
        record.risk,
        record.durationMs,
        record.error,
        now(),
      ],
    );
    return execId;
  }

  async toolExecutions(filter: { taskId?: string; limit?: number } = {}): Promise<(ToolExecutionRecord & { id: string })[]> {
    const params: (string | number)[] = [];
    let where = '';
    if (filter.taskId) {
      where = 'WHERE task_id = ?';
      params.push(filter.taskId);
    }
    params.push(filter.limit ?? 100);
    return this.db.all(`SELECT * FROM tool_executions ${where} ORDER BY created_at DESC LIMIT ?`, params).map((r) => ({
      id: String(r.id),
      taskId: r.task_id === null ? null : String(r.task_id),
      projectId: r.project_id === null ? null : String(r.project_id),
      toolId: String(r.tool_id),
      input: parseJson<Record<string, unknown>>(r.tool_input, {}),
      output: parseJson<unknown>(r.output, null),
      status: String(r.status) as ToolExecutionRecord['status'],
      risk: String(r.risk) as RiskLevel,
      durationMs: Number(r.duration_ms),
      error: r.error === null ? null : String(r.error),
      createdAt: Number(r.created_at),
    }));
  }

  /* --------------------------------------------------------- approvals */

  async createApproval(input: Omit<ApprovalRequest, 'id' | 'createdAt' | 'status' | 'resolvedAt' | 'resolvedBy'>): Promise<ApprovalRequest> {
    const approvalId = id('apr');
    this.db.run(
      `INSERT INTO approvals (id, task_id, kind, title, detail, risk, payload, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [approvalId, input.taskId, input.kind, input.title, input.detail, input.risk, JSON.stringify(input.payload), now()],
    );
    return (await this.getApproval(approvalId))!;
  }

  async getApproval(approvalId: string): Promise<ApprovalRequest | null> {
    const row = this.db.get('SELECT * FROM approvals WHERE id = ?', [approvalId]);
    return row ? this.mapApproval(row) : null;
  }

  private mapApproval(row: SqlRow): ApprovalRequest {
    return {
      id: String(row.id),
      taskId: row.task_id === null ? null : String(row.task_id),
      kind: String(row.kind) as ApprovalRequest['kind'],
      title: String(row.title),
      detail: String(row.detail),
      risk: String(row.risk) as RiskLevel,
      payload: parseJson<Record<string, unknown>>(row.payload, {}),
      createdAt: Number(row.created_at),
      status: String(row.status) as ApprovalRequest['status'],
      resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
      resolvedBy: row.resolved_by === null ? null : String(row.resolved_by),
    };
  }

  async approvals(filter: { status?: ApprovalRequest['status']; limit?: number } = {}): Promise<ApprovalRequest[]> {
    const params: (string | number)[] = [];
    let where = '';
    if (filter.status) {
      where = 'WHERE status = ?';
      params.push(filter.status);
    }
    params.push(filter.limit ?? 50);
    return this.db.all(`SELECT * FROM approvals ${where} ORDER BY created_at DESC LIMIT ?`, params).map((r) => this.mapApproval(r));
  }

  async resolveApproval(
    approvalId: string,
    status: 'approved' | 'rejected' | 'expired',
    by = 'user',
  ): Promise<ApprovalRequest | null> {
    this.db.run('UPDATE approvals SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?', [
      status,
      now(),
      by,
      approvalId,
    ]);
    return await this.getApproval(approvalId);
  }

  /* ------------------------------------------------------ provider usage */

  async recordUsage(record: Omit<ProviderUsageRecord, 'id' | 'createdAt'>): Promise<void> {
    this.db.run(
      `INSERT INTO provider_usage (provider, model_id, purpose, input_tokens, output_tokens, tokens_source,
        latency_ms, ok, error_class, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.provider,
        record.modelId,
        record.purpose,
        record.inputTokens,
        record.outputTokens,
        record.tokensSource,
        record.latencyMs,
        record.ok ? 1 : 0,
        record.errorClass,
        record.costUsd,
        now(),
      ],
    );
  }

  async usage(limit = 200): Promise<ProviderUsageRecord[]> {
    return this.db.all('SELECT * FROM provider_usage ORDER BY created_at DESC LIMIT ?', [limit]).map((r) => ({
      id: String(r.id),
      provider: String(r.provider) as ProviderId,
      modelId: String(r.model_id),
      purpose: String(r.purpose),
      inputTokens: r.input_tokens === null ? null : Number(r.input_tokens),
      outputTokens: r.output_tokens === null ? null : Number(r.output_tokens),
      tokensSource: String(r.tokens_source) as 'provider' | 'estimated',
      latencyMs: Number(r.latency_ms),
      ok: Number(r.ok) === 1,
      errorClass: r.error_class === null ? null : String(r.error_class),
      costUsd: r.cost_usd === null ? null : Number(r.cost_usd),
      createdAt: Number(r.created_at),
    }));
  }

  /* ----------------------------------------------------------- audit log */

  async audit(input: { actor: string; action: string; subject?: string; allowed: boolean; reason?: string; metadata?: unknown }): Promise<void> {
    this.db.run(
      'INSERT INTO audit_log (at, actor, action, subject, allowed, reason, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        now(),
        input.actor,
        input.action,
        input.subject ?? '',
        input.allowed ? 1 : 0,
        input.reason ?? '',
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async auditEntries(limit = 100): Promise<AuditEntry[]> {
    return this.db.all<SqlRow>('SELECT * FROM audit_log ORDER BY at DESC LIMIT ?', [limit]).map((row) => ({
      id: String(row.id),
      at: Number(row.at),
      actor: String(row.actor),
      action: String(row.action),
      subject: String(row.subject ?? ''),
      allowed: Number(row.allowed) === 1,
      reason: String(row.reason ?? ''),
      metadata: parseJson<unknown>(row.metadata, {}),
    }));
  }

  /* --------------------------------------------------------------- jobs */

  async upsertJob(job: { id: string; kind: string; referenceId?: string | null; status: string; progress: number; message: string }): Promise<void> {
    const ts = now();
    this.db.run(
      `INSERT INTO jobs (id, kind, reference_id, status, progress, message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, progress = excluded.progress,
         message = excluded.message, updated_at = excluded.updated_at`,
      [job.id, job.kind, job.referenceId ?? null, job.status, job.progress, job.message, ts, ts],
    );
  }

  async jobs(limit = 50): Promise<JobRecord[]> {
    return this.db.all<SqlRow>('SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?', [limit]).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      referenceId: row.reference_id === null ? null : String(row.reference_id),
      status: String(row.status),
      progress: Number(row.progress),
      message: String(row.message),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
  }

  /* ---------------------------------------------------------- analytics */

  /**
   * Every number below is a SQL aggregate over real rows. Nothing is invented:
   * `null` is returned when there is no data to aggregate.
   */
  async analytics(): Promise<AnalyticsSnapshot> {
    const taskRows = this.db.all<{ status: string; c: number; avg_ms: number | null }>(
      `SELECT status, COUNT(*) AS c, AVG(CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL
        THEN finished_at - started_at END) AS avg_ms FROM tasks GROUP BY status`,
    );
    const byStatus: Record<string, number> = {};
    let total = 0;
    let avgAccum = 0;
    let avgCount = 0;
    for (const r of taskRows) {
      byStatus[r.status] = Number(r.c);
      total += Number(r.c);
      if (r.avg_ms !== null) {
        avgAccum += Number(r.avg_ms) * Number(r.c);
        avgCount += Number(r.c);
      }
    }
    const succeeded = byStatus.completed ?? 0;
    const failed = byStatus.failed ?? 0;
    const successRate = succeeded + failed === 0 ? null : succeeded / (succeeded + failed);

    const providerRows = this.db.all<SqlRow>(
      `SELECT provider, model_id, COUNT(*) AS requests, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures,
        COALESCE(SUM(input_tokens), 0) AS in_tokens, COALESCE(SUM(output_tokens), 0) AS out_tokens,
        SUM(cost_usd) AS cost, AVG(latency_ms) AS avg_latency
       FROM provider_usage GROUP BY provider, model_id ORDER BY requests DESC`,
    );

    const toolRows = this.db.all<SqlRow>(
      `SELECT tool_id, COUNT(*) AS calls, SUM(CASE WHEN status != 'success' THEN 1 ELSE 0 END) AS failures,
        AVG(duration_ms) AS avg_ms FROM tool_executions GROUP BY tool_id ORDER BY calls DESC`,
    );

    const filesRow = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM tool_executions WHERE tool_id LIKE \'editor.%\'') ;
    const snapsRow = this.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM file_snapshots');
    const wfRows = this.db.all<{ status: string; c: number }>(
      'SELECT status, COUNT(*) AS c FROM workflow_executions GROUP BY status',
    );
    const wfByStatus: Record<string, number> = {};
    for (const r of wfRows) wfByStatus[r.status] = Number(r.c);

    return {
      generatedAt: now(),
      tasks: {
        total,
        byStatus,
        successRate,
        avgDurationMs: avgCount === 0 ? null : Math.round(avgAccum / avgCount),
      },
      providers: providerRows.map((r) => ({
        provider: String(r.provider) as ProviderId,
        modelId: String(r.model_id),
        requests: Number(r.requests),
        failures: Number(r.failures),
        inputTokens: Number(r.in_tokens),
        outputTokens: Number(r.out_tokens),
        estimatedCostUsd: r.cost === null ? null : Number(r.cost),
        avgLatencyMs: r.avg_latency === null ? null : Math.round(Number(r.avg_latency)),
      })),
      tools: toolRows.map((r) => ({
        toolId: String(r.tool_id),
        calls: Number(r.calls),
        failures: Number(r.failures),
        avgDurationMs: r.avg_ms === null ? null : Math.round(Number(r.avg_ms)),
      })),
      files: {
        snapshots: Number(snapsRow?.c ?? 0),
        modified: Number(filesRow?.c ?? 0),
      },
      workflows: {
        executions: Object.values(wfByStatus).reduce((a, b) => a + b, 0),
        completed: wfByStatus.completed ?? 0,
        failed: wfByStatus.failed ?? 0,
      },
    };
  }

  /* --------------------------------------------------------- app settings */

  async getSetting<T>(key: string, fallback: T): Promise<T> {
    const row = this.db.get<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key]);
    if (!row) return fallback;
    return parseJson<T>(row.value, fallback);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    this.db.run(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), now()],
    );
  }

  /* ------------------------------------------------------------ agents */

  async upsertAgent(agent: {
    role: string;
    name: string;
    description: string;
    allowedTools: string[];
    mayWriteFiles: boolean;
  }): Promise<void> {
    this.db.run(
      `INSERT INTO agents (role, name, description, allowed_tools, may_write_files) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(role) DO UPDATE SET name = excluded.name, description = excluded.description,
         allowed_tools = excluded.allowed_tools, may_write_files = excluded.may_write_files`,
      [agent.role, agent.name, agent.description, JSON.stringify(agent.allowedTools), agent.mayWriteFiles ? 1 : 0],
    );
  }

  async agents(): Promise<{ role: string; name: string; description: string; allowedTools: string[]; mayWriteFiles: boolean }[]> {
    return this.db.all('SELECT * FROM agents ORDER BY role').map((r) => ({
      role: String(r.role),
      name: String(r.name),
      description: String(r.description),
      allowedTools: parseJson<string[]>(r.allowed_tools, []),
      mayWriteFiles: Number(r.may_write_files) === 1,
    }));
  }
}

export type { ToolDescriptor };
