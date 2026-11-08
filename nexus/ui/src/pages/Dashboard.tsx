/** Dashboard: real aggregates from the backend, plus live activity. */
import React from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, ProgressBar, SpinnerBlock, Stat, StatusPill, duration, relativeTime } from '../components/ui';

export function DashboardPage({ navigate }: { navigate: (page: string) => void }) {
  const { project, projects, events, health, pendingApprovals } = useStore();
  const { data, loading } = useAsync(() => api.analytics(), []);
  const tasks = useAsync(() => api.tasks({ limit: 8 }), []);
  const notifications = useAsync(() => api.notifications(), []);

  if (loading) return <SpinnerBlock />;
  const analytics = data?.analytics;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="grid cols-4">
        <Stat
          label="Tasks"
          value={analytics?.tasks.total ?? 0}
          hint={
            analytics?.tasks.successRate === null || analytics?.tasks.successRate === undefined
              ? 'no completed/failed tasks yet'
              : `${Math.round(analytics.tasks.successRate * 100)}% verified success`
          }
        />
        <Stat label="Projects" value={projects.length} hint={project ? `active: ${project.name}` : 'none selected'} />
        <Stat
          label="Snapshots"
          value={analytics?.files.snapshots ?? 0}
          hint="rollback points available"
        />
        <Stat
          label="Providers"
          value={health?.providers.length ?? 0}
          hint={health?.providers.length ? health.providers.join(', ') : 'no API key configured'}
        />
      </div>

      {pendingApprovals > 0 && (
        <Card title="Attention required">
          <div className="row between">
            <span className="small">
              {pendingApprovals} action{pendingApprovals === 1 ? '' : 's'} waiting for your approval.
            </span>
            <button className="primary" onClick={() => navigate('tasks')} type="button">
              Review
            </button>
          </div>
        </Card>
      )}

      <div className="grid cols-2">
        <Card
          title="Recent tasks"
          actions={
            <button className="ghost tiny" onClick={() => navigate('tasks')} type="button">
              all →
            </button>
          }
        >
          {tasks.loading && <div className="small dim">Loading…</div>}
          {tasks.data?.tasks.length === 0 && <Empty title="No tasks yet">Send a request in AI Chat to create one.</Empty>}
          {tasks.data?.tasks.map((task) => (
            <div key={task.id} className="row between" style={{ padding: '7px 0', borderBottom: '1px solid #1e1e1e' }}>
              <div style={{ minWidth: 0 }}>
                <div className="small ellipsis">{task.title}</div>
                <div className="tiny dim">
                  {task.agentRole} · {relativeTime(task.createdAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <div style={{ width: 60 }}>
                  <ProgressBar value={task.progress} />
                </div>
                <StatusPill status={task.status} />
              </div>
            </div>
          ))}
        </Card>

        <Card title="Live activity" actions={<span className="tiny dim">{events.length} buffered</span>}>
          {events.length === 0 && <div className="small dim">No events yet. The stream is connected and idle.</div>}
          {events.slice(0, 12).map((event) => (
            <div key={event.id} className="row" style={{ gap: 8, padding: '4px 0', alignItems: 'flex-start' }}>
              <span className="tiny mono dim nowrap" style={{ width: 74 }}>
                {new Date(event.at).toLocaleTimeString()}
              </span>
              <span className="pill outline tiny nowrap">{event.type}</span>
              <span className="tiny ellipsis">{event.message}</span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid cols-3">
        <Card title="AI usage">
          {analytics?.providers.length === 0 && <div className="small dim">No provider calls recorded yet.</div>}
          {analytics?.providers.map((provider) => (
            <div key={`${provider.provider}-${provider.modelId}`} style={{ padding: '6px 0', borderBottom: '1px solid #1e1e1e' }}>
              <div className="row between">
                <span className="small mono">{provider.provider}</span>
                <span className="tiny dim">{provider.requests} req</span>
              </div>
              <div className="tiny dim">
                {provider.modelId} · {provider.inputTokens + provider.outputTokens} tok ·{' '}
                {provider.avgLatencyMs === null ? '—' : `${provider.avgLatencyMs} ms avg`}
                {provider.failures > 0 ? ` · ${provider.failures} failed` : ''}
              </div>
            </div>
          ))}
        </Card>

        <Card title="Tool usage">
          {analytics?.tools.length === 0 && <div className="small dim">No tool calls recorded yet.</div>}
          {analytics?.tools.slice(0, 6).map((tool) => (
            <div key={tool.toolId} className="row between" style={{ padding: '4px 0' }}>
              <span className="tiny mono ellipsis">{tool.toolId}</span>
              <span className="tiny dim nowrap">
                {tool.calls}× {tool.failures > 0 ? `· ${tool.failures}✖` : ''} · {duration(tool.avgDurationMs)}
              </span>
            </div>
          ))}
        </Card>

        <Card title="Notifications">
          {notifications.data?.notifications.length === 0 && <div className="small dim">Nothing to report.</div>}
          {notifications.data?.notifications.slice(0, 6).map((notification) => (
            <div key={notification.id} style={{ padding: '5px 0' }}>
              <div className="small">
                {notification.read ? '' : '• '}
                {notification.title}
              </div>
              <div className="tiny dim ellipsis">{notification.body}</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
