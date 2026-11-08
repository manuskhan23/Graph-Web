/**
 * AI Chat — streaming-style conversation surface with live plan, tool
 * indicators, approval controls and a context inspector.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { Card, Empty, ProgressBar, RiskPill, Spinner, StatusPill, StepRow, relativeTime } from '../components/ui';
import type { AgentRunResult, Conversation, Message, ApprovalRequest, RiskLevel } from '../types';

const SUGGESTIONS = [
  'Analyse the architecture of this project',
  'Find where authentication is implemented',
  'Run the test suite and report failures',
  'Explain how this codebase is structured',
  'Look for security problems in the code',
];

interface Attachment {
  name: string;
  mimeType: string;
  base64: string;
  size: number;
}

export function ChatPage() {
  const { project, projectId, toast, bumpReload } = useStore();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AgentRunResult | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [autoApprove, setAutoApprove] = useState<RiskLevel | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [showHistory, setShowHistory] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadConversations = async () => {
    try {
      const { conversations: list } = await api.conversations(projectId ?? undefined);
      setConversations(list);
    } catch {
      /* non-fatal */
    }
  };

  useEffect(() => {
    void loadConversations();
  }, [projectId]);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    api
      .messages(conversationId)
      .then(({ messages: list }) => setMessages(list))
      .catch(() => setMessages([]));
  }, [conversationId]);

  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages, running, result]);

  // Poll pending approvals while a run is in flight so the UI can offer a decision.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      try {
        const { approvals: pending } = await api.approvals('pending');
        setApprovals(pending);
      } catch {
        /* ignore */
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [running]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
    if (!message || running) return;
    setInput('');
    setRunning(true);
    setApprovals([]);
    setResult(null);

    const optimistic: Message = {
      id: `local_${Date.now()}`,
      conversationId: conversationId ?? 'pending',
      role: 'user',
      content: message,
      provider: null,
      model: null,
      toolCalls: [],
      attachments: attachments.map((a) => ({ name: a.name, mimeType: a.mimeType })),
      tokens: null,
      createdAt: Date.now(),
    };
    setMessages((current) => [...current, optimistic]);

    try {
      const response = await api.runAgent({
        projectId,
        message,
        conversationId,
        autoApproveBelow: autoApprove,
        attachments: attachments.length ? attachments.map(({ name, mimeType, base64 }) => ({ name, mimeType, base64 })) : undefined,
      });
      setConversationId(response.conversationId);
      setResult(response);
      const { messages: list } = await api.messages(response.conversationId);
      setMessages(list);
      void loadConversations();
      bumpReload();
      if (response.status === 'completed') toast('Task completed and verified');
      else if (response.status === 'failed') toast('Task stopped — see the report', 'error');
    } catch (err) {
      const apiErr = err as ApiError;
      setMessages((current) => [
        ...current,
        {
          ...optimistic,
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `**Request failed** — ${apiErr.message}${apiErr.code ? ` (${apiErr.code})` : ''}`,
        },
      ]);
      toast(apiErr.message, 'error');
    } finally {
      setRunning(false);
      setAttachments([]);
    }
  };

  const resolveApproval = async (approvalId: string, approved: boolean) => {
    try {
      await api.resolveApproval(approvalId, approved);
      setApprovals((current) => current.filter((a) => a.id !== approvalId));
      toast(approved ? 'Approved' : 'Rejected');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const attach = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) {
      toast('Image must be under 8 MB', 'error');
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
      reader.onerror = () => reject(new Error('Could not read the file'));
      reader.readAsDataURL(file);
    });
    setAttachments((current) => [...current, { name: file.name, mimeType: file.type, base64, size: file.size }]);
  };

  const conversationTitle = useMemo(
    () => conversations.find((c) => c.id === conversationId)?.title ?? 'New conversation',
    [conversations, conversationId],
  );

  return (
    <div className="split" style={{ gridTemplateColumns: showHistory ? '240px 1fr' : '1fr' }}>
      {showHistory && (
        <aside className="split-side">
          <div style={{ padding: 10 }}>
            <button
              className="primary"
              style={{ width: '100%' }}
              onClick={() => {
                setConversationId(null);
                setMessages([]);
                setResult(null);
              }}
            >
              + New conversation
            </button>
          </div>
          {conversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`list-item ${conversation.id === conversationId ? 'active' : ''}`}
              onClick={() => setConversationId(conversation.id)}
            >
              <div className="ellipsis" style={{ fontSize: 12.5 }}>
                {conversation.title}
              </div>
              <div className="tiny dim">{relativeTime(conversation.updatedAt)}</div>
            </div>
          ))}
          {conversations.length === 0 && <div className="small dim" style={{ padding: 14 }}>No conversations yet.</div>}
        </aside>
      )}

      <div className="chat-wrap">
        <div className="topbar" style={{ height: 38 }}>
          <button className="ghost tiny" onClick={() => setShowHistory((v) => !v)} type="button">
            {showHistory ? '◀ history' : '▶ history'}
          </button>
          <span className="small ellipsis">{conversationTitle}</span>
          <span className="spacer" />
          <select
            value={autoApprove ?? ''}
            onChange={(event) => setAutoApprove((event.target.value || null) as RiskLevel | null)}
            style={{ width: 170, fontSize: 11, padding: '3px 6px' }}
            title="Auto-approval ceiling. Medium and high risk actions always require explicit approval."
          >
            <option value="">ask for all approvals</option>
            <option value="low">auto-allow low-risk tools</option>
          </select>
        </div>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.length === 0 && !running && (
            <div style={{ maxWidth: 720, margin: '24px auto 0' }}>
              <Empty title="What should NEXUS do?">
                {project
                  ? `The agent will inspect "${project.name}", plan verifiable steps, and ask before anything risky.`
                  : 'Register a project first to give the agent code context.'}
              </Empty>
              <div className="chat-hints" style={{ marginTop: 14, justifyContent: 'center' }}>
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} className="chat-hint" onClick={() => void send(suggestion)} type="button">
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={`msg ${message.role === 'user' ? 'user' : ''}`}>
              <div className="msg-meta">
                {message.role === 'user' ? 'you' : 'nexus'}
                {message.model ? ` · ${message.model}` : ''}
                {message.attachments.length > 0 ? ` · ${message.attachments.length} image(s)` : ''}
              </div>
              <div className="msg-bubble">
                {message.role === 'user' ? (
                  <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
                ) : (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                )}
              </div>
            </div>
          ))}

          {running && (
            <div className="msg">
              <div className="msg-meta">nexus</div>
              <div className="msg-bubble">
                <Spinner label="Planning and executing…" />
                <div className="tiny dim" style={{ marginTop: 6 }}>
                  Live progress appears in Tasks and Activity. Approval requests pause the run.
                </div>
              </div>
            </div>
          )}

          {approvals.map((approval) => (
            <div className="msg" key={approval.id}>
              <div className="msg-bubble" style={{ borderStyle: 'dashed' }}>
                <div className="row between">
                  <strong>{approval.title}</strong>
                  <RiskPill risk={approval.risk} />
                </div>
                <div className="small muted" style={{ margin: '6px 0 10px' }}>
                  {approval.detail}
                </div>
                <pre className="pre tiny" style={{ maxHeight: 140, overflow: 'auto' }}>
                  {JSON.stringify(approval.payload, null, 2)}
                </pre>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="primary" onClick={() => void resolveApproval(approval.id, true)} type="button">
                    Approve
                  </button>
                  <button className="danger" onClick={() => void resolveApproval(approval.id, false)} type="button">
                    Reject
                  </button>
                </div>
              </div>
            </div>
          ))}

          {result && (
            <Card title="Execution report">
              <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
                <StatusPill status={result.status} />
                <span className="pill">{result.toolCalls} tool calls</span>
                <span className="pill">{Math.round(result.durationMs / 100)}00 ms</span>
                <span className={`pill ${result.verified ? 'solid' : 'outline'}`}>
                  {result.verified ? 'verified' : 'unverified'}
                </span>
                <button className="ghost tiny" onClick={() => setShowContext((v) => !v)} type="button">
                  {showContext ? 'hide' : 'show'} plan
                </button>
              </div>
              <ProgressBar value={result.steps.filter((s) => s.status === 'completed').length / Math.max(1, result.steps.length)} />
              {showContext && (
                <div style={{ marginTop: 12 }}>
                  {result.steps.map((step, index) => (
                    <StepRow key={step.id} step={step} index={index} />
                  ))}
                </div>
              )}
              {result.usage.length > 0 && (
                <div className="context-bar">
                  {result.usage.map((usage, index) => (
                    <span className="context-chip" key={index}>
                      {usage.provider}/{usage.model} · {usage.inputTokens ?? '?'}→{usage.outputTokens ?? '?'} tok
                    </span>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        <div className="chat-input-zone">
          {attachments.length > 0 && (
            <div className="context-bar" style={{ marginBottom: 8 }}>
              {attachments.map((attachment, index) => (
                <span className="context-chip" key={index}>
                  🖼 {attachment.name} ({(attachment.size / 1024).toFixed(0)} KB)
                  <button
                    className="ghost tiny"
                    style={{ padding: '0 4px', marginLeft: 4 }}
                    onClick={() => setAttachments((current) => current.filter((_, i) => i !== index))}
                    type="button"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="chat-input-row">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attach(file);
                event.target.value = '';
              }}
            />
            <button className="ghost" onClick={() => fileRef.current?.click()} title="Attach a screenshot" type="button">
              🖼
            </button>
            <textarea
              value={input}
              placeholder={project ? `Ask NEXUS about ${project.name}…` : 'Register a project to give the agent context…'}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={2}
            />
            <button className="primary" onClick={() => void send()} disabled={running || !input.trim()} type="button">
              {running ? 'running…' : 'Send'}
            </button>
          </div>
          <div className="chat-hints">
            {SUGGESTIONS.slice(0, 3).map((suggestion) => (
              <button key={suggestion} className="chat-hint" onClick={() => setInput(suggestion)} type="button">
                {suggestion}
              </button>
            ))}
            {!project && <span className="tiny dim">No project selected — the agent can still use memory and terminal.</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
