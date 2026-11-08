/** Browser automation: real sessions through Playwright, or an honest "unavailable" state. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, Spinner, StatusPill } from '../components/ui';

export function BrowserPage() {
  const { toast } = useStore();
  const status = useAsync(() => api.browserStatus(), []);
  const sessions = useAsync(() => api.browserSessions(), []);
  const [url, setUrl] = useState('http://localhost:5173');
  const [selector, setSelector] = useState('');
  const [value, setValue] = useState('');
  const [log, setLog] = useState<{ kind: 'in' | 'out' | 'err'; text: string }[]>([]);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const push = (kind: 'in' | 'out' | 'err', text: string) => setLog((current) => [...current, { kind, text }]);

  const open = async () => {
    setBusy(true);
    try {
      const { session } = await api.openBrowser(true);
      setActiveSession(session.id);
      sessions.reload();
      push('out', `session ${session.id} opened (headless=${session.headless})`);
    } catch (err) {
      push('err', (err as Error).message);
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!activeSession) {
      toast('Open a session first', 'error');
      return;
    }
    setBusy(true);
    push('in', `${action} ${JSON.stringify(extra)}`);
    try {
      const result = await api.browserAction({ sessionId: activeSession, action, ...extra });
      push('out', result.detail);
    } catch (err) {
      push('err', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const available = status.data?.available ?? false;

  return (
    <div className="col" style={{ gap: 14 }}>
      {!status.loading && !available && (
        <Card title="Browser automation unavailable">
          <div className="small">
            <strong>{status.data?.reason}</strong>
          </div>
          <div className="small muted mt">
            The browser tool layer is fully implemented; it needs a Chromium build to drive. On a desktop install run:
          </div>
          <pre className="pre small mt" style={{ background: '#0b0b0b', border: '1px solid var(--border)', padding: 10, borderRadius: 5 }}>
            npx playwright install chromium
          </pre>
          <div className="tiny dim mt">
            Driver in use: <span className="mono">{status.data?.driver}</span>. Actions are still routed through the same
            approval and audit path, so nothing changes once a browser is present.
          </div>
        </Card>
      )}

      <div className="grid cols-2">
        <Card title="Session">
          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <button className="primary" onClick={() => void open()} disabled={busy || !available} type="button">
              {busy ? 'opening…' : 'open session'}
            </button>
            <button
              onClick={async () => {
                if (!activeSession) return;
                await api.closeBrowser(activeSession);
                setActiveSession(null);
                sessions.reload();
              }}
              disabled={!activeSession}
              type="button"
            >
              close
            </button>
            {activeSession && <span className="pill solid tiny">{activeSession.slice(0, 8)}</span>}
          </div>
          <label>URL</label>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" />
          <div className="row mt" style={{ gap: 6 }}>
            <button onClick={() => void act('goto', { url })} disabled={!activeSession || busy} type="button">
              navigate
            </button>
            <button onClick={() => void act('screenshot', { name: 'manual' })} disabled={!activeSession || busy} type="button">
              screenshot
            </button>
            <button onClick={() => void act('errors')} disabled={!activeSession || busy} type="button">
              console errors
            </button>
            <button onClick={() => void act('text')} disabled={!activeSession || busy} type="button">
              page text
            </button>
          </div>

          <div className="divider" />
          <label>Selector</label>
          <input value={selector} onChange={(event) => setSelector(event.target.value)} placeholder="button[type=submit]" />
          <label className="mt">Value</label>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="text to type" />
          <div className="row mt" style={{ gap: 6 }}>
            <button onClick={() => void act('click', { selector })} disabled={!activeSession || busy} type="button">
              click
            </button>
            <button onClick={() => void act('fill', { selector, value })} disabled={!activeSession || busy} type="button">
              fill
            </button>
            <button onClick={() => void act('wait', { selector })} disabled={!activeSession || busy} type="button">
              wait for
            </button>
          </div>
        </Card>

        <Card title="Sessions">
          {sessions.loading && <Spinner />}
          {(sessions.data?.sessions.length ?? 0) === 0 && <Empty title="No open sessions" />}
          {sessions.data?.sessions.map((session) => (
            <div key={session.id} className="list-item" onClick={() => setActiveSession(session.id)}>
              <div className="row between">
                <span className="tiny mono">{session.id.slice(0, 12)}</span>
                <StatusPill status={activeSession === session.id ? 'running' : 'pending'} />
              </div>
              <div className="tiny dim ellipsis">{session.url}</div>
            </div>
          ))}
        </Card>
      </div>

      <Card title="Action log">
        {log.length === 0 && <div className="small dim">Actions appear here with their results.</div>}
        <pre className="pre small" style={{ maxHeight: 320, overflow: 'auto' }}>
          {log.map((entry, index) => (
            <div key={index} style={{ color: entry.kind === 'err' ? '#d8b8b8' : entry.kind === 'in' ? '#fff' : '#a0a0a0' }}>
              {entry.kind === 'in' ? '> ' : entry.kind === 'err' ? '✖ ' : '  '}
              {entry.text}
            </div>
          ))}
        </pre>
      </Card>
    </div>
  );
}
