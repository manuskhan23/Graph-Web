/**
 * Groq provider (OpenAI-compatible REST endpoint, no third-party SDK).
 * Fast inference, classification, short answers, and audio transcription.
 * Vision/tool support is declared per model and validated by the router.
 */
import { NexusError } from '../errors.js';
import type { ProviderModelInfo } from '../types.js';
import { GROQ_MODELS, estimateTokens, findModel } from './models.js';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  FetchLike,
  ProviderMessage,
  ProviderToolSchema,
} from './types.js';

const BASE_URL = 'https://api.groq.com/openai/v1';

interface GroqChoice {
  message?: {
    content?: string;
    tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  };
  finish_reason?: string;
}

interface GroqResponse {
  choices?: GroqChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

export class GroqProvider implements AIProvider {
  readonly id = 'groq' as const;

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  isConfigured(): boolean {
    return this.getKey() !== null;
  }

  models(): ProviderModelInfo[] {
    return GROQ_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const key = this.getKey();
    if (!key) {
      throw new NexusError('PROVIDER_NOT_CONFIGURED', 'Groq API key is not configured', { httpStatus: 409 });
    }
    const modelId = request.model ?? GROQ_MODELS[0]!.modelId;
    const model = findModel('groq', modelId);
    if (!model) throw new NexusError('VALIDATION_FAILED', `Unknown Groq model: ${modelId}`);
    if (!model.capabilities.text) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} is not a text-generation model`);
    }
    const hasImage = request.messages.some((m) => Array.isArray(m.content));
    if (hasImage && !model.capabilities.vision) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} does not support images`);
    }
    if (request.tools?.length && !model.capabilities.tools) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} does not support tool calling`);
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages: toGroqMessages(request),
      temperature: request.temperature ?? 0.4,
      max_completion_tokens: Math.min(request.maxOutputTokens ?? 4096, model.maxOutput),
    };
    if (request.json && model.capabilities.json) body.response_format = { type: 'json_object' };
    if (request.tools?.length) {
      body.tools = request.tools.map(toGroqTool);
      body.tool_choice = 'auto';
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 45_000);
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const aborted = (err as Error).name === 'AbortError';
      throw new NexusError(
        aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
        aborted ? 'Groq request timed out' : `Groq request failed: ${(err as Error).message}`,
        { retryable: true, cause: err },
      );
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startedAt;
    const payload = (await safeJson(response)) as GroqResponse;
    if (!response.ok) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      const code = response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw new NexusError(code as never, `Groq: ${message}`, {
        retryable: response.status >= 500 || response.status === 429,
      });
    }

    const choice = payload.choices?.[0];
    const text = choice?.message?.content ?? '';
    const toolCalls = (choice?.message?.tool_calls ?? []).map((call, index) => ({
      id: call.id || `groq_call_${index}_${Date.now().toString(36)}`,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    }));

    return {
      text,
      toolCalls,
      model: modelId,
      provider: 'groq',
      usage: payload.usage?.prompt_tokens !== undefined
        ? {
            inputTokens: payload.usage.prompt_tokens ?? null,
            outputTokens: payload.usage.completion_tokens ?? null,
            source: 'provider',
          }
        : {
            inputTokens: estimateTokens(JSON.stringify(request.messages)),
            outputTokens: estimateTokens(text),
            source: 'estimated',
          },
      latencyMs,
      stopReason: choice?.finish_reason ?? null,
    };
  }
}

function toGroqMessages(request: CompletionRequest) {
  const messages: Record<string, unknown>[] = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const m of request.messages) {
    messages.push({
      role: m.role === 'tool' ? 'tool' : m.role,
      content: typeof m.content === 'string' ? m.content : flattenParts(m),
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      ...(m.name ? { name: m.name } : {}),
    });
  }
  return messages;
}

function flattenParts(message: ProviderMessage): string {
  if (typeof message.content === 'string') return message.content;
  return message.content.map((p) => (p.type === 'text' ? p.text ?? '' : '[image omitted: model has no vision support]')).join('\n');
}

function toGroqTool(tool: ProviderToolSchema) {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function safeJson(response: Response): Promise<GroqResponse> {
  try {
    return (await response.json()) as GroqResponse;
  } catch {
    return {};
  }
}
