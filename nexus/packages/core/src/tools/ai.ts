/** AI-facing tools: vision analysis and fast classification via the router. */
import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { VisionService } from '../vision/service.js';
import type { ModelRouter } from '../providers/router.js';
import { NexusError } from '../errors.js';

export function createAiTools(vision: VisionService, router: ModelRouter): ToolDefinition<unknown, unknown>[] {
  const analyzeImage: ToolDefinition<{ imagePath?: string; imageBase64?: string; prompt: string }, unknown> = {
    descriptor: {
      id: 'ai.analyzeImage',
      name: 'Analyze image',
      description:
        'Send a screenshot or image to a vision-capable Gemini model and get a UI/layout analysis with concrete fixes.',
      risk: 'low',
      category: 'ai',
      timeoutMs: 120_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: {
          imagePath: { type: 'string', description: 'Absolute path to a stored screenshot artifact' },
          imageBase64: { type: 'string', description: 'Base64 image data (no data-url prefix)' },
          prompt: { type: 'string' },
        },
        required: ['prompt'],
      },
      outputSchema: { type: 'object', properties: { analysis: { type: 'string' } } },
    },
    schema: z
      .object({
        imagePath: z.string().optional(),
        imageBase64: z.string().optional(),
        prompt: z.string().min(3),
      })
      .refine((v) => Boolean(v.imagePath || v.imageBase64), { message: 'imagePath or imageBase64 is required' }),
    outputSchema: z.object({ analysis: z.string(), model: z.string() }),
    allowedRoles: [],
    async execute(input, ctx) {
      const result = await vision.analyze({
        imagePath: input.imagePath,
        imageBase64: input.imageBase64,
        prompt: input.prompt,
        projectId: ctx.projectId,
      });
      return {
        ok: true,
        summary: `Vision analysis complete (${result.model})`,
        data: { analysis: result.analysis, model: result.model },
        observation: result.analysis,
      };
    },
  };

  const classify: ToolDefinition<{ text: string; labels: string[] }, unknown> = {
    descriptor: {
      id: 'ai.classify',
      name: 'Classify text',
      description: 'Fast single-label classification using Groq. Returns one of the provided labels plus a confidence note.',
      risk: 'low',
      category: 'ai',
      timeoutMs: 30_000,
      requiresProject: false,
      requiresApproval: false,
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string' }, labels: { type: 'array', items: { type: 'string' } } },
        required: ['text', 'labels'],
      },
      outputSchema: { type: 'object', properties: { label: { type: 'string' } } },
    },
    schema: z.object({ text: z.string().min(1), labels: z.array(z.string().min(1)).min(2).max(20) }),
    outputSchema: z.object({ label: z.string(), model: z.string(), raw: z.string() }),
    allowedRoles: [],
    async execute(input) {
      if (!router.provider('groq').isConfigured() && !router.provider('gemini').isConfigured()) {
        throw new NexusError('PROVIDER_NOT_CONFIGURED', 'No AI provider is configured');
      }
      const result = await router.complete(
        {
          system: `Classify the user text into exactly one of these labels: ${input.labels.join(', ')}. Reply with the label only.`,
          messages: [{ role: 'user', content: input.text.slice(0, 8000) }],
          purpose: 'classify',
          maxOutputTokens: 20,
          temperature: 0,
        },
        { capability: 'text', complexity: 'trivial', prefersLowLatency: true, purpose: 'classify' },
      );
      const raw = result.text.trim();
      const matched = input.labels.find((l) => raw.toLowerCase().includes(l.toLowerCase())) ?? input.labels[0]!;
      return {
        ok: true,
        summary: `Classified as ${matched}`,
        data: { label: matched, model: result.model, raw },
        observation: `Label: ${matched}`,
      };
    },
  };

  return [analyzeImage, classify] as ToolDefinition<unknown, unknown>[];
}
