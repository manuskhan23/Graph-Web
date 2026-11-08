/**
 * Google Gemini provider (official REST API, no third-party SDK).
 * Supports text, vision (inline base64 images), function calling, JSON mode and
 * embeddings. Capabilities are declared in the model registry and validated by
 * the router before this class is ever called.
 */
import { NexusError } from '../errors.js';
import type { ProviderModelInfo } from '../types.js';
import { EMBEDDING_MODEL, GEMINI_MODELS, estimateTokens, findModel } from './models.js';
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  EmbeddingRequest,
  EmbeddingResult,
  FetchLike,
  ProviderMessage,
  ProviderToolSchema,
} from './types.js';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
  error?: { message?: string; status?: string; code?: number };
}

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;

  constructor(
    private readonly getKey: () => string | null,
    private readonly fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  ) {}

  isConfigured(): boolean {
    return this.getKey() !== null;
  }

  models(): ProviderModelInfo[] {
    return GEMINI_MODELS;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const key = this.getKey();
    if (!key) {
      throw new NexusError('PROVIDER_NOT_CONFIGURED', 'Gemini API key is not configured', { httpStatus: 409 });
    }
    const modelId = request.model ?? GEMINI_MODELS[0]!.modelId;
    const model = findModel('gemini', modelId);
    if (!model) throw new NexusError('VALIDATION_FAILED', `Unknown Gemini model: ${modelId}`);
    if (!model.capabilities.text) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} does not support text generation`);
    }
    const hasImage = request.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'),
    );
    if (hasImage && !model.capabilities.vision) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} does not support vision input`);
    }
    if (request.tools?.length && !model.capabilities.tools) {
      throw new NexusError('PROVIDER_CAPABILITY_MISSING', `${modelId} does not support tool calling`);
    }

    const body: Record<string, unknown> = {
      contents: toGeminiContents(request.messages),
      generationConfig: {
        temperature: request.temperature ?? 0.4,
        maxOutputTokens: Math.min(request.maxOutputTokens ?? 4096, model.maxOutput),
      },
    };
    if (request.system) {
      body.systemInstruction = { role: 'system', parts: [{ text: request.system }] };
    }
    if (request.json && model.capabilities.json) {
      (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
    }
    if (request.tools?.length) {
      body.tools = [{ functionDeclarations: request.tools.map(toFunctionDeclaration) }];
    }

    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 60_000);
    request.signal?.addEventListener('abort', () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(`${BASE_URL}/models/${modelId}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const aborted = (err as Error).name === 'AbortError';
      throw new NexusError(aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR', aborted ? 'Gemini request timed out' : `Gemini request failed: ${(err as Error).message}`, {
        retryable: true,
        cause: err,
      });
    } finally {
      clearTimeout(timeout);
    }

    const latencyMs = Date.now() - startedAt;
    const payload = (await safeJson(response)) as GeminiResponse;

    if (!response.ok) {
      const message = payload?.error?.message ?? `HTTP ${response.status}`;
      const code = response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_ERROR';
      throw new NexusError(code as never, `Gemini: ${message}`, { retryable: response.status >= 500 || response.status === 429 });
    }

    const candidate = payload.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === 'string').map((p) => p.text!).join('');
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, index) => ({
        id: `gemini_call_${index}_${Date.now().toString(36)}`,
        name: p.functionCall!.name,
        arguments: p.functionCall!.args ?? {},
      }));

    const usageMeta = payload.usageMetadata;
    return {
      text,
      toolCalls,
      model: modelId,
      provider: 'gemini',
      usage: usageMeta?.promptTokenCount !== undefined
        ? {
            inputTokens: usageMeta.promptTokenCount ?? null,
            outputTokens: usageMeta.candidatesTokenCount ?? null,
            source: 'provider',
          }
        : {
            inputTokens: estimateTokens(JSON.stringify(request.messages)),
            outputTokens: estimateTokens(text),
            source: 'estimated',
          },
      latencyMs,
      stopReason: candidate?.finishReason ?? null,
    };
  }

  /** Embeddings require a model that is declared as supporting them. */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const key = this.getKey();
    if (!key) throw new NexusError('PROVIDER_NOT_CONFIGURED', 'Gemini API key is not configured');
    const modelId = request.model ?? EMBEDDING_MODEL;
    const response = await this.fetchImpl(`${BASE_URL}/models/${modelId}:batchEmbedContents?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        requests: request.texts.map((text) => ({
          model: `models/${modelId}`,
          content: { parts: [{ text }] },
        })),
      }),
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new NexusError('PROVIDER_ERROR', `Gemini embeddings failed: ${detail.slice(0, 300)}`, { retryable: true });
    }
    const payload = (await response.json()) as { embeddings?: { values: number[] }[] };
    return {
      vectors: (payload.embeddings ?? []).map((e) => e.values),
      model: modelId,
      provider: 'gemini',
    };
  }
}

function toGeminiContents(messages: ProviderMessage[]) {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toParts(m),
    }));
}

function toParts(message: ProviderMessage): GeminiPart[] {
  if (typeof message.content === 'string') return [{ text: message.content }];
  return message.content.map((part) =>
    part.type === 'image'
      ? { inlineData: { mimeType: part.mimeType ?? 'image/png', data: part.data ?? '' } }
      : { text: part.text ?? '' },
  );
}

function toFunctionDeclaration(tool: ProviderToolSchema) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

async function safeJson(response: Response): Promise<GeminiResponse> {
  try {
    return (await response.json()) as GeminiResponse;
  } catch {
    return {};
  }
}
