/**
 * Filesystem path guard.
 *
 * Every file operation in NEXUS funnels through here. It resolves symlinks,
 * rejects traversal, rejects absolute paths that escape the project root, and
 * refuses to touch secret or binary files.
 */
import { realpathSync, statSync, existsSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { BINARY_EXTENSIONS, config } from '../config.js';
import { NexusError } from '../errors.js';

export interface PathGuardOptions {
  /** Extra relative paths that may not be touched (e.g. .env, secrets). */
  denyPatterns?: RegExp[];
  allowOutsideRoot?: boolean;
}

const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|[/\\])\.env(\.|$)/i,
  /(^|[/\\])(\.npmrc|\.netrc|\.git-credentials)$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /(^|[/\\])id_(rsa|ed25519|ecdsa)/i,
  /(^|[/\\])credentials(\.json)?$/i,
  /(^|[/\\])secrets?\.(json|ya?ml|toml)$/i,
];

/**
 * Resolve `relPath` inside `root` and prove it cannot escape.
 * Throws PATH_OUTSIDE_PROJECT for escapes and PATH_NOT_FOUND when missing.
 */
export function resolveInsideProject(root: string, relPath: string): string {
  if (typeof relPath !== 'string' || relPath.length === 0) {
    throw new NexusError('VALIDATION_FAILED', 'A relative path is required');
  }
  if (relPath.includes('\0')) {
    throw new NexusError('VALIDATION_FAILED', 'Path contains a null byte');
  }
  if (isAbsolute(relPath)) {
    // Allow it only when it points inside the root already.
    const abs = normalize(relPath);
    if (!isInside(root, abs)) {
      throw new NexusError('PATH_OUTSIDE_PROJECT', `Absolute path escapes project root: ${relPath}`);
    }
    return assertNoSecret(abs);
  }
  const rootAbs = resolve(root);
  const candidate = resolve(rootAbs, normalize(relPath));
  if (!isInside(rootAbs, candidate)) {
    throw new NexusError('PATH_OUTSIDE_PROJECT', `Path escapes project root: ${relPath}`);
  }
  return assertNoSecret(candidate);
}

/** Follow symlinks where the path exists and re-verify containment. */
export function resolveInsideProjectReal(root: string, relPath: string): string {
  const candidate = resolveInsideProject(root, relPath);
  if (!existsSync(candidate)) return candidate;
  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    return candidate;
  }
  const realRoot = safeRealpath(root);
  if (!isInside(realRoot, real)) {
    throw new NexusError('PATH_OUTSIDE_PROJECT', `Symlink escapes project root: ${relPath}`);
  }
  return real;
}

export function assertNoSecret(absPath: string): string {
  for (const pattern of SECRET_PATH_PATTERNS) {
    if (pattern.test(absPath)) {
      throw new NexusError('SENSITIVE_DATA_BLOCKED', 'Refusing to read or write a secret file', {
        details: { path: absPath },
      });
    }
  }
  return absPath;
}

export function isSecretPath(relPath: string): boolean {
  return SECRET_PATH_PATTERNS.some((p) => p.test(relPath));
}

export function isBinaryPath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(lower.slice(dot));
}

export function isInside(root: string, candidate: string): boolean {
  const rootAbs = resolve(root);
  const rel = relative(rootAbs, resolve(candidate));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function toRelative(root: string, absPath: string): string {
  const rel = relative(resolve(root), resolve(absPath));
  return rel.split(sep).join('/');
}

export function assertReadableFile(root: string, relPath: string): { absPath: string; size: number } {
  const absPath = resolveInsideProjectReal(root, relPath);
  if (!existsSync(absPath)) {
    throw new NexusError('PATH_NOT_FOUND', `File not found: ${relPath}`);
  }
  const stat = statSync(absPath);
  if (!stat.isFile()) {
    throw new NexusError('VALIDATION_FAILED', `Not a file: ${relPath}`);
  }
  if (stat.size > config.limits.maxFileBytes) {
    throw new NexusError('FILE_TOO_LARGE', `File exceeds ${config.limits.maxFileBytes} bytes: ${relPath}`, {
      details: { size: stat.size },
    });
  }
  if (isBinaryPath(relPath)) {
    throw new NexusError('VALIDATION_FAILED', `Binary files cannot be read as text: ${relPath}`);
  }
  return { absPath, size: stat.size };
}

/** Validate a directory that a user wants to register as a project. */
export function assertProjectRoot(dirPath: string): string {
  if (!dirPath || typeof dirPath !== 'string') {
    throw new NexusError('VALIDATION_FAILED', 'Project directory is required');
  }
  const abs = resolve(dirPath);
  if (!existsSync(abs)) {
    throw new NexusError('PATH_NOT_FOUND', `Directory does not exist: ${abs}`);
  }
  const stat = statSync(abs);
  if (!stat.isDirectory()) {
    throw new NexusError('VALIDATION_FAILED', `Not a directory: ${abs}`);
  }
  return safeRealpath(abs);
}

export function joinRelative(root: string, relPath: string): string {
  return join(root, relPath);
}

function safeRealpath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}
