/** Terminal: run commands with streaming output, manage owned processes. */
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, StatusPill } from '../components/ui';

interface Line {
  kind: 'cmd' | 'out' | 'err' | 'info';
  text: string;
}

export function TerminalPage() {
  const { project, projectId, toast, events } = useStore();
  const [lines, setLines] = useState<Line[]>([
    { kind: 'info', text: 'NEXUS terminal — commands run inside the selected project root.' },
    { kind: 'info', text: 'Destructive commands require approval; some are blocked by policy.' },
  ]);
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);
  const [showProcesses, setShowProcesses] = useState(true);
  const processes = useAsync(() => api.processes(), []);
  const outputRef = useRef<HTMLDivElement>(null);

  // Stream process output from the global event bus.
  useEffect(() => {
    const latest = events.find((event) => event.type === 'process.output');
    if (!latest) return;
    const chunk = String(latest.message ?? '');
    if (!chunk) return;
    setLines((current) => {
      const last = current[current.length - 1];
      if (last && last.kind === 'out') {
        return [...current.slice(0, -1), { kind: 'out', text: `${last.text}${chunk}` }];
      }
      return [...current, { kind: 'out', text: chunk }];
    });
  }, [events]);

  useEffect(() => {
    const node = outputRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lines]);

  const run = async () => {
    if (!projectId || !command.trim() || busy) return;
    const cmd = command.trim();
    setCommand('');
    setBusy(true);
    setLines((current) => [...current, { kind: 'cmd', text: `$ ${cmd}` }]);
    try {
      const result = await api.runCommand(projectId, cmd);
      if (result.stdout.trim()) setLines((current) => [...current, { kind: 'out', text: result.stdout }]);
      if (result.stderr.trim()) setLines((current) => [...current, { kind: 'err', text: result.stderr }]);
      setLines((current) => [
        ...current,
        {
          kind: result.exitCode === 0 ? 'info' : 'err',
          text: `exit ${result.exitCode ?? 'null'}${result.timedOut ? ' (timed out)' : ''} · ${result.durationMs} ms`,
        },
      ]);
    } catch (err) {
      const apiError = err as ApiError;
      setLines((current) => [...current, { kind: 'err', text: `[${apiError.code}] ${apiError.message}` }]);
      toast(apiError.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const startProcess = async () => {
    if (!projectId || !command.trim()) return;
    try {
      const { process: started } = await api.startProcess(projectId, command.trim());
      setLines((current) => [...current, { kind: 'info', text: `process ${started.id} running (pid ${started.pid})` }]);
      setCommand('');
      processes.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const stop = async (id: string) => {
    try {
      await api.stopProcess(id);
      processes.reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (!projectId) return <Empty title="No project selected">Commands run inside a project directory. Register one first.</Empty>;

  return (
    <div className="split" style={{ gridTemplateColumns: showProcesses ? '1fr 300px' : '1fr' }}>
      <div className="term">
        <div className="topbar" style={{ height: 36 }}>
          <span className="tiny mono ellipsis">{project?.rootPath}</span>
          <span className="spacer" />
          <button className="ghost tiny" onClick={() => setLines([])} type="button">
            clear
          </button>
          <button className="ghost tiny" onClick={() => setShowProcesses((v) => !v)} type="button">
            {showProcesses ? 'hide' : 'show'} processes
          </button>
        </div>
        <div className="term-output" ref={outputRef}>
          {lines.map((line, index) => (
            <div className={`term-line ${line.kind}`} key={index}>
              {line.kind === 'cmd' ? <span>{line.text}</span> : <span className="prompt"> </span>}
              {line.kind !== 'cmd' && <span style={{ whiteSpace: 'pre-wrap' }}>{line.text}</span>}
            </div>
          ))}
          {busy && <div className="term-line info">
            <span className="prompt"> </span>
            <span className="dim">running…</span>
          </div>}
        </div>
        <div className="term-input-row">
          <span className="prompt-sign">$</span>
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void run()}
            placeholder="npm run build"
            disabled={busy}
            style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
          />
          <button className="primary" onClick={() => void run()} disabled={busy} type="button">
            Run
          </button>
          <button onClick={() => void startProcess()} title="Run as a long-lived managed process" type="button">
            Start
          </button>
        </div>
      </div>

      {showProcesses && (
        <aside className="split-side" style={{ borderLeft: '1px solid var(--border)', borderRight: 'none' }}>
          <div className="row between" style={{ padding: '10px 12px' }}>
            <span className="tiny dim">managed processes</span>
            <button className="ghost tiny" onClick={() => processes.reload()} type="button">
              refresh
            </button>
          </div>
          {(processes.data?.processes.length ?? 0) === 0 && <div className="small dim" style={{ padding: 12 }}>Nothing running.</div>}
          {processes.data?.processes.map((process) => (
            <div key={process.id} className="list-item">
              <div className="row between">
                <span className="tiny mono ellipsis">{process.command}</span>
                <StatusPill status={process.status === 'running' ? 'running' : process.status === 'failed' ? 'failed' : 'completed'} />
              </div>
              <div className="tiny dim">
                pid {process.pid ?? '—'} · exit {process.exitCode ?? '—'}
              </div>
              <div className="row" style={{ gap: 4, marginTop: 4 }}>
                {process.status === 'running' && (
                  <button className="tiny danger" onClick={() => void stop(process.id)} type="button">
                    stop
                  </button>
                )}
                <button
                  className="tiny"
                  onClick={async () => {
                    try {
                      const detail = await api.processDetail(process.id);
                      setLines((current) => [
                        ...current,
                        { kind: 'info', text: `--- output of ${process.id} ---` },
                        { kind: 'out', text: detail.output.stdout || '(no stdout)' },
                        ...(detail.output.stderr ? [{ kind: 'err' as const, text: detail.output.stderr }] : []),
                      ]);
                    } catch (err) {
                      toast((err as Error).message, 'error');
                    }
                  }}
                  type="button"
                >
                  output
                </button>
              </div>
            </div>
          ))}
          <Card title="Common commands" className="mt" >
            {['npm install', 'npm run build', 'npm test', 'npm run dev', 'git status'].map((cmd) => (
              <button key={cmd} className="ghost tiny" style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 3 }} onClick={() => setCommand(cmd)} type="button">
                {cmd}
              </button>
            ))}
          </Card>
        </aside>
      )}
    </div>
  );
}
