/** Agents: the 7 role definitions, their enforced tool allow-lists and live leases. */
import React from 'react';
import { api } from '../lib/api';
import { useAsync } from '../lib/store';
import { Card, Empty, SpinnerBlock } from '../components/ui';

export function AgentsPage() {
  const agents = useAsync(() => api.agents(), []);
  const leases = useAsync(() => api.leases(), []);
  const tools = useAsync(() => api.tools(), []);

  if (agents.loading) return <SpinnerBlock />;
  const riskOf = new Map((tools.data?.tools ?? []).map((tool) => [tool.id, tool.risk]));

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="Orchestration model">
        <div className="small muted">
          One orchestrator owns all agent activity. Roles are logical, not separate provider integrations: each role gets a
          restricted tool allow-list enforced by the tool registry, and a file lease prevents two agents from writing the same
          file at once. A rejection anywhere stops the run rather than being worked around.
        </div>
      </Card>

      <div className="grid cols-2">
        {(agents.data?.agents ?? []).map((agent) => (
          <Card
            key={agent.role}
            title={agent.name}
            actions={<span className={`pill ${agent.mayWriteFiles ? '' : 'outline'}`}>{agent.mayWriteFiles ? 'can write files' : 'read-only'}</span>}
          >
            <div className="small muted" style={{ marginBottom: 8 }}>
              {agent.description}
            </div>
            <div className="row wrap" style={{ gap: 4 }}>
              {agent.allowedTools.map((toolId) => (
                <span key={toolId} className={`pill tiny ${riskOf.get(toolId) === 'high' ? 'outline' : ''}`}>
                  {toolId}
                </span>
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card title={`Active file leases (${leases.data?.leases.length ?? 0})`}>
        {(leases.data?.leases.length ?? 0) === 0 ? (
          <Empty title="No leases held">Leases are taken while an agent is writing files.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Task</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {leases.data?.leases.map((lease) => (
                <tr key={lease.leaseId}>
                  <td className="tiny mono">{lease.role}</td>
                  <td className="tiny mono">{lease.taskId}</td>
                  <td className="tiny mono">{lease.files.join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card title={`Tool registry (${tools.data?.tools.length ?? 0} tools)`}>
        <table className="table">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Category</th>
              <th>Risk</th>
              <th>Timeout</th>
              <th>Approval</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {(tools.data?.tools ?? []).map((tool) => (
              <tr key={tool.id}>
                <td className="tiny mono nowrap">{tool.id}</td>
                <td className="tiny dim">{tool.category}</td>
                <td className="tiny">
                  <span className={`pill tiny ${tool.risk === 'high' ? 'solid' : tool.risk === 'low' ? 'outline' : ''}`}>{tool.risk}</span>
                </td>
                <td className="tiny dim nowrap">{Math.round(tool.timeoutMs / 1000)}s</td>
                <td className="tiny dim">{tool.requiresApproval ? 'required' : '—'}</td>
                <td className="tiny dim" style={{ maxWidth: 380 }}>
                  {tool.description}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
