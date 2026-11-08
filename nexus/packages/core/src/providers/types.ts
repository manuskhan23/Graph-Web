import type { ProviderId, ProviderModelInfo } from '../types.js';

export interface ContentPart {
  type: 'text' | 'image';
  text?: string;
  /** base64 (no data-url prefix) */
  data?: string;
  mimeType?: string;
}

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;
  name?: string;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  messages: ProviderMessage[];
  system?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for strict JSON when the model supports it. */
  json?: boolean;
  tools?: ProviderToolSchema[];
  timeoutMs?: number;
  /** Accounting label: chat, plan, agent.step, vision, embed, classify, … */
  purpose: string;
  /** Abort signal for task cancellation. */
  signal?: AbortSignal;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCallRequest[];
  model: string;
  provider: ProviderId;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    source: 'provider' | 'estimated';
  };
  latencyMs: number;
  stopReason: string | null;
}

export interface EmbeddingRequest {
  texts: string[];
  model?: string;
  purpose: string;
}

export interface EmbeddingResult {
  vectors: number[][];
  model: string;
  provider: ProviderId;
}

export interface AIProvider {
  readonly id: ProviderId;
  isConfigured(): boolean;
  models(): ProviderModelInfo[];
  complete(request: CompletionRequest): Promise<CompletionResult>;
  embed?(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

/** Injected so tests can run without network access. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
