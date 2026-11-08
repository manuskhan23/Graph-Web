/**
 * Section 7 — Intelligent model routing.
 *
 * Chooses Gemini or Groq from (a) required capabilities, (b) task complexity,
 * (c) latency preference and (d) user configuration. Fallback is attempted only
 * when the other provider *declares* the same capability, and never when the
 * privacy policy forbids cross-provider transfer of project data.
 */
import { NexusError, toNexusError } from '../errors.js';
import type { ProviderId, ProviderModelInfo, ProviderStatus } from '../types.js';
import type { ObservabilityRepository } from '../storage/repositories/observability.js';
import type { SettingsService } from '../settings/service.js';
import type { EventBus } from '../events/bus.js';
import type { AIProvider, CompletionRequest, CompletionResult, ProviderMessage } from './types.js';
import { GeminiProvider } from './gemini.js';
import { GroqProvider } from './groq.js';
import { findModel, modelsFor } from './models.js';

export type Capability = 'text' | 'vision' | 'tools' | 'json' | 'embeddings' | 'audio';

export type TaskComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';

export interface RouteRequest {
  capability?: Capability;
  complexity?: TaskComplexity;
  prefersLowLatency?: boolean;
  /** Project code context is being sent — respect the privacy policy. */
  containsProjectData?: boolean;
  purpose: string;
}

export interface RouteDecision {
  provider: ProviderId;
  modelId: string;
  reason: string;
  fallback: { provider: ProviderId; modelId: string } | null;
}

export interface RouterDeps {
  settings: SettingsService;
  observability: ObservabilityRepository;
  /** Secret accessor (never returns a value to the UI). */
  getKey: (provider: ProviderId) => string | null;
  events?: EventBus;
  providers?: Partial<Record<ProviderId, AIProvider>>;
}

export class ModelRouter {
  private readonly providers: Record<ProviderId, AIProvider>;
  private lastError: Record<ProviderId, string | null> = { gemini: null, groq: null };

  constructor(private readonly deps: RouterDeps) {
    const getKey = deps.getKey;
    this.providers = {
      gemini: deps.providers?.gemini ?? new GeminiProvider(() => getKey('gemini')),
      groq: deps.providers?.groq ?? new GroqProvider(() => getKey('groq')),
    };
  }

  status(): ProviderStatus[] {
    const settings = this.deps.settings.get().ai;
    return (['gemini', 'groq'] as ProviderId[]).map((provider) => ({
      provider,
      configured: this.providers[provider].isConfigured(),
      models: modelsFor(provider),
      defaultModel: provider === 'gemini' ? settings.geminiModel : settings.groqModel,
      lastError: this.lastError[provider],
    }));
  }

  provider(id: ProviderId): AIProvider {
    return this.providers[id];
  }

  configuredProviders(): ProviderId[] {
    return (['gemini', 'groq'] as ProviderId[]).filter((p) => this.providers[p].isConfigured());
  }

  /** Pure decision function — unit-testable without network. */
  decide(request: RouteRequest): RouteDecision {
    const settings = this.deps.settings.get().ai;
    const capability = request.capability ?? 'text';
    const complexity = request.complexity ?? 'moderate';

    const supports = (provider: ProviderId, modelId: string): boolean => {
      const model = findModel(provider, modelId);
      return Boolean(model?.capabilities[capability]);
    };

    const isConfigured = (provider: ProviderId) => this.providers[provider].isConfigured();

    const geminiModel = settings.geminiModel;
    const groqModel = settings.groqModel;

    // Vision and heavy planning/architecture work are Gemini-only by spec.
    const geminiPreferred =
      capability === 'vision' ||
      capability === 'embeddings' ||
      complexity === 'complex' ||
      (!settings.allowCrossProviderFallback && settings.defaultProvider === 'gemini') ||
      settings.defaultProvider === 'gemini';

    let primary: ProviderId = geminiPreferred ? 'gemini' : 'groq';
    const requiresGeminiOnly = capability === 'vision' || capability === 'embeddings';
    if (requiresGeminiOnly) primary = 'gemini';
    else if (complexity === 'complex') primary = 'gemini';
    else if (request.prefersLowLatency && isConfigured('groq') && supports('groq', groqModel)) primary = 'groq';
    else if (!isConfigured(primary)) primary = isConfigured('gemini') ? 'gemini' : 'groq';

    if (requiresGeminiOnly && !isConfigured('gemini')) {
      throw new NexusError(
        'PROVIDER_NOT_CONFIGURED',
        `${capability} requires Google Gemini, which is not configured`,
        { httpStatus: 409 },
      );
    }

    const modelFor = (provider: ProviderId): string => {
      if (capability === 'embeddings') return 'text-embedding-004';
      if (capability === 'vision') return 'gemini-2.5-flash';
      return provider === 'gemini' ? geminiModel : groqModel;
    };

    const primaryModel = modelFor(primary);
    if (!supports(primary, primaryModel)) {
      // pick another model within the same provider that supports the capability
      const alt = modelsFor(primary).find((m) => m.capabilities[capability]);
      if (!alt) {
        throw new NexusError('PROVIDER_CAPABILITY_MISSING', `No ${primary} model supports ${capability}`);
      }
      return {
        provider: primary,
        modelId: alt.modelId,
        reason: `${primary} has no capable default model for ${capability}; using ${alt.modelId}`,
        fallback: null,
      };
    }

    let fallback: RouteDecision['fallback'] = null;
    const other: ProviderId = primary === 'gemini' ? 'groq' : 'gemini';
    const otherModel = modelFor(other);
    const privacyOk = !request.containsProjectData || settings.allowCrossProviderFallback;
    if (settings.allowCrossProviderFallback && privacyOk && isConfigured(other) && supports(other, otherModel)) {
      fallback = { provider: other, modelId: otherModel };
    }

    return {
      provider: primary,
      modelId: primaryModel,
      reason: `capability=${capability} complexity=${complexity} provider=${primary}`,
      fallback,
    };
  }

