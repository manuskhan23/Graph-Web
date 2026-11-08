/**
 * Application shell: sidebar navigation across the 13 surfaces, a topbar with
 * project + connection state, and the active page.
 */
import React, { useEffect, useState } from 'react';
import { StoreProvider, useStore } from './lib/store';
import { ErrorBoundary } from './components/ErrorBoundary';
import { DashboardPage } from './pages/Dashboard';
import { ChatPage } from './pages/Chat';
import { ProjectsPage, CodebasePage } from './pages/Projects';
import { TasksPage } from './pages/Tasks';
import { TerminalPage } from './pages/Terminal';
import { BrowserPage } from './pages/Browser';
import { AgentsPage } from './pages/Agents';
import { WorkflowsPage } from './pages/Workflows';
import { MemoryPage } from './pages/Memory';
import { AnalyticsPage, ActivityPage } from './pages/Insights';
import { SettingsPage } from './pages/Settings';

type PageId =
  | 'dashboard'
  | 'chat'
  | 'projects'
  | 'codebase'
  | 'tasks'
  | 'terminal'
  | 'browser'
  | 'agents'
  | 'workflows'
  | 'memory'
  | 'analytics'
  | 'activity'
  | 'settings';

const NAV: { group: string; items: { id: PageId; label: string; glyph: string }[] }[] = [
  {
    group: 'Workspace',
    items: [
      { id: 'dashboard', label: 'Dashboard', glyph: '▦' },
      { id: 'chat', label: 'AI Chat', glyph: '◇' },
      { id: 'projects', label: 'Projects', glyph: '▤' },
      { id: 'codebase', label: 'Codebase', glyph: '{ }' },
      { id: 'tasks', label: 'Tasks', glyph: '◈' },
    ],
  },
  {
    group: 'Execution',
    items: [
      { id: 'terminal', label: 'Terminal', glyph: '›_' },
      { id: 'browser', label: 'Browser', glyph: '◱' },
      { id: 'agents', label: 'Agents', glyph: '◍' },
      { id: 'workflows', label: 'Workflows', glyph: '⇉' },
    ],
  },
  {
    group: 'Knowledge',
    items: [
      { id: 'memory', label: 'Memory', glyph: '❖' },
      { id: 'analytics', label: 'Analytics', glyph: '◔' },
      { id: 'activity', label: 'Activity', glyph: '≡' },
      { id: 'settings', label: 'Settings', glyph: '⚙' },
    ],
  },
];

const TITLES: Record<PageId, { title: string; subtitle: string }> = {
  dashboard: { title: 'Dashboard', subtitle: 'System-wide state at a glance' },
  chat: { title: 'AI Chat', subtitle: 'Describe an outcome — the agent plans, verifies, reports' },
  projects: { title: 'Projects', subtitle: 'Register codebases and inspect the static analysis' },
  codebase: { title: 'Codebase Explorer', subtitle: 'Browse the index and search source' },
  tasks: { title: 'Tasks', subtitle: 'Plans, steps, tool calls and approvals' },
  terminal: { title: 'Terminal', subtitle: 'Validated command execution inside the project root' },
  browser: { title: 'Browser', subtitle: 'Playwright automation with screenshot evidence' },
  agents: { title: 'Agents', subtitle: 'Role definitions, tool allow-lists and file leases' },
  workflows: { title: 'Workflows', subtitle: 'Composable multi-block automations' },
  memory: { title: 'Memory', subtitle: 'Persistent knowledge carried across conversations' },
  analytics: { title: 'Analytics', subtitle: 'Real aggregates — no synthetic numbers' },
  activity: { title: 'Activity', subtitle: 'Audit trail and live event stream' },
  settings: { title: 'Settings', subtitle: 'Providers, limits, approvals and privacy' },
};

