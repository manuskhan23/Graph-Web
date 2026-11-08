/** Deterministic fake AI provider so agent/provider tests need no network. */
import type {
  AIProvider,
  CompletionRequest,
  CompletionResult,
  ProviderToolSchema,
} from '../src/providers/types.js';
import type { ProviderModelInfo } from '../src/types.js';

export interface MockScript {
  /** Match by purpose (chat, plan, report, ...) and return text. */
  [purpose: string]: string | ((request: CompletionRequest) => string);
}

export class MockProvider implements AIProvider {
  calls: CompletionRequest[] = [];

  constructor(
    readonly id: 'gemini' | 'groq',
    private script: MockScript = {},
    private configured = true,
    private modelsList?: ProviderModelInfo[],
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  models(): ProviderModelInfo[] {
    const base: ProviderModelInfo[] = [
      {
        provider: this.id,
        modelId: `${this.id}-mock`,
        label: `${this.id} mock`,
        capabilities: { text: true, vision: this.id === 'gemini', tools: true, json: true, embeddings: false, audio: false },
        contextWindow: 100_000,
        maxOutput: 8192,
        pricing: { input: 1, output: 2 },
      },
    ];
    return this.modelsList ?? base;
  }

  setScript(script: MockScript): void {
    this.script = script;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.calls.push(request);
    const entry = this.script[request.purpose];
    const text =
      typeof entry === 'function'
        ? entry(request)
        : entry ??
          `mock ${this.id} response for ${request.purpose}`;
    const toolNames: ProviderToolSchema[] = request.tools ?? [];
    void toolNames;
    return {
      text,
      toolCalls: [],
      model: request.model ?? `${this.id}-mock`,
      provider: this.id,
      usage: { inputTokens: 100, outputTokens: 50, source: 'provider' },
      latencyMs: 5,
      stopReason: 'stop',
    };
  }
}

/** Provider that always fails, to exercise fallback and error paths. */
export class FailingProvider implements AIProvider {
  constructor(readonly id: 'gemini' | 'groq', private message = 'provider exploded') {}
  isConfigured(): boolean {
    return true;
  }
  models(): ProviderModelInfo[] {
    return [];
  }
  async complete(): Promise<CompletionResult> {
    throw new Error(this.message);
  }
}
