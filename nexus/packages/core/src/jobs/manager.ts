/**
 * Phase 13 — Background task and event system.
 *
 * Long-running work (indexing, workflows, agent runs, embedding passes) is started
 * as a job: it returns an id immediately, streams progress over the event bus, and
 * persists its state so interruption is recoverable. HTTP handlers never await
 * long work.
 */
import { NexusError, describeError } from '../errors.js';
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import { id } from '../storage/driver.js';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  kind: string;
  referenceId: string | null;
  status: JobState;
  progress: number;
  message: string;
  createdAt: number;
  updatedAt: number;
}

interface JobHandle {
  job: Job;
  cancel: () => void;
}

export class JobManager {
  private jobs = new Map<string, JobHandle>();

  constructor(
    private readonly db: Database,
    private readonly events?: EventBus,
  ) {}

  /**
   * Start a job. `fn` receives a progress reporter and an abort signal.
   * Returns immediately with the persisted job record.
   */
  start(
    kind: string,
    fn: (ctx: { report: (progress: number, message: string) => void; signal: AbortSignal }) => Promise<unknown>,
    options: { referenceId?: string | null } = {},
  ): Job {
    const job: Job = {
      id: id('job'),
      kind,
      referenceId: options.referenceId ?? null,
      status: 'queued',
      progress: 0,
      message: 'Queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const controller = new AbortController();
    this.jobs.set(job.id, { job, cancel: () => controller.abort() });
    this.persist(job);

    // Fire and forget: the caller gets the id, never the promise.
    void this.execute(job, fn, controller.signal);
    return job;
  }

  private async execute(
    job: Job,
    fn: (ctx: { report: (progress: number, message: string) => void; signal: AbortSignal }) => Promise<unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    job.status = 'running';
    job.message = 'Running';
    this.persist(job);
    try {
      await fn({
        report: (progress, message) => {
          job.progress = Math.max(0, Math.min(1, progress));
          job.message = message;
          job.updatedAt = Date.now();
          this.persist(job);
          this.events?.emit('job.updated', message, { jobId: job.id, progress: job.progress, kind: job.kind });
        },
        signal,
      });
      if (signal.aborted) {
        job.status = 'cancelled';
        job.message = 'Cancelled';
      } else {
        job.status = 'completed';
        job.progress = 1;
        job.message = 'Completed';
      }
    } catch (err) {
      job.status = signal.aborted ? 'cancelled' : 'failed';
      job.message = describeError(err);
      this.db.observability.addNotification({
        title: `Job failed: ${job.kind}`,
        body: job.message.slice(0, 300),
        level: 'error',
      });
    } finally {
      job.updatedAt = Date.now();
      this.persist(job);
      this.events?.emit('job.updated', `${job.kind}: ${job.status}`, {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
      });
      // Keep the handle briefly so `get` works after completion, then drop it.
      setTimeout(() => this.jobs.delete(job.id), 10 * 60 * 1000).unref?.();
      void NexusError;
    }
  }

  get(jobId: string): Job | null {
    const handle = this.jobs.get(jobId);
    if (handle) return handle.job;
    const rows = this.db.observability.jobs(200);
    const row = rows.find((r) => String(r.id) === jobId);
    return row
      ? {
          id: String(row.id),
          kind: String(row.kind),
          referenceId: row.reference_id === null ? null : String(row.reference_id),
          status: String(row.status) as JobState,
          progress: Number(row.progress),
          message: String(row.message),
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }
      : null;
  }

  list(): Job[] {
    const live = [...this.jobs.values()].map((h) => h.job);
    const persisted = this.db.observability.jobs(100).map((row) => ({
      id: String(row.id),
      kind: String(row.kind),
      referenceId: row.reference_id === null ? null : String(row.reference_id),
      status: String(row.status) as JobState,
      progress: Number(row.progress),
      message: String(row.message),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }));
    const byId = new Map<string, Job>();
    for (const job of persisted) byId.set(job.id, job);
    for (const job of live) byId.set(job.id, job);
    return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  cancel(jobId: string): Job {
    const handle = this.jobs.get(jobId);
    if (!handle) throw new NexusError('NOT_FOUND', `Job not found: ${jobId}`);
    handle.cancel();
    handle.job.message = 'Cancelling…';
    return handle.job;
  }

  private persist(job: Job): void {
    try {
      this.db.observability.upsertJob({
        id: job.id,
        kind: job.kind,
        referenceId: job.referenceId,
        status: job.status,
        progress: job.progress,
        message: job.message.slice(0, 500),
      });
    } catch (err) {
      console.error('[nexus][jobs] failed to persist job:', err);
    }
  }
}
