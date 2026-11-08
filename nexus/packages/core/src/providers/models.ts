/**
 * Model registry with explicit capability declarations.
 *
 * NEXUS never assumes a fallback model supports the same features as the primary.
 * A request that needs vision or tool-calling is validated against these records
 * *before* any HTTP call is made.
 *
 * VERIFIED against the live provider documentation on 2026-11-08:
 *   Gemini  https://ai.google.dev/gemini-api/docs/models
 *   Groq    https://console.groq.com/docs/deprecations
 *
 * Two retired IDs were previously listed here and would have failed at runtime
 * with a 404 from the provider:
 *   - gemini-2.5-pro / gemini-2.5-flash  deprecated; auto-route to gemini-3.8-flash
 *     and gemini-3.5-flash-lite on 2026-12-01. Limited to existing users now.
 *   - text-embedding-004                 superseded by gemini-embedding-001.
 *   - llama-3.3-70b-versatile            shutdown 2026-08-16.
 * Check this file against the provider docs before shipping a release; model IDs
 * move faster than application code.
 */
import type { ProviderId, ProviderModelInfo } from '../types.js';

export const GEMINI_MODELS: ProviderModelInfo[] = [
  {
    provider: 'gemini',
    modelId: 'gemini-3.8-flash',
    label: 'Gemini 3.8 Flash',
    capabilities: { text: true, vision: true, tools: true, json: true, embeddings: false, audio: true },
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    // List price at time of writing; treated as an estimate only.
    pricing: { input: 0.75, output: 3.75 },
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.6-flash',
    label: 'Gemini 3.6 Flash (previous gen)',
    capabilities: { text: true, vision: true, tools: true, json: true, embeddings: false, audio: true },
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    pricing: { input: 0.75, output: 3.75 },
  },
  {
    provider: 'gemini',
    modelId: 'gemini-3.1-pro-preview',
    label: 'Gemini 3.1 Pro (preview)',
    capabilities: { text: true, vision: true, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    pricing: { input: 2, output: 12 },
  },
  {
    provider: 'gemini',
    modelId: 'gemini-embedding-001',
    label: 'Gemini Embedding',
    capabilities: { text: false, vision: false, tools: false, json: false, embeddings: true, audio: false },
    contextWindow: 2_048,
    maxOutput: 1,
    pricing: null,
  },
  {
    provider: 'gemini',
    modelId: 'gemini-embedding-2',
    label: 'Gemini Embedding 2 (multimodal)',
    capabilities: { text: false, vision: false, tools: false, json: false, embeddings: true, audio: false },
    contextWindow: 8_192,
    maxOutput: 1,
    pricing: null,
  },
];

export const GROQ_MODELS: ProviderModelInfo[] = [
  {
    provider: 'groq',
    modelId: 'openai/gpt-oss-120b',
    label: 'GPT-OSS 120B (Groq)',
    capabilities: { text: true, vision: false, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 131_072,
    maxOutput: 32_768,
    pricing: { input: 0.15, output: 0.75 },
  },
  {
    provider: 'groq',
    modelId: 'openai/gpt-oss-20b',
    label: 'GPT-OSS 20B (Groq)',
    capabilities: { text: true, vision: false, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 131_072,
    maxOutput: 65_536,
    pricing: { input: 0.075, output: 0.3 },
  },
  {
    provider: 'groq',
    modelId: 'qwen/qwen3.6-27b',
    label: 'Qwen 3.6 27B (Groq)',
    capabilities: { text: true, vision: false, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 131_072,
    maxOutput: 32_768,
    pricing: null,
  },
  {
    provider: 'groq',
    modelId: 'whisper-large-v3-turbo',
    label: 'Whisper Large v3 Turbo (Groq)',
    capabilities: { text: false, vision: false, tools: false, json: false, embeddings: false, audio: true },
    contextWindow: 0,
    maxOutput: 0,
    pricing: null,
  },
];

export const ALL_MODELS: ProviderModelInfo[] = [...GEMINI_MODELS, ...GROQ_MODELS];

export const DEFAULT_MODELS = {
  gemini: GEMINI_MODELS[0]!,
  groq: GROQ_MODELS[0]!,
} as const;

export const VISION_MODEL = 'gemini-3.8-flash';
export const EMBEDDING_MODEL = 'gemini-embedding-001';

export function findModel(provider: ProviderId, modelId: string): ProviderModelInfo | null {
  const list = provider === 'gemini' ? GEMINI_MODELS : GROQ_MODELS;
  return list.find((m) => m.modelId === modelId) ?? null;
}

export function modelsFor(provider: ProviderId): ProviderModelInfo[] {
  return provider === 'gemini' ? GEMINI_MODELS : GROQ_MODELS;
}

/** Cheap local token estimate (4 chars ≈ 1 token) used only when a provider
 *  does not report usage. Never labelled as provider-reported. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
