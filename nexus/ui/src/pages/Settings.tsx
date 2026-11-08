/** Settings & control centre: providers, agent limits, approvals, app prefs. */
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Card, Empty, Field, SpinnerBlock, Toggle } from '../components/ui';
import type { AppSettings, ProviderId, ProviderStatus } from '../types';

export function SettingsPage() {
  const { settings, refreshSettings, toast } = useStore();
  const [draft, setDraft] = useState<AppSettings | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[] | null>(null);
  const [keyInput, setKeyInput] = useState<Record<ProviderId, string>>({ gemini: '', groq: '' });
  const [keyStatus, setKeyStatus] = useState<{ encryptionAvailable: boolean; gemini: boolean; groq: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings && !draft) setDraft(settings.settings);
  }, [settings, draft]);

  useEffect(() => {
    api.providers().then(({ providers: list }) => setProviders(list)).catch(() => setProviders(null));
    if (window.nexus) window.nexus.getKeyStatus().then(setKeyStatus).catch(() => undefined);
  }, []);

  if (!settings || !draft) return <SpinnerBlock />;

  const update = (updater: (current: AppSettings) => AppSettings) => setDraft((current) => (current ? updater(current) : current));

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.updateSettings(draft);
      await refreshSettings();
      toast('Settings saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveKey = async (provider: ProviderId) => {
    const key = keyInput[provider].trim();
    if (!key) return;
    try {
      if (window.nexus) {
        // Desktop: the OS keychain holds the secret; the backend reads it from env.
        await window.nexus.setApiKey(provider, key);
        setKeyStatus(await window.nexus.getKeyStatus());
        setKeyInput((current) => ({ ...current, [provider]: '' }));
        toast('Stored in the OS keychain — restart the app to activate it');
        return;
      }
      await api.setApiKey(provider, key);
      await refreshSettings();
      setKeyInput((current) => ({ ...current, [provider]: '' }));
      toast(`${provider} key saved`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const clearKey = async (provider: ProviderId) => {
    try {
      if (window.nexus) {
        await window.nexus.clearApiKey(provider);
        setKeyStatus(await window.nexus.getKeyStatus());
      } else {
        await api.clearApiKey(provider);
        await refreshSettings();
      }
      toast(`${provider} key cleared`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="AI providers" actions={<button className="primary tiny" onClick={() => void save()} disabled={saving} type="button">{saving ? 'saving…' : 'save all settings'}</button>}>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Only Google Gemini and Groq are supported. Keys are stored server-side (or in the OS keychain on desktop) and are
          never returned to this interface — only a masked fingerprint.
        </div>
        <div className="grid cols-2">
          {(['gemini', 'groq'] as ProviderId[]).map((provider) => {
            const state = settings.keys[provider];
            const info = providers?.find((entry) => entry.provider === provider);
            return (
              <div key={provider} className="card" style={{ margin: 0 }}>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <strong className="small" style={{ textTransform: 'capitalize' }}>
                    {provider}
                  </strong>
                  <span className={`pill ${state.configured ? 'solid' : 'outline'}`}>
                    {state.configured ? 'configured' : 'not configured'}
                  </span>
                </div>
                <div className="tiny dim mono" style={{ marginBottom: 8 }}>
                  {state.masked ?? 'no key'} {state.source !== 'none' ? `· ${state.source}` : ''}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    type="password"
                    value={keyInput[provider]}
                    onChange={(event) => setKeyInput((current) => ({ ...current, [provider]: event.target.value }))}
                    placeholder={provider === 'gemini' ? 'AIza…' : 'gsk_…'}
                    style={{ fontSize: 12 }}
                  />
                  <button className="tiny" onClick={() => void saveKey(provider)} disabled={!keyInput[provider].trim()} type="button">
                    save
                  </button>
                  {state.configured && (
                    <button className="tiny danger" onClick={() => void clearKey(provider)} type="button">
                      clear
                    </button>
                  )}
                </div>
                <div className="tiny dim mt">
                  {info?.models.length ?? 0} models · last error: {info?.lastError ?? 'none'}
                </div>
                {keyStatus && !keyStatus.encryptionAvailable && (
                  <div className="tiny dim mt">OS keychain unavailable — keys fall back to an encrypted file store.</div>
                )}
              </div>
            );
          })}
        </div>

        <div className="grid cols-3 mt">
          <Field label="Default provider">
            <select
              value={draft.ai.defaultProvider}
              onChange={(event) => update((current) => ({ ...current, ai: { ...current.ai, defaultProvider: event.target.value as ProviderId } }))}
            >
              <option value="gemini">gemini</option>
              <option value="groq">groq</option>
            </select>
          </Field>
          <Field label="Gemini model">
            <select
              value={draft.ai.geminiModel}
              onChange={(event) => update((current) => ({ ...current, ai: { ...current.ai, geminiModel: event.target.value } }))}
            >
              {(providers?.find((p) => p.provider === 'gemini')?.models ?? []).map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Groq model">
            <select
              value={draft.ai.groqModel}
              onChange={(event) => update((current) => ({ ...current, ai: { ...current.ai, groqModel: event.target.value } }))}
            >
              {(providers?.find((p) => p.provider === 'groq')?.models ?? []).map((model) => (
                <option key={model.modelId} value={model.modelId}>
                  {model.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Temperature">
            <input
              type="number"
              step="0.1"
              min="0"
              max="2"
              value={draft.ai.temperature}
              onChange={(event) => update((current) => ({ ...current, ai: { ...current.ai, temperature: Number(event.target.value) } }))}
            />
          </Field>
          <Field label="Max output tokens">
            <input
              type="number"
              min="64"
              max="32768"
              value={draft.ai.maxOutputTokens}
              onChange={(event) => update((current) => ({ ...current, ai: { ...current.ai, maxOutputTokens: Number(event.target.value) } }))}
            />
          </Field>
          <div>
            <label>Fallback</label>
            <Toggle
              label="Allow cross-provider fallback"
              checked={draft.ai.allowCrossProviderFallback}
              onChange={(value) => update((current) => ({ ...current, ai: { ...current.ai, allowCrossProviderFallback: value } }))}
            />
          </div>
        </div>
      </Card>

      <Card title="Agent execution limits">
        <div className="grid cols-3">
          <Field label="Max tool calls / task" hint="Hard stop; the run fails rather than looping">
            <input
              type="number"
              min="1"
              max="200"
              value={draft.agent.maxToolCalls}
              onChange={(event) => update((current) => ({ ...current, agent: { ...current.agent, maxToolCalls: Number(event.target.value) } }))}
            />
          </Field>
          <Field label="Max duration (ms)">
            <input
              type="number"
              min="5000"
              step="1000"
              value={draft.agent.maxDurationMs}
              onChange={(event) => update((current) => ({ ...current, agent: { ...current.agent, maxDurationMs: Number(event.target.value) } }))}
            />
          </Field>
          <Field label="Retries per step">
            <input
              type="number"
              min="0"
              max="10"
              value={draft.agent.maxRetriesPerStep}
              onChange={(event) => update((current) => ({ ...current, agent: { ...current.agent, maxRetriesPerStep: Number(event.target.value) } }))}
            />
          </Field>
          <Field label="Max context tokens">
            <input
              type="number"
              min="1000"
              step="1000"
              value={draft.agent.maxContextTokens}
              onChange={(event) => update((current) => ({ ...current, agent: { ...current.agent, maxContextTokens: Number(event.target.value) } }))}
            />
          </Field>
          <Field label="Max concurrent tasks">
            <input
              type="number"
              min="1"
              max="8"
              value={draft.agent.maxConcurrentTasks}
              onChange={(event) => update((current) => ({ ...current, agent: { ...current.agent, maxConcurrentTasks: Number(event.target.value) } }))}
            />
          </Field>
          <div>
            <label>Approvals</label>
            <Toggle
              label="Require approval for medium risk"
              checked={draft.agent.requireApprovalFor.medium}
              onChange={(value) =>
                update((current) => ({ ...current, agent: { ...current.agent, requireApprovalFor: { ...current.agent.requireApprovalFor, medium: value } } }))
              }
            />
            <Toggle
              label="Require approval for high risk"
              checked={draft.agent.requireApprovalFor.high}
              onChange={(value) =>
                update((current) => ({ ...current, agent: { ...current.agent, requireApprovalFor: { ...current.agent.requireApprovalFor, high: value } } }))
              }
            />
          </div>
        </div>
      </Card>

      <div className="grid cols-2">
        <Card title="Application">
          <Toggle
            label="Desktop notifications"
            checked={draft.app.notifications}
            onChange={(value) => update((current) => ({ ...current, app: { ...current.app, notifications: value } }))}
          />
          <Toggle
            label="Persistent memory"
            checked={draft.app.memoryEnabled}
            onChange={(value) => update((current) => ({ ...current, app: { ...current.app, memoryEnabled: value } }))}
          />
          <div className="divider" />
          <Field label="Terminal shell">
            <select
              value={draft.app.terminal.shell}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  app: { ...current.app, terminal: { ...current.app.terminal, shell: event.target.value as 'powershell' | 'cmd' | 'bash' } },
                }))
              }
            >
              <option value="bash">bash / sh</option>
              <option value="powershell">powershell (Windows)</option>
              <option value="cmd">cmd (Windows)</option>
            </select>
          </Field>
          <Field label="Command timeout (ms)">
            <input
              type="number"
              min="1000"
              step="1000"
              value={draft.app.terminal.timeoutMs}
              onChange={(event) =>
                update((current) => ({ ...current, app: { ...current.app, terminal: { ...current.app.terminal, timeoutMs: Number(event.target.value) } } }))
              }
            />
          </Field>
        </Card>

        <Card title="Browser">
          <Toggle
            label="Headless by default"
            checked={draft.app.browser.headless}
            onChange={(value) => update((current) => ({ ...current, app: { ...current.app, browser: { ...current.app.browser, headless: value } } }))}
          />
          <Field label="Default action timeout (ms)">
            <input
              type="number"
              min="1000"
              step="1000"
              value={draft.app.browser.defaultTimeoutMs}
              onChange={(event) =>
                update((current) => ({ ...current, app: { ...current.app, browser: { ...current.app.browser, defaultTimeoutMs: Number(event.target.value) } } }))
              }
            />
          </Field>
          <div className="divider" />
          <div className="tiny dim">
            Sensitive actions (navigation to checkout/payment pages, clicks on pay/delete controls) always require explicit
            approval, regardless of these defaults.
          </div>
        </Card>
      </div>

      <Card title="Data management">
        <div className="row wrap" style={{ gap: 8 }}>
          <button
            onClick={async () => {
              const data = await api.settings();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
              const url = URL.createObjectURL(blob);
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'nexus-settings.json';
              anchor.click();
              URL.revokeObjectURL(url);
            }}
            type="button"
          >
            export settings
          </button>
          <button
            className="danger"
            onClick={async () => {
              if (!window.confirm('Reset all settings to defaults? Memories, projects and snapshots are kept.')) return;
              await api.updateSettings(defaultSettings);
              setDraft(defaultSettings);
              await refreshSettings();
              toast('Settings reset to defaults');
            }}
            type="button"
          >
            reset to defaults
          </button>
        </div>
        <div className="tiny dim mt">
          Snapshots are retained for 30 days by default and pruned by a defined retention policy. Project files on disk are never
          deleted by NEXUS without approval.
        </div>
      </Card>

      {!settings.settings && <Empty title="Settings unavailable">Could not reach the backend.</Empty>}
    </div>
  );
}

const defaultSettings: AppSettings = {
  ai: { defaultProvider: 'gemini', geminiModel: 'gemini-2.5-pro', groqModel: 'openai/gpt-oss-120b', temperature: 0.4, maxOutputTokens: 4096, allowCrossProviderFallback: true },
  agent: { maxToolCalls: 24, maxDurationMs: 300000, maxRetriesPerStep: 2, maxContextTokens: 48000, maxConcurrentTasks: 2, requireApprovalFor: { medium: true, high: true } },
  app: {
    theme: 'monochrome',
    notifications: true,
    memoryEnabled: true,
    terminal: { shell: 'bash', timeoutMs: 120000 },
    browser: { headless: true, defaultTimeoutMs: 20000 },
    logging: { level: 'info', retentionDays: 30 },
  },
  projects: { defaultIgnoreGlobs: [] },
};
