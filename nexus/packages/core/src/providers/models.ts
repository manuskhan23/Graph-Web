/**
 * Model registry with explicit capability declarations.
 *
 * NEXUS never assumes a fallback model supports the same features as the primary.
 * A request that needs vision or tool-calling is validated against these records
 * *before* any HTTP call is made.
 */
import type { ProviderId, ProviderModelInfo } from '../types.js';

export const GEMINI_MODELS: ProviderModelInfo[] = [
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    capabilities: { text: true, vision: true, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    // Public list price at time of writing; treated as an estimate only.
    pricing: { input: 1.25, output: 10 },
  },
  {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    capabilities: { text: true, vision: true, tools: true, json: true, embeddings: false, audio: true },
    contextWindow: 1_048_576,
    maxOutput: 65_536,
    pricing: { input: 0.3, output: 2.5 },
  },
  {
    provider: 'gemini',
    modelId: 'text-embedding-004',
    label: 'Gemini Embedding 004',
    capabilities: { text: false, vision: false, tools: false, json: false, embeddings: true, audio: false },
    contextWindow: 2_048,
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
    modelId: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B (Groq)',
    capabilities: { text: true, vision: false, tools: true, json: true, embeddings: false, audio: false },
    contextWindow: 131_072,
    maxOutput: 32_768,
    pricing: { input: 0.59, output: 0.79 },
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

export const VISION_MODEL = 'gemini-2.5-flash';
export const EMBEDDING_MODEL = 'text-embedding-004';

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
