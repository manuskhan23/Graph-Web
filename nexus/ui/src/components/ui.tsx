/** Reusable design-system primitives. Every page composes these. */
import React from 'react';
import type { RiskLevel, StepStatus, TaskStatus } from '../types';

export function Card({
  title,
  actions,
  children,
  className = '',
}: {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="row between" style={{ marginBottom: 10 }}>
          {title ? <h3 className="card-title" style={{ margin: 0 }}>{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <div className="small muted">{children}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="row" style={{ gap: 7 }}>
      <span className="spinner" />
      {label && <span className="small muted">{label}</span>}
    </span>
  );
}

export function SpinnerBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row" style={{ padding: 20, justifyContent: 'center' }}>
      <Spinner label={label} />
    </div>
  );
}

const RISK_CLASS: Record<RiskLevel, string> = { low: 'outline', medium: '', high: 'solid' };
export function RiskPill({ risk }: { risk: RiskLevel }) {
  return <span className={`pill ${RISK_CLASS[risk]}`}>{risk}</span>;
}

const STATUS_CLASS: Record<string, string> = {
  completed: 'solid',
  running: '',
  failed: 'outline',
  pending: 'outline',
  skipped: 'outline',
  cancelled: 'outline',
};
export function StatusPill({ status }: { status: TaskStatus | StepStatus | string }) {
  return <span className={`pill ${STATUS_CLASS[status] ?? ''}`}>{status.replace(/_/g, ' ')}</span>;
}

export const STEP_ICON: Record<StepStatus, string> = {
  pending: '○',
  running: '◐',
  completed: '✔',
  failed: '✖',
  skipped: '⤼',
};

export function StepRow({ step, index }: { step: { id: string; title: string; detail: string; toolId: string | null; status: StepStatus; result: string | null; error: string | null; verifyWith: string | null; attempts: number }; index: number }) {
  return (
    <div className={`step ${step.status}`}>
      <div className="step-head">
        <span className="step-icon">{STEP_ICON[step.status]}</span>
        <span className="step-title">
          {index + 1}. {step.title}
        </span>
        <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
          {step.toolId && <span className="pill outline">{step.toolId}</span>}
          {step.attempts > 1 && <span className="pill">retry {step.attempts}</span>}
          <StatusPill status={step.status} />
        </span>
      </div>
      {step.detail && <div className="step-detail">{step.detail}</div>}
      {step.result && <div className="step-detail mono tiny">→ {step.result}</div>}
      {step.error && <div className="step-detail mono tiny">✖ {step.error}</div>}
      {step.verifyWith && <div className="step-detail dim tiny">verify: {step.verifyWith}</div>}
    </div>
  );
}

export function ProgressBar({ value }: { value: number }) {
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label>{label}</label>
      {children}
      {hint && <div className="tiny dim" style={{ marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <div className="row between" style={{ padding: '6px 0' }}>
      <span className="small">{label}</span>
      <button
        className={checked ? 'primary tiny' : 'tiny'}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        type="button"
      >
        {checked ? 'on' : 'off'}
      </button>
    </div>
  );
}

export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '—';
  const delta = Date.now() - timestamp;
  if (delta < 45_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function DiffView({ diff }: { diff: { relPath: string; additions: number; deletions: number; lines: { type: string; text: string; oldLine: number | null; newLine: number | null }[] } }) {
  return (
    <div className="diff">
      <div className="diff-head mono tiny">
        <span>{diff.relPath}</span>
        <span>
          +{diff.additions} −{diff.deletions}
        </span>
      </div>
      <div className="diff-body">
        {diff.lines.map((line, index) => {
          if (line.type === 'context' && line.text.startsWith('@@')) {
            return (
              <div className="diff-hunk" key={index}>
                {line.text}
              </div>
            );
          }
          return (
            <div className={`diff-line ${line.type === 'add' ? 'add' : line.type === 'del' ? 'del' : 'ctx'}`} key={index}>
              <span className="ln">{line.oldLine ?? ''}</span>
              <span className="ln">{line.newLine ?? ''}</span>
              <span className="tx">
                {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
                {line.text}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (id: T) => void }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`tab ${tab.id === value ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
          type="button"
        >
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && <span className="tiny mono" style={{ marginLeft: 5 }}>({tab.badge})</span>}
        </button>
      ))}
    </div>
  );
}
