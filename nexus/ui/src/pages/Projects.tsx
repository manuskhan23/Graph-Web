/** Projects: register, scan, remove, and inspect the analysis. */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { useAsync, useStore } from '../lib/store';
import { Card, Empty, Spinner, SpinnerBlock, Stat, relativeTime } from '../components/ui';
import type { ProjectAnalysis } from '../types';

export function ProjectsPage({ navigate }: { navigate: (page: string) => void }) {
  const { projects, projectId, setProjectId, refreshProjects, toast, project } = useStore();
  const [rootPath, setRootPath] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const pickDirectory = async () => {
    if (window.nexus) {
      const selected = await window.nexus.selectDirectory();
      if (selected) setRootPath(selected);
      return;
    }
    toast('Native picker is only available in the desktop app — paste a path instead');
  };

  const register = async () => {
    if (!rootPath.trim()) return;
    setBusy(true);
    try {
      const { project: created } = await api.createProject({ rootPath: rootPath.trim(), name: name.trim() || undefined });
      setRootPath('');
      setName('');
      await refreshProjects();
      setProjectId(created.id);
      toast(`Registered ${created.name} — indexing in the background`);
      setTimeout(() => void refreshProjects(), 2500);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const scan = async (id: string) => {
    try {
      await api.scanProject(id);
      toast('Scan started');
      setTimeout(() => void refreshProjects(), 2000);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async (id: string, projectName: string) => {
    if (!window.confirm(`Remove "${projectName}" from NEXUS? Files on disk are not touched.`)) return;
    try {
      await api.removeProject(id);
      await refreshProjects();
      toast('Project removed');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const loadAnalysis = async (id: string) => {
    setAnalysis(null);
    setAnalysisError(null);
    try {
      const { analysis: result } = await api.analysis(id);
      setAnalysis(result);
    } catch (err) {
      setAnalysisError((err as Error).message);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <Card title="Register a project">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '2 1 320px' }}>
            <label>Directory path</label>
            <input
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="/home/you/projects/my-app  ·  C:\\Users\\you\\projects\\my-app"
            />
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label>Display name (optional)</label>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My App" />
          </div>
          <button onClick={() => void pickDirectory()} type="button">
            Browse…
          </button>
          <button className="primary" onClick={() => void register()} disabled={busy || !rootPath.trim()} type="button">
            {busy ? 'Registering…' : 'Register'}
          </button>
        </div>
        <div className="tiny dim" style={{ marginTop: 8 }}>
          Secrets (.env, keys, credentials), binaries and dependency folders are never indexed.
        </div>
      </Card>

      <div className="grid cols-2">
        <Card title={`Projects (${projects.length})`}>
          {projects.length === 0 && <Empty title="No projects registered">Register a directory above to give the agent code context.</Empty>}
          {projects.map((entry) => (
            <div
              key={entry.id}
              className="row between"
              style={{ padding: '10px 0', borderBottom: '1px solid #1e1e1e', cursor: 'pointer' }}
              onClick={() => setProjectId(entry.id)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 6 }}>
                  <span className="small" style={{ fontWeight: entry.id === projectId ? 700 : 400 }}>
                    {entry.name}
                  </span>
                  {entry.id === projectId && <span className="pill solid tiny">active</span>}
                </div>
                <div className="tiny dim ellipsis mono">{entry.rootPath}</div>
                <div className="tiny dim">
                  {entry.fileCount} files · index v{entry.indexVersion} · {relativeTime(entry.lastIndexedAt)}
                </div>
              </div>
              <div className="row" style={{ gap: 5 }}>
                <button
                  className="tiny"
                  onClick={(event) => {
                    event.stopPropagation();
                    void scan(entry.id);
                  }}
                  type="button"
                >
                  scan
                </button>
                <button
                  className="tiny"
                  onClick={(event) => {
                    event.stopPropagation();
                    void loadAnalysis(entry.id);
                  }}
                  type="button"
                >
                  analyse
                </button>
                <button
                  className="tiny danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(entry.id, entry.name);
                  }}
                  type="button"
                >
                  remove
                </button>
              </div>
            </div>
          ))}
        </Card>

        <Card
          title={analysis ? `Analysis · ${analysis.stats.filesIndexed} files` : 'Project analysis'}
          actions={
            project && !analysis ? (
              <button className="ghost tiny" onClick={() => void loadAnalysis(project.id)} type="button">
                run analysis
              </button>
            ) : undefined
          }
        >
          {!analysis && !analysisError && (
            <div className="small dim">
              Static analysis extracts the stack, endpoints, models and architectural issues straight from source — no AI
              required, nothing invented.
            </div>
          )}
          {analysisError && <div className="small">✖ {analysisError}</div>}
          {analysis && (
            <div className="col" style={{ gap: 10 }}>
              <div className="small">{analysis.overview}</div>
              <div className="grid cols-3">
                <Stat label="Files" value={analysis.stats.filesIndexed} />
                <Stat label="Lines" value={analysis.stats.totalLines.toLocaleString()} />
                <Stat label="Dependencies" value={analysis.stats.dependencyCount} />
              </div>
              <div>
                <label>Stack</label>
                <div className="row wrap" style={{ gap: 5 }}>
                  {analysis.technologies.map((tech) => (
                    <span className="pill" key={tech.name}>
                      {tech.name}
                      {tech.version ? ` ${tech.version}` : ''}
                    </span>
                  ))}
                  {analysis.technologies.length === 0 && <span className="small dim">None detected</span>}
                </div>
              </div>
              {analysis.issues.length > 0 && (
                <div>
                  <label>Issues ({analysis.issues.length})</label>
                  {analysis.issues.slice(0, 6).map((issue) => (
                    <div key={issue.id} className="small" style={{ padding: '3px 0' }}>
                      <span className={`pill ${issue.severity === 'error' ? 'solid' : 'outline'} tiny`}>{issue.severity}</span>{' '}
                      {issue.title}
                    </div>
                  ))}
                </div>
              )}
              <div className="row" style={{ gap: 6 }}>
                <button className="tiny" onClick={() => navigate('codebase')} type="button">
                  open codebase
                </button>
                <button className="tiny" onClick={() => navigate('chat')} type="button">
                  ask about it
                </button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {project && <RecentJobs />}
    </div>
  );
}

function RecentJobs() {
  const { data, loading } = useAsync(() => api.jobs(), []);
  if (loading) return <Spinner label="loading jobs" />;
  if (!data || data.jobs.length === 0) return null;
  return (
    <Card title="Background jobs">
      {data.jobs.slice(0, 8).map((job) => (
        <div key={job.id} className="row between" style={{ padding: '5px 0' }}>
          <span className="tiny mono">{job.kind}</span>
          <span className="tiny dim ellipsis" style={{ maxWidth: 340 }}>
            {job.message}
          </span>
          <span className="pill tiny">{job.status}</span>
        </div>
      ))}
    </Card>
  );
}

export function CodebasePage() {
  const { projectId, project, toast } = useStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const tree = useAsync(() => (projectId ? api.tree(projectId) : Promise.resolve(null)), [projectId]);
  const [file, setFile] = useState<{ relPath: string; content: string; lines: number } | null>(null);
  const [hits, setHits] = useState<{ relPath: string; startLine: number; endLine: number; snippet: string; score: number }[]>([]);
  const [searching, setSearching] = useState(false);

  const open = async (relPath: string) => {
    if (!projectId) return;
    try {
      setSelected(relPath);
      const result = await api.readFile(projectId, relPath);
      setFile(result);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const search = async () => {
    if (!projectId || !query.trim()) return;
    setSearching(true);
    try {
      const result = await api.search({ projectId, query: query.trim(), limit: 20 });
      setHits(result.hits);
      toast(`${result.hits.length} hits · ${result.strategy} search · ${result.tookMs} ms`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSearching(false);
    }
  };

  if (!projectId) return <Empty title="No project selected">Register a project to browse its code.</Empty>;
  if (tree.loading) return <SpinnerBlock />;

  return (
    <div className="split" style={{ gridTemplateColumns: '340px 1fr' }}>
      <aside className="split-side">
        <div style={{ padding: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && void search()}
              placeholder="search code…"
              style={{ fontSize: 12 }}
            />
            <button className="tiny" onClick={() => void search()} disabled={searching} type="button">
              {searching ? '…' : 'go'}
            </button>
          </div>
        </div>
        {hits.length > 0 && (
          <div>
            <div className="tiny dim" style={{ padding: '6px 12px' }}>
              {hits.length} results
            </div>
            {hits.map((hit, index) => (
              <div key={`${hit.relPath}-${index}`} className="list-item" onClick={() => void open(hit.relPath)}>
                <div className="tiny mono ellipsis">
                  {hit.relPath}:{hit.startLine}
                </div>
                <div className="tiny dim" style={{ whiteSpace: 'pre-wrap', maxHeight: 46, overflow: 'hidden' }}>
                  {hit.snippet.slice(0, 140)}
                </div>
              </div>
            ))}
            <div className="divider" />
          </div>
        )}
        <div className="tiny dim" style={{ padding: '6px 12px' }}>
          {tree.data?.files.length ?? 0} indexed files
        </div>
        {tree.data?.files.slice(0, 400).map((entry) => (
          <div
            key={entry.relPath}
            className={`list-item ${selected === entry.relPath ? 'active' : ''}`}
            onClick={() => void open(entry.relPath)}
          >
            <div className="tiny mono ellipsis">{entry.relPath}</div>
            <div className="tiny dim">
              {entry.language} · {entry.lines} lines
            </div>
          </div>
        ))}
      </aside>

      <div className="split-main">
        {!file && (
          <div style={{ padding: 20 }}>
            <Empty title="Select a file">Files open read-only here; edits are staged by the agent or the editor API.</Empty>
          </div>
        )}
        {file && (
          <div>
            <div className="topbar" style={{ height: 38 }}>
              <span className="tiny mono ellipsis">{file.relPath}</span>
              <span className="spacer" />
              <span className="topbar-chip">{file.lines} lines</span>
              <span className="topbar-chip">{project?.name}</span>
            </div>
            <pre className="pre" style={{ padding: 16, margin: 0, fontSize: 12 }}>
              {file.content.split('\n').map((line, index) => (
                <div key={index} style={{ display: 'flex' }}>
                  <span style={{ width: 46, color: '#4d4d4d', textAlign: 'right', paddingRight: 10, userSelect: 'none', flexShrink: 0 }}>
                    {index + 1}
                  </span>
                  <span>{line}</span>
                </div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
