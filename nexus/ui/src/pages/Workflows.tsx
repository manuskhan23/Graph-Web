/** Workflows: list, create from template, run, pause/resume, inspect the log. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, StatusPill, SpinnerBlock, relativeTime } from '../components/ui';
import type { WorkflowExecution } from '../types';

export function WorkflowsPage() {
  const { projectId, toast } = useStore();
  const workflows = useAsync(() => api.workflows(), []);
  const templates = useAsync(() => api.workflowTemplates(), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);
  const [busy, setBusy] = useState(false);

  const createFromTemplate = async (templateIndex: number) => {
    const template = templates.data?.templates[templateIndex];
    if (!template) return;
    try {
      const { workflow } = await api.createWorkflow({
        name: `${template.name}${projectId ? '' : ' (no project)'}`,
        description: template.description,
        projectId,
        blocks: template.blocks,
        entry: template.entry,
      });
      workflows.reload();
      setSelectedId(workflow.id);
      toast('Workflow created from template');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const run = async (workflowId: string) => {
    setBusy(true);
    try {
      const { execution: result } = await api.runWorkflow(workflowId, projectId);
      setExecution(result);
      if (result.status === 'completed') toast('Workflow completed');
      else if (result.status === 'paused') toast('Workflow paused — resume when ready');
      else toast(`Workflow ${result.status}`, 'error');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (workflows.loading) return <SpinnerBlock />;

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="Create from a template">
        <div className="grid cols-3">
          {(templates.data?.templates ?? []).map((template, index) => (
            <div key={template.name} className="card" style={{ margin: 0 }}>
              <div className="small" style={{ fontWeight: 600 }}>{template.name}</div>
              <div className="tiny dim" style={{ margin: '4px 0 8px', minHeight: 32 }}>
                {template.description}
              </div>
              <div className="tiny mono dim">{template.blocks.length} blocks</div>
              <button className="tiny mt" onClick={() => void createFromTemplate(index)} type="button">
                use template
              </button>
            </div>
          ))}
          {templates.loading && <div className="small dim">Loading templates…</div>}
        </div>
      </Card>

      <Card title={`Workflows (${workflows.data?.workflows.length ?? 0})`}>
        {workflows.data?.workflows.length === 0 && <Empty title="No workflows yet">Start from a template above.</Empty>}
        {(workflows.data?.workflows ?? []).map((workflow) => (
          <div key={workflow.id} className="row between" style={{ padding: '9px 0', borderBottom: '1px solid #1e1e1e' }}>
            <div style={{ minWidth: 0 }}>
              <div className="small">{workflow.name}</div>
              <div className="tiny dim">
                {workflow.blocks.length} blocks · updated {relativeTime(workflow.updatedAt)}
                {workflow.isTemplate ? ' · template' : ''}
              </div>
            </div>
            <div className="row" style={{ gap: 5 }}>
              <button className="tiny" onClick={() => setSelectedId(workflow.id === selectedId ? null : workflow.id)} type="button">
                {selectedId === workflow.id ? 'hide' : 'inspect'}
              </button>
              <button className="primary tiny" onClick={() => void run(workflow.id)} disabled={busy} type="button">
                run
              </button>
              <button
                className="tiny danger"
                onClick={async () => {
                  if (!window.confirm(`Delete workflow "${workflow.name}"?`)) return;
                  await api.deleteWorkflow(workflow.id);
                  workflows.reload();
                }}
                type="button"
              >
                delete
              </button>
            </div>
          </div>
        ))}
      </Card>

      {selectedId && <WorkflowDetail workflowId={selectedId} execution={execution} setExecution={setExecution} />}
    </div>
  );
}

function WorkflowDetail({
  workflowId,
  execution,
  setExecution,
}: {
  workflowId: string;
  execution: WorkflowExecution | null;
  setExecution: (value: WorkflowExecution) => void;
}) {
  const detail = useAsync(() => api.workflow(workflowId), [workflowId]);
  const { toast } = useStore();
  if (detail.loading || !detail.data) return <SpinnerBlock />;

  const show = execution && execution.workflowId === workflowId ? execution : detail.data.executions[0] ?? null;

  return (
    <Card title={detail.data.workflow.name}>
      <label>Blocks</label>
      {detail.data.workflow.blocks.map((block) => (
        <div key={block.id} className="step">
          <div className="step-head">
            <span className="step-icon">▸</span>
            <span className="step-title">{block.label}</span>
            <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
              <span className="pill outline tiny">{block.type}</span>
              <span className="tiny dim">{block.next ? `→ ${block.next}` : 'end'}</span>
            </span>
          </div>
          <div className="step-detail mono tiny">{JSON.stringify(block.config).slice(0, 200)}</div>
        </div>
      ))}

      <div className="divider" />
      <div className="row between">
        <label style={{ margin: 0 }}>Latest execution</label>
        {show && (show.status === 'paused' || show.status === 'running') && (
          <div className="row" style={{ gap: 5 }}>
            <button
              className="tiny"
              onClick={async () => {
                await api.pauseWorkflow(show.id);
                toast('Pause requested');
              }}
              type="button"
            >
              pause
            </button>
            <button
              className="tiny"
              onClick={async () => {
                try {
                  const { execution: resumed } = await api.resumeWorkflow(show.id);
                  setExecution(resumed);
                  toast(`Workflow ${resumed.status}`);
                } catch (err) {
                  toast((err as Error).message, 'error');
                }
              }}
              type="button"
            >
              resume
            </button>
          </div>
        )}
      </div>
      {!show && <div className="small dim">This workflow has not run yet.</div>}
      {show && (
        <div style={{ marginTop: 8 }}>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <StatusPill status={show.status} />
            <span className="pill tiny">{show.log.length} blocks executed</span>
            {show.error && <span className="tiny">✖ {show.error}</span>}
          </div>
          {show.log.map((entry, index) => (
            <div key={index} className="row" style={{ gap: 8, padding: '3px 0', alignItems: 'flex-start' }}>
              <span className="tiny mono dim nowrap">{new Date(entry.at).toLocaleTimeString()}</span>
              <span className={`pill tiny ${entry.status === 'success' ? '' : 'solid'}`}>{entry.status}</span>
              <span className="tiny mono nowrap">{entry.blockId}</span>
              <span className="tiny dim ellipsis">{entry.detail}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
