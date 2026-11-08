/**
 * Phase 8 — Vision and multimodal intelligence (Gemini only).
 *
 * Accepts base64 images or artifact paths, sends them to a vision-capable Gemini
 * model, and returns a structured analysis. The router enforces that the chosen
 * model actually declares vision support, so this can never silently fall back to
 * a text-only model.
 */
import { readFileSync, existsSync } from 'node:fs';
import { NexusError } from '../errors.js';
import { config } from '../config.js';
import type { ModelRouter } from '../providers/router.js';
import type { ObservabilityStore } from '../storage/contracts.js';

export interface VisionInput {
  imageBase64?: string;
  imagePath?: string;
  mimeType?: string;
  prompt: string;
  projectId?: string | null;
}

export interface VisionResult {
  analysis: string;
  model: string;
  provider: 'gemini';
  latencyMs: number;
  imageBytes: number;
}

const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export class VisionService {
  constructor(
    private readonly router: ModelRouter,
    private readonly observability: ObservabilityStore,
  ) {}

  async analyze(input: VisionInput): Promise<VisionResult> {
    if (!input.prompt || input.prompt.trim().length < 3) {
      throw new NexusError('VALIDATION_FAILED', 'A prompt describing what to analyse is required');
    }
    let base64 = input.imageBase64;
    let mimeType = input.mimeType ?? 'image/png';
    let bytes = 0;

    if (!base64 && input.imagePath) {
      if (!existsSync(input.imagePath)) {
        throw new NexusError('PATH_NOT_FOUND', `Image not found: ${input.imagePath}`);
      }
      const buffer = readFileSync(input.imagePath);
      if (buffer.length > config.limits.maxUploadBytes) {
        throw new NexusError('FILE_TOO_LARGE', 'Image exceeds the upload limit');
      }
      base64 = buffer.toString('base64');
      bytes = buffer.length;
      if (input.imagePath.endsWith('.jpg') || input.imagePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (input.imagePath.endsWith('.webp')) mimeType = 'image/webp';
      else if (input.imagePath.endsWith('.gif')) mimeType = 'image/gif';
    }
    if (!base64) throw new NexusError('VALIDATION_FAILED', 'An image (base64 or path) is required');
    if (!SUPPORTED_MIME.has(mimeType)) {
      throw new NexusError('VALIDATION_FAILED', `Unsupported image type: ${mimeType}`);
    }
    bytes = bytes || Math.floor((base64.length * 3) / 4);

    const startedAt = Date.now();
    const result = await this.router.complete(
      {
        system:
          'You are NEXUS AI analysing a screenshot of a user interface. Describe precisely what you see, then identify concrete visual or layout defects, and end with an actionable list of fixes. If the image is not a UI, say so and describe it factually. Never invent details you cannot see.',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: input.prompt },
              { type: 'image', data: base64, mimeType },
            ],
          },
        ],
        purpose: 'vision',
        maxOutputTokens: 2048,
        temperature: 0.2,
        timeoutMs: 90_000,
      },
      { capability: 'vision', complexity: 'moderate', purpose: 'vision', containsProjectData: Boolean(input.projectId) },
    );

    await this.observability.addActivity({
      kind: 'provider',
      level: 'info',
      title: 'Vision analysis',
      detail: `${input.prompt.slice(0, 120)} (${(bytes / 1024).toFixed(0)} KB)`,
      projectId: input.projectId ?? null,
      taskId: null,
      provider: 'gemini',
      status: 'completed',
    });

    return {
      analysis: result.text,
      model: result.model,
      provider: 'gemini',
      latencyMs: Date.now() - startedAt,
      imageBytes: bytes,
    };
  }
}