function Shell() {
  const { projects, projectId, setProjectId, connected, pendingApprovals, health, toasts, settings } = useStore();
  const [page, setPage] = useState<PageId>(() => (window.location.hash.replace('#', '') as PageId) || 'dashboard');

  useEffect(() => {
    const onHash = () => setPage((window.location.hash.replace('#', '') as PageId) || 'dashboard');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = next;
    setPage(next as PageId);
  };

  const meta = TITLES[page] ?? TITLES.dashboard;
  const noProjectPages: PageId[] = ['tasks', 'terminal', 'codebase'];
  const needsProject = noProjectPages.includes(page) && !projectId;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">N</span>
          <span>
            <span className="brand-text">NEXUS</span>
            <br />
            <span className="brand-sub">AI agent</span>
          </span>
        </div>

        <nav className="nav">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="nav-label">{group.group}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item ${page === item.id ? 'active' : ''}`}
                  onClick={() => navigate(item.id)}
                  type="button"
                >
                  <span className="nav-icon">{item.glyph}</span>
                  <span>{item.label}</span>
                  {item.id === 'tasks' && pendingApprovals > 0 && <span className="nav-badge">{pendingApprovals}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="row between">
            <span className="tiny dim">backend</span>
            <span className="row" style={{ gap: 5 }}>
              <span className={`status-dot ${connected ? '' : 'off'}`} />
              <span className="tiny">{connected ? 'live' : 'offline'}</span>
            </span>
          </div>
          <div className="row between">
            <span className="tiny dim">schema v{health?.database.version ?? '?'}</span>
            <span className="tiny dim">{health?.providers.length ?? 0} providers</span>
          </div>
          {window.nexus && (
            <div className="row between" style={{ marginTop: 4 }}>
              <span className="tiny dim">window</span>
              <span className="row" style={{ gap: 4 }}>
                <button className="ghost tiny" onClick={() => void window.nexus?.window.minimize()} type="button">
                  –
                </button>
                <button className="ghost tiny" onClick={() => void window.nexus?.window.toggleMaximize()} type="button">
                  ▢
                </button>
                <button className="ghost tiny" onClick={() => void window.nexus?.window.close()} type="button">
                  ×
                </button>
              </span>
            </div>
          )}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div style={{ minWidth: 0 }}>
            <h1>{meta.title}</h1>
            <div className="topbar-sub ellipsis">{meta.subtitle}</div>
          </div>
          <span className="spacer" />
          <select
            value={projectId ?? ''}
            onChange={(event) => setProjectId(event.target.value || null)}
            style={{ width: 200, fontSize: 11.5, padding: '5px 8px' }}
            title="Active project — scopes code context, terminal and search"
          >
            <option value="">no project</option>
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.fileCount})
              </option>
            ))}
          </select>
          <button className="ghost tiny" onClick={() => navigate('settings')} type="button" title="Settings">
            ⚙
          </button>
          <span className="topbar-chip">{settings?.settings.ai.defaultProvider ?? 'gemini'}</span>
        </header>

        <div className="content">
          {needsProject ? (
            <div className="empty">
              <h3>No project selected</h3>
              <div className="small muted">This surface scopes to a project. Register or pick one first.</div>
              <div style={{ marginTop: 12 }}>
                <button className="primary" onClick={() => navigate('projects')} type="button">
                  Go to Projects
                </button>
              </div>
            </div>
          ) : (
            <ErrorBoundary resetKey={page}>
              {page === 'dashboard' && <DashboardPage navigate={navigate} />}
              {page === 'chat' && <ChatPage />}
              {page === 'projects' && <ProjectsPage navigate={navigate} />}
              {page === 'codebase' && <CodebasePage />}
              {page === 'tasks' && <TasksPage />}
              {page === 'terminal' && <TerminalPage />}
              {page === 'browser' && <BrowserPage />}
              {page === 'agents' && <AgentsPage />}
              {page === 'workflows' && <WorkflowsPage />}
              {page === 'memory' && <MemoryPage />}
              {page === 'analytics' && <AnalyticsPage />}
              {page === 'activity' && <ActivityPage />}
              {page === 'settings' && <SettingsPage />}
            </ErrorBoundary>
          )}
        </div>
      </main>

      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.level}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
