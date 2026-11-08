/** Shared HTTP helpers: error mapping, async wrapper, validation. */
import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { NexusError, toNexusError } from '../../core/src/errors.js';
import type { ApiErrorBody } from '../../core/src/types.js';

export function sendError(res: Response, err: unknown): void {
  const nexus = toNexusError(err);
  const body: ApiErrorBody = { error: nexus.toJSON() as ApiErrorBody['error'] };
  res.status(nexus.httpStatus).json(body);
}

export function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown> | unknown,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    throw new NexusError('VALIDATION_FAILED', describeZod(result.error), {
      details: result.error.flatten(),
    });
  }
  return result.data;
}

export function describeZod(error: ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ');
}

export function requireParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!value || typeof value !== 'string') {
    throw new NexusError('VALIDATION_FAILED', `Missing path parameter: ${name}`);
  }
  return value;
}
