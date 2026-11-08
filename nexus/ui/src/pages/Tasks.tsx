/** Tasks: inspect plans, steps, tool calls, approvals; cancel / pause / resume. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, ProgressBar, RiskPill, SpinnerBlock, StatusPill, StepRow, duration, relativeTime } from '../components/ui';

export function TasksPage() {
  const { reloadKey, toast, bumpReload } = useStore();
  const [statusFilter, setStatusFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const tasks = useAsync(() => api.tasks({ status: statusFilter || undefined, limit: 100 }), [statusFilter, reloadKey]);
  const detail = useAsync(() => (selectedId ? api.task(selectedId) : Promise.resolve(null)), [selectedId, reloadKey]);
  const approvals = useAsync(() => api.approvals('pending'), [reloadKey]);

  const act = async (action: 'cancel' | 'pause' | 'resume', taskId: string) => {
    try {
      if (action === 'cancel') await api.cancelTask(taskId);
      if (action === 'pause') await api.pauseTask(taskId);
      if (action === 'resume') await api.resumeTask(taskId);
      toast(`Task ${action === 'resume' ? 'resumed' : action + 'ed'}`);
      bumpReload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const resolveApproval = async (id: string, approved: boolean) => {
    try {
      await api.resolveApproval(id, approved);
      approvals.reload();
      bumpReload();
      toast(approved ? 'Approved' : 'Rejected');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (tasks.loading) return <SpinnerBlock />;

  return (
    <div className="col" style={{ gap: 14 }}>
      {(approvals.data?.approvals.length ?? 0) > 0 && (
        <Card title={`Pending approvals (${approvals.data!.approvals.length})`}>
          {approvals.data!.approvals.map((approval) => (
            <div key={approval.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid #1e1e1e', alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small">{approval.title}</span>
                  <RiskPill risk={approval.risk} />
                  <span className="pill outline tiny">{approval.kind}</span>
                </div>
                <div className="tiny dim">{approval.detail}</div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button className="primary tiny" onClick={() => void resolveApproval(approval.id, true)} type="button">
                  approve
                </button>
                <button className="danger tiny" onClick={() => void resolveApproval(approval.id, false)} type="button">
                  reject
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card
        title={`Tasks (${tasks.data?.tasks.length ?? 0})`}
        actions={
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} style={{ width: 150, fontSize: 11, padding: '3px 6px' }}>
            <option value="">all statuses</option>
            {['pending', 'planning', 'running', 'awaiting_approval', 'paused', 'completed', 'failed', 'cancelled'].map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        }
      >
        {tasks.data?.tasks.length === 0 && <Empty title="No tasks">Run a request from AI Chat.</Empty>}
        {tasks.data && tasks.data.tasks.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Agent</th>
                <th>Progress</th>
                <th>Status</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(tasks.data?.tasks ?? []).map((task) => (
                <tr key={task.id} className="clickable" onClick={() => setSelectedId(task.id)}>
                  <td className="ellipsis" style={{ maxWidth: 340 }}>
                    {task.title}
                  </td>
                  <td className="tiny mono">{task.agentRole}</td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <div style={{ width: 60 }}>
                        <ProgressBar value={task.progress} />
                      </div>
                      <span className="tiny dim">{Math.round(task.progress * 100)}%</span>
                    </div>
                  </td>
                  <td>
                    <StatusPill status={task.status} />
                  </td>
                  <td className="tiny dim nowrap">{relativeTime(task.createdAt)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {(task.status === 'running' || task.status === 'planning') && (
                        <button
                          className="tiny"
                          onClick={(event) => {
                            event.stopPropagation();
                            void act('cancel', task.id);
                          }}
                          type="button"
                        >
                          cancel
                        </button>
                      )}
                      {task.status === 'failed' && (
                        <button
                          className="tiny"
                          onClick={(event) => {
                            event.stopPropagation();
                            void act('resume', task.id);
                          }}
                          type="button"
                        >
                          retry
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selectedId && detail.data && (
        <Card
          title={detail.data.task.title}
          actions={
            <div className="row" style={{ gap: 6 }}>
              <StatusPill status={detail.data.task.status} />
              <button className="ghost tiny" onClick={() => setSelectedId(null)} type="button">
                close
              </button>
            </div>
          }
        >
          <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
            <span className="pill">{detail.data.task.agentRole}</span>
            <span className="pill">{detail.data.task.plan.length} steps</span>
            <span className="pill">{detail.data.task.progress * 100}%</span>
            {detail.data.task.startedAt && detail.data.task.finishedAt && (
              <span className="pill">{duration(detail.data.task.finishedAt - detail.data.task.startedAt)}</span>
            )}
          </div>
          {detail.data.task.error && (
            <div className="small" style={{ marginBottom: 10 }}>
              ✖ {detail.data.task.error}
            </div>
          )}
          <ProgressBar value={detail.data.task.progress} />
          <div style={{ marginTop: 12 }}>
            {detail.data.task.plan.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} />
            ))}
          </div>

          <div className="divider" />
          <label>Tool executions</label>
          {detail.data.toolExecutions.length === 0 && <div className="small dim">No tool calls recorded.</div>}
          <table className="table">
            <tbody>
              {detail.data.toolExecutions.map((execution) => (
                <tr key={execution.id}>
                  <td className="tiny mono">{execution.toolId}</td>
                  <td className="tiny">
                    <StatusPill status={execution.status} />
                  </td>
                  <td className="tiny dim">{duration(execution.durationMs)}</td>
                  <td className="tiny dim">{execution.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
