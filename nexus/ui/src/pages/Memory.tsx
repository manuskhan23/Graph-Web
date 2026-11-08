/** Memory: editable long-term memory with categories, revisions and import/export. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, SpinnerBlock, relativeTime } from '../components/ui';

const CATEGORIES = [
  'preference',
  'project_instruction',
  'coding_standard',
  'architecture_decision',
  'tech_stack',
  'task_outcome',
  'development_decision',
  'command',
];

export function MemoryPage() {
  const { projectId, toast, settings, refreshSettings } = useStore();
  const memories = useAsync(() => api.memories(projectId ?? undefined), [projectId]);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('preference');
  const [importance, setImportance] = useState(3);
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);

  const add = async () => {
    if (!content.trim()) return;
    try {
      await api.createMemory({ content: content.trim(), category, importance, projectId });
      setContent('');
      memories.reload();
      toast('Memory saved');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteMemory(id);
      memories.reload();
      toast('Memory deleted');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.updateMemory(editing.id, { content: editing.content });
      setEditing(null);
      memories.reload();
      toast('Memory updated');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const toggleMemory = async () => {
    if (!settings) return;
    try {
      await api.updateSettings({ app: { memoryEnabled: !settings.settings.app.memoryEnabled } });
      await refreshSettings();
      memories.reload();
      toast(`Memory ${settings.settings.app.memoryEnabled ? 'disabled' : 'enabled'}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  if (memories.loading) return <SpinnerBlock />;
  const filtered = (memories.data?.memories ?? []).filter(
    (memory) => !filter || memory.content.toLowerCase().includes(filter.toLowerCase()) || memory.category.includes(filter),
  );

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card
        title="Long-term memory"
        actions={
          <div className="row" style={{ gap: 6 }}>
            <button className="ghost tiny" onClick={() => void toggleMemory()} type="button">
              memory is {settings?.settings.app.memoryEnabled ? 'on' : 'off'}
            </button>
            <button
              className="ghost tiny"
              onClick={async () => {
                const text = await api.exportMemories(projectId ?? undefined);
                const blob = new Blob([text], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'nexus-memories.json';
                anchor.click();
                URL.revokeObjectURL(url);
              }}
              type="button"
            >
              export
            </button>
          </div>
        }
      >
        <div className="small muted" style={{ marginBottom: 10 }}>
          Memories are injected into the agent's context. Secrets (API keys, passwords, tokens) are rejected at write time and
          filtered again on export.
        </div>
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '3 1 300px' }}>
            <label>New memory</label>
            <input
              value={content}
              onChange={(event) => setContent(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void add()}
              placeholder="e.g. This project uses Zod for all request validation"
            />
          </div>
          <div style={{ flex: '1 1 150px' }}>
            <label>Category</label>
            <select value={category} onChange={(event) => setCategory(event.target.value)}>
              {CATEGORIES.map((entry) => (
                <option key={entry} value={entry}>
                  {entry.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: '0 0 90px' }}>
            <label>Weight</label>
            <select value={importance} onChange={(event) => setImportance(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <button className="primary" onClick={() => void add()} disabled={!content.trim()} type="button">
            Save
          </button>
        </div>
      </Card>

      <Card
        title={`Stored memories (${filtered.length})`}
        actions={<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="filter…" style={{ width: 180, fontSize: 11, padding: '3px 7px' }} />}
      >
        {filtered.length === 0 && <Empty title="No memories">The agent will save decisions here as you work.</Empty>}
        {filtered.map((memory) => (
          <div key={memory.id} style={{ padding: '8px 0', borderBottom: '1px solid #1e1e1e' }}>
            <div className="row" style={{ gap: 6, marginBottom: 3 }}>
              <span className="pill tiny">{memory.category.replace(/_/g, ' ')}</span>
              <span className="pill outline tiny">weight {memory.importance}</span>
              <span className="pill outline tiny">{memory.source}</span>
              {memory.projectId ? null : <span className="pill outline tiny">global</span>}
              {memory.revisions.length > 0 && <span className="tiny dim">{memory.revisions.length} revision(s)</span>}
              <span className="spacer" />
              <span className="tiny dim">{relativeTime(memory.updatedAt)}</span>
            </div>
            {editing?.id === memory.id ? (
              <div className="row" style={{ gap: 6 }}>
                <input value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
                <button className="tiny primary" onClick={() => void saveEdit()} type="button">
                  save
                </button>
                <button className="tiny" onClick={() => setEditing(null)} type="button">
                  cancel
                </button>
              </div>
            ) : (
              <div className="row between">
                <span className="small" style={{ flex: 1 }}>
                  {memory.content}
                </span>
                <div className="row" style={{ gap: 4 }}>
                  <button className="tiny" onClick={() => setEditing({ id: memory.id, content: memory.content })} type="button">
                    edit
                  </button>
                  <button className="tiny danger" onClick={() => void remove(memory.id)} type="button">
                    delete
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </Card>

      <Card title="Import">
        <div className="small muted" style={{ marginBottom: 8 }}>
          Paste a previously exported NEXUS memory file. Entries containing secrets are skipped and counted.
        </div>
        <input
          type="file"
          accept="application/json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
              const json = await file.text();
              const result = await api.importMemories(json);
              memories.reload();
              toast(`Imported ${result.imported}, skipped ${result.skipped}`);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
            event.target.value = '';
          }}
        />
      </Card>
    </div>
  );
}