  /**
   * Execute a completion with routing, usage accounting and capability-safe fallback.
   */
  async complete(request: CompletionRequest, route: RouteRequest): Promise<CompletionResult> {
    const decision = this.decide(route);
    const candidates: { provider: ProviderId; modelId: string }[] = [
      { provider: decision.provider, modelId: decision.modelId },
    ];
    if (decision.fallback) candidates.push(decision.fallback);

    let lastErr: unknown = null;
    for (const [index, candidate] of candidates.entries()) {
      const provider = this.providers[candidate.provider];
      if (!provider.isConfigured()) {
        lastErr = new NexusError('PROVIDER_NOT_CONFIGURED', `${candidate.provider} is not configured`);
        continue;
      }
      try {
        const result = await provider.complete({ ...request, model: candidate.modelId });
        this.lastError[candidate.provider] = null;
        this.recordUsage(result, request.purpose);
        if (index > 0) {
          this.deps.events?.emit(
            'provider.fallback',
            `Fell back to ${candidate.provider}/${candidate.modelId}`,
            { from: decision.provider, to: candidate.provider, purpose: request.purpose },
          );
        }
        return result;
      } catch (err) {
        lastErr = err;
        const nexus = toNexusError(err);
        this.lastError[candidate.provider] = nexus.message;
        this.recordFailure(candidate, request.purpose, nexus.code);
        this.deps.observability.addActivity({
          kind: 'provider',
          level: 'warn',
          title: `Provider failure: ${candidate.provider}`,
          detail: nexus.message,
          projectId: null,
          taskId: null,
          provider: candidate.provider,
          status: nexus.code,
        });
        // Capability errors and missing keys are not worth retrying elsewhere
        // unless a fallback candidate exists.
        if (!nexus.retryable && nexus.code !== 'PROVIDER_NOT_CONFIGURED') break;
      }
    }
    throw toNexusError(lastErr ?? new NexusError('PROVIDER_ERROR', 'No provider could serve the request'));
  }

  async embed(texts: string[], purpose = 'embed'): Promise<number[][]> {
    const provider = this.providers.gemini;
    if (!provider.isConfigured() || !provider.embed) {
      throw new NexusError('PROVIDER_NOT_CONFIGURED', 'Gemini embeddings are unavailable (no API key)');
    }
    const result = await provider.embed({ texts, purpose });
    this.deps.observability.recordUsage({
      provider: 'gemini',
      modelId: result.model,
      purpose,
      inputTokens: null,
      outputTokens: null,
      tokensSource: 'estimated',
      latencyMs: 0,
      ok: true,
      errorClass: null,
      costUsd: null,
    });
    return result.vectors;
  }

  private recordUsage(result: CompletionResult, purpose: string): void {
    const model = findModel(result.provider, result.model);
    const cost =
      model?.pricing && result.usage.inputTokens !== null && result.usage.outputTokens !== null
        ? (result.usage.inputTokens / 1_000_000) * model.pricing.input +
          (result.usage.outputTokens / 1_000_000) * model.pricing.output
        : null;
    this.deps.observability.recordUsage({
      provider: result.provider,
      modelId: result.model,
      purpose,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      tokensSource: result.usage.source,
      latencyMs: result.latencyMs,
      ok: true,
      errorClass: null,
      costUsd: cost,
    });
  }

  private recordFailure(candidate: { provider: ProviderId; modelId: string }, purpose: string, errorClass: string): void {
    this.deps.observability.recordUsage({
      provider: candidate.provider,
      modelId: candidate.modelId,
      purpose,
      inputTokens: null,
      outputTokens: null,
      tokensSource: 'estimated',
      latencyMs: 0,
      ok: false,
      errorClass,
      costUsd: null,
    });
  }
}

/** Heuristic complexity classifier (local, no network) used before planning. */
export function classifyComplexity(message: string): TaskComplexity {
  const text = message.toLowerCase();
  const words = text.split(/\s+/).filter(Boolean).length;
  const multiStepSignals = [
    'then', 'after that', 'and also', 'step', 'refactor', 'implement', 'architecture',
    'migrate', 'test', 'debug', 'all files', 'entire', 'project', 'integrate', 'authentication',
    'deploy', 'workflow', 'multiple', 'plan',
  ];
  // Word-boundary matching: substring matching produced false positives
  // ("authentication" contains "then").
  const hits = multiStepSignals.filter((signal) =>
    new RegExp(`(^|[^a-z])${signal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(text),
  ).length;
  if (words > 120 || hits >= 4) return 'complex';
  if (words > 40 || hits >= 2) return 'moderate';
  if (words > 12) return 'simple';
  return 'trivial';
}

export async function summarizeForContext(
  router: ModelRouter,
  messages: ProviderMessage[],
  purpose = 'summarize',
): Promise<CompletionResult> {
  return router.complete(
    { messages, purpose, maxOutputTokens: 700, temperature: 0.2, timeoutMs: 30_000 },
    { capability: 'text', complexity: 'simple', prefersLowLatency: true, purpose },
  );
}

export type { ProviderModelInfo };
