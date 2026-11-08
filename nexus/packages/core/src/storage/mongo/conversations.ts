/**
 * MongoDB conversation + message store.
 *
 * Previous chats are the core of the recovery story: `messages` is indexed on
 * (conversationId, createdAt) so paging history back into context is a covered
 * range scan rather than a collection scan.
 */
import type { Conversation, Message } from '../../types.js';
import { id, now } from '../driver.js';
import type { ConversationStore } from '../contracts.js';
import type { MongoHandle } from './client.js';

type Doc = Record<string, unknown>;

export class MongoConversationStore implements ConversationStore {
  constructor(private readonly mongo: MongoHandle) {}

  private get conversations() {
    return this.mongo.collection('conversations');
  }
  private get messages_() {
    return this.mongo.collection('messages');
  }

  private toConversation(doc: Doc): Conversation {
    return {
      id: String(doc._id),
      projectId: doc.projectId === null || doc.projectId === undefined ? null : String(doc.projectId),
      title: String(doc.title),
      createdAt: Number(doc.createdAt),
      updatedAt: Number(doc.updatedAt),
    };
  }

  private toMessage(doc: Doc): Message {
    return {
      id: String(doc._id),
      conversationId: String(doc.conversationId),
      role: String(doc.role) as Message['role'],
      content: String(doc.content),
      provider: doc.provider === null || doc.provider === undefined ? null : String(doc.provider),
      model: doc.model === null || doc.model === undefined ? null : String(doc.model),
      toolCalls: (doc.toolCalls as unknown[]) ?? [],
      attachments: (doc.attachments as Message['attachments']) ?? [],
      tokens: doc.tokens === null || doc.tokens === undefined ? null : Number(doc.tokens),
      createdAt: Number(doc.createdAt),
    };
  }

  async list(projectId?: string | null): Promise<Conversation[]> {
    const docs = projectId
      ? await this.conversations.find({ projectId }).sort({ updatedAt: -1 }).limit(200).toArray()
      : await this.conversations.find({}).sort({ updatedAt: -1 }).limit(100).toArray();
    return docs.map((doc) => this.toConversation(doc));
  }

  async get(conversationId: string): Promise<Conversation | null> {
    const doc = await this.conversations.findOne({ _id: conversationId });
    return doc ? this.toConversation(doc) : null;
  }

  async create(input: { projectId: string | null; title: string }): Promise<Conversation> {
    const conversationId = id('conv');
    const ts = now();
    const doc: Doc = {
      _id: conversationId,
      projectId: input.projectId,
      title: input.title,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.conversations.insertOne(doc);
    return this.toConversation(doc);
  }

  async rename(conversationId: string, title: string): Promise<void> {
    await this.conversations.updateOne({ _id: conversationId }, { $set: { title, updatedAt: now() } });
  }

  async remove(conversationId: string): Promise<boolean> {
    const result = await this.conversations.deleteOne({ _id: conversationId });
    if (result.deletedCount === 0) return false;
    await this.messages_.deleteMany({ conversationId });
    return true;
  }

  /** Newest `limit` messages, returned in chronological order. */
  async messages(conversationId: string, limit = 200): Promise<Message[]> {
    const docs = await this.messages_
      .find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((doc) => this.toMessage(doc)).reverse();
  }

  async addMessage(input: {
    conversationId: string;
    role: Message['role'];
    content: string;
    provider?: string | null;
    model?: string | null;
    toolCalls?: unknown[];
    attachments?: Message['attachments'];
    tokens?: number | null;
  }): Promise<Message> {
    const messageId = id('msg');
    const ts = now();
    const doc: Doc = {
      _id: messageId,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      provider: input.provider ?? null,
      model: input.model ?? null,
      toolCalls: input.toolCalls ?? [],
      attachments: input.attachments ?? [],
      tokens: input.tokens ?? null,
      createdAt: ts,
    };
    await this.messages_.insertOne(doc);
    await this.conversations.updateOne({ _id: input.conversationId }, { $set: { updatedAt: ts } });
    return this.toMessage(doc);
  }

  async recentHistory(conversationId: string, limit = 12): Promise<Message[]> {
    return this.messages(conversationId, limit);
  }
}
