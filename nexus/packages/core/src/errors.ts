/** Structured error taxonomy — every failure in NEXUS carries a machine code. */

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PATH_OUTSIDE_PROJECT'
  | 'PATH_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_REJECTED'
  | 'COMMAND_BLOCKED'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_CAPABILITY_MISSING'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'AGENT_LIMIT_EXCEEDED'
  | 'TOOL_NOT_FOUND'
  | 'TOOL_TIMEOUT'
  | 'TOOL_FAILED'
  | 'TASK_STATE_INVALID'
  | 'STORAGE_ERROR'
  | 'BROWSER_UNAVAILABLE'
  | 'BROWSER_ACTION_FAILED'
  | 'SENSITIVE_DATA_BLOCKED'
  | 'FILE_TOO_LARGE'
  | 'CANCELLED'
  | 'INTERNAL';

export class NexusError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly httpStatus: number;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { retryable?: boolean; details?: unknown; httpStatus?: number; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'NexusError';
    this.code = code;
    this.retryable = opts.retryable ?? DEFAULT_RETRYABLE.has(code);
    this.details = opts.details;
    this.httpStatus = opts.httpStatus ?? DEFAULT_STATUS[code] ?? 500;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    };
  }
}

const DEFAULT_RETRYABLE = new Set<ErrorCode>([
  'PROVIDER_ERROR',
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  'TOOL_TIMEOUT',
  'STORAGE_ERROR',
  'INTERNAL',
]);

const DEFAULT_STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  PATH_NOT_FOUND: 404,
  CONFLICT: 409,
  PATH_OUTSIDE_PROJECT: 403,
  PERMISSION_DENIED: 403,
  APPROVAL_REQUIRED: 428,
  APPROVAL_REJECTED: 403,
  COMMAND_BLOCKED: 403,
  SENSITIVE_DATA_BLOCKED: 400,
  PROVIDER_NOT_CONFIGURED: 409,
  PROVIDER_CAPABILITY_MISSING: 400,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_TIMEOUT: 504,
  AGENT_LIMIT_EXCEEDED: 429,
  TASK_STATE_INVALID: 409,
  FILE_TOO_LARGE: 413,
  BROWSER_UNAVAILABLE: 503,
  CANCELLED: 499,
};

export function toNexusError(err: unknown): NexusError {
  if (err instanceof NexusError) return err;
  if (err instanceof Error) {
    return new NexusError('INTERNAL', err.message, { cause: err });
  }
  return new NexusError('INTERNAL', String(err));
}

/** Human-readable one-liner used by logs and the activity feed. */
export function describeError(err: unknown): string {
  const e = toNexusError(err);
  return `[${e.code}] ${e.message}`;
}
