/** Analytics + Activity — every number is a SQL aggregate from real rows. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, SpinnerBlock, Stat, StatusPill, duration, relativeTime } from '../components/ui';

export function AnalyticsPage() {
  const { reloadKey } = useStore();
  const { data, loading } = useAsync(() => api.analytics(), [reloadKey]);
  if (loading) return <SpinnerBlock />;
  const analytics = data?.analytics;

  const totalTokens = analytics?.providers.reduce((sum, p) => sum + p.inputTokens + p.outputTokens, 0) ?? 0;
  const cost = analytics?.providers.reduce((sum, p) => sum + (p.estimatedCostUsd ?? 0), 0) ?? 0;
  const hasCost = analytics?.providers.some((p) => p.estimatedCostUsd !== null) ?? false;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid cols-4">
        <Stat label="Total tasks" value={analytics?.tasks.total ?? 0} />
        <Stat
          label="Success rate"
          value={analytics?.tasks.successRate === null ? '—' : `${Math.round((analytics?.tasks.successRate ?? 0) * 100)}%`}
          hint={analytics?.tasks.successRate === null ? 'needs a completed or failed task' : 'completed / (completed + failed)'}
        />
        <Stat label="Avg duration" value={duration(analytics?.tasks.avgDurationMs ?? null)} />
        <Stat label="Tokens used" value={totalTokens.toLocaleString()} hint={hasCost ? `≈ $${cost.toFixed(4)} estimated` : 'no pricing data'} />
      </div>

      <div className="grid cols-2">
        <Card title="Task breakdown">
          {Object.keys(analytics?.tasks.byStatus ?? {}).length === 0 && <div className="small dim">No tasks recorded.</div>}
          {Object.entries(analytics?.tasks.byStatus ?? {}).map(([status, count]) => (
            <div key={status} className="row between" style={{ padding: '4px 0' }}>
              <StatusPill status={status} />
              <span className="small mono">{count}</span>
            </div>
          ))}
        </Card>

        <Card title="Provider usage">
          <div className="tiny dim" style={{ marginBottom: 6 }}>
            Token counts are labelled by source: provider-reported vs locally estimated.
          </div>
          {(analytics?.providers.length ?? 0) === 0 && <div className="small dim">No AI calls yet.</div>}
          <table className="table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>Req</th>
                <th>Fail</th>
                <th>Tokens</th>
                <th>Latency</th>
              </tr>
            </thead>
            <tbody>
              {analytics?.providers.map((provider) => (
                <tr key={`${provider.provider}-${provider.modelId}`}>
                  <td className="tiny mono">{provider.provider}</td>
                  <td className="tiny mono" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {provider.modelId}
                  </td>
                  <td className="tiny">{provider.requests}</td>
                  <td className="tiny">{provider.failures}</td>
                  <td className="tiny">{(provider.inputTokens + provider.outputTokens).toLocaleString()}</td>
                  <td className="tiny dim">{provider.avgLatencyMs === null ? '—' : `${provider.avgLatencyMs} ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Tool usage">
          {(analytics?.tools.length ?? 0) === 0 && <div className="small dim">No tool calls recorded.</div>}
          {analytics?.tools.map((tool) => (
            <div key={tool.toolId} className="row between" style={{ padding: '4px 0' }}>
              <span className="tiny mono ellipsis">{tool.toolId}</span>
              <span className="tiny dim nowrap">
                {tool.calls} calls {tool.failures > 0 ? `· ${tool.failures} failed` : ''} · {duration(tool.avgDurationMs)}
              </span>
            </div>
          ))}
        </Card>

        <Card title="System">
          <div className="row between" style={{ padding: '4px 0' }}>
            <span className="small">File edit operations</span>
            <span className="mono small">{analytics?.files.modified ?? 0}</span>
          </div>
          <div className="row between" style={{ padding: '4px 0' }}>
            <span className="small">Rollback snapshots</span>
            <span className="mono small">{analytics?.files.snapshots ?? 0}</span>
          </div>
          <div className="row between" style={{ padding: '4px 0' }}>
            <span className="small">Workflow executions</span>
            <span className="mono small">
              {analytics?.workflows.executions ?? 0} ({analytics?.workflows.completed ?? 0} completed)
            </span>
          </div>
          <div className="divider" />
          <div className="tiny dim">Generated {relativeTime(analytics?.generatedAt)}</div>
        </Card>
      </div>

      <Card title="Background jobs">
        {(data?.jobs.length ?? 0) === 0 && <div className="small dim">No jobs.</div>}
        {data?.jobs.map((job) => (
          <div key={job.id} className="row between" style={{ padding: '4px 0' }}>
            <span className="tiny mono">{job.kind}</span>
            <span className="tiny dim ellipsis" style={{ maxWidth: 420 }}>
              {job.message}
            </span>
            <StatusPill status={job.status} />
          </div>
        ))}
      </Card>
    </div>
  );
}

export function ActivityPage() {
  const { events, connected, reloadKey } = useStore();
  const [kind, setKind] = useState('');
  const [level, setLevel] = useState('');
  const activity = useAsync(() => api.activity({ kind: kind || undefined, level: level || undefined, limit: 200 }), [kind, level, reloadKey]);
  const audit = useAsync(() => api.auditLog(), [reloadKey]);

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card
        title={`Audit & activity ${connected ? '· live' : '· reconnecting'}`}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <select value={kind} onChange={(event) => setKind(event.target.value)} style={{ width: 130, fontSize: 11, padding: '3px 6px' }}>
              <option value="">all kinds</option>
              {['task', 'tool', 'workflow', 'process', 'browser', 'provider', 'system'].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <select value={level} onChange={(event) => setLevel(event.target.value)} style={{ width: 110, fontSize: 11, padding: '3px 6px' }}>
              <option value="">all levels</option>
              {['info', 'warn', 'error'].map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {activity.loading && <SpinnerBlock />}
        {activity.data?.activity.length === 0 && <Empty title="No recorded activity">Operations are logged here as they happen.</Empty>}
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Kind</th>
              <th>Level</th>
              <th>Title</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {activity.data?.activity.map((entry) => (
              <tr key={entry.id}>
                <td className="tiny dim nowrap">{new Date(entry.at).toLocaleTimeString()}</td>
                <td className="tiny mono">{entry.kind}</td>
                <td>
                  <span className={`pill tiny ${entry.level === 'error' ? 'solid' : entry.level === 'warn' ? '' : 'outline'}`}>{entry.level}</span>
                </td>
                <td className="small">{entry.title}</td>
                <td className="tiny dim" style={{ maxWidth: 460 }}>
                  {entry.detail}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid cols-2">
        <Card title="Live event stream">
          {events.length === 0 && <div className="small dim">Waiting for events…</div>}
          {events.slice(0, 40).map((event) => (
            <div key={event.id} className="row" style={{ gap: 6, padding: '2px 0', alignItems: 'flex-start' }}>
              <span className="tiny mono dim nowrap">{new Date(event.at).toLocaleTimeString()}</span>
              <span className="pill outline tiny nowrap">{event.type}</span>
              <span className="tiny ellipsis">{event.message}</span>
            </div>
          ))}
        </Card>

        <Card title="Security audit log">
          <div className="tiny dim" style={{ marginBottom: 6 }}>
            Every tool call and permission decision is recorded, allowed or denied.
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Allowed</th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.audit ?? []).slice(0, 30).map((entry, index) => (
                <tr key={index}>
                  <td className="tiny dim nowrap">{new Date(Number(entry.at)).toLocaleTimeString()}</td>
                  <td className="tiny mono">{String(entry.actor)}</td>
                  <td className="tiny mono">{String(entry.action)}</td>
                  <td className="tiny">{Number(entry.allowed) === 1 ? '✔' : '✖'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
