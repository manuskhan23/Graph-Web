import { id, now, parseJson, type SqlDriver, type SqlRow } from '../driver.js';

export interface Conversation {
  id: string;
  projectId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  provider: string | null;
  model: string | null;
  toolCalls: unknown[];
  attachments: { name: string; mimeType: string; size?: number }[];
  tokens: number | null;
  createdAt: number;
}

export class ConversationsRepository {
  constructor(private readonly db: SqlDriver) {}

  private mapConversation(row: SqlRow): Conversation {
    return {
      id: String(row.id),
      projectId: row.project_id === null ? null : String(row.project_id),
      title: String(row.title),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  }

  private mapMessage(row: SqlRow): Message {
    return {
      id: String(row.id),
      conversationId: String(row.conversation_id),
      role: String(row.role) as Message['role'],
      content: String(row.content),
      provider: row.provider === null ? null : String(row.provider),
      model: row.model === null ? null : String(row.model),
      toolCalls: parseJson<unknown[]>(row.tool_calls, []),
      attachments: parseJson<Message['attachments']>(row.attachments, []),
      tokens: row.tokens === null ? null : Number(row.tokens),
      createdAt: Number(row.created_at),
    };
  }

  list(projectId?: string | null): Conversation[] {
    const rows = projectId
      ? this.db.all('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC', [projectId])
      : this.db.all('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100');
    return rows.map((r) => this.mapConversation(r));
  }

  get(conversationId: string): Conversation | null {
    const row = this.db.get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
    return row ? this.mapConversation(row) : null;
  }

  create(input: { projectId: string | null; title: string }): Conversation {
    const conversationId = id('conv');
    const ts = now();
    this.db.run('INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [
      conversationId,
      input.projectId,
      input.title,
      ts,
      ts,
    ]);
    return this.get(conversationId)!;
  }

  rename(conversationId: string, title: string): void {
    this.db.run('UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?', [title, now(), conversationId]);
  }

  remove(conversationId: string): boolean {
    return this.db.run('DELETE FROM conversations WHERE id = ?', [conversationId]).changes > 0;
  }

  messages(conversationId: string, limit = 200): Message[] {
    return this.db
      .all(
        `SELECT * FROM (SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?)
         ORDER BY created_at ASC`,
        [conversationId, limit],
      )
      .map((r) => this.mapMessage(r));
  }

  addMessage(input: {
    conversationId: string;
    role: Message['role'];
    content: string;
    provider?: string | null;
    model?: string | null;
    toolCalls?: unknown[];
    attachments?: Message['attachments'];
    tokens?: number | null;
  }): Message {
    const messageId = id('msg');
    const ts = now();
    this.db.run(
      `INSERT INTO messages (id, conversation_id, role, content, provider, model, tool_calls, attachments, tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        messageId,
        input.conversationId,
        input.role,
        input.content,
        input.provider ?? null,
        input.model ?? null,
        JSON.stringify(input.toolCalls ?? []),
        JSON.stringify(input.attachments ?? []),
        input.tokens ?? null,
        ts,
      ],
    );
    this.db.run('UPDATE conversations SET updated_at = ? WHERE id = ?', [ts, input.conversationId]);
    const row = this.db.get('SELECT * FROM messages WHERE id = ?', [messageId])!;
    return this.mapMessage(row);
  }

  /** Previous chats are real context: the agent runtime reads this history. */
  recentHistory(conversationId: string, limit = 12): Message[] {
    return this.messages(conversationId, limit);
  }
}
