/**
 * Phase 1 — Codebase scanning with incremental indexing.
 *
 * Walks a project root respecting ignore rules, hashes each candidate file, and
 * computes the added/modified/removed/unchanged delta against the stored index.
 * The walk never follows symlinks out of the root and never reads file bodies
 * here — the indexer does that for changed files only.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { BUILTIN_IGNORE_GLOBS, config } from '../config.js';
import { isBinaryPath, isSecretPath, resolveInsideProject } from '../security/paths.js';
import { IgnoreMatcher, parseGitignore } from './ignore.js';
import { detectLanguage } from './languages.js';

export interface WalkEntry {
  relPath: string;
  absPath: string;
  size: number;
  language: string;
  mtimeMs: number;
}

export interface WalkOptions {
  maxFiles?: number;
  includeGitignore?: boolean;
}

export function buildIgnoreMatcher(root: string, projectGlobs: string[] = [], options: WalkOptions = {}): IgnoreMatcher {
  const globs = [...BUILTIN_IGNORE_GLOBS,  ...projectGlobs];
  if (options.includeGitignore !== false) {
    const gitignore = join(root, '.gitignore');
    if (existsSync(gitignore)) {
      try {
        globs.push(...parseGitignore(readFileSync(gitignore, 'utf8')));
      } catch {
        /* unreadable .gitignore is not fatal */
      }
    }
  }
  return new IgnoreMatcher(globs);
}

/** Walk a project and return every indexable file. */
export function walkProject(root: string, projectGlobs: string[] = [], options: WalkOptions = {}): WalkEntry[] {
  const matcher = buildIgnoreMatcher(root, projectGlobs, options);
  const maxFiles = options.maxFiles ?? 20_000;
  const out: WalkEntry[] = [];
  const stack: string[] = [root];

  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (out.length >= maxFiles) return out;
      const absPath = join(dir, name);
      const relPath = relative(root, absPath).split(sep).join('/');
      if (matcher.ignores(relPath)) continue;
      let stat;
      try {
        stat = statSync(absPath, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (!stat) continue;
      if (stat.isSymbolicLink?.()) continue;
      if (stat.isDirectory()) {
        stack.push(absPath);
        continue;
      }
      if (!stat.isFile()) continue;
      if (isSecretPath(relPath) || isBinaryPath(relPath) || name.startsWith('.')) continue;
      if (stat.size > config.limits.maxFileBytes) continue;
      out.push({
        relPath,
        absPath,
        size: stat.size,
        language: detectLanguage(relPath),
        mtimeMs: stat.mtimeMs,
      });
    }
  }
  return out;
}

export function hashContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function hashFile(absPath: string): string {
  return hashContent(readFileSync(absPath));
}

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  let lines = 1;
  for (let i = 0; i < content.length; i += 1) if (content.charCodeAt(i) === 10) lines += 1;
  return lines;
}

/** Read a file that is known to be inside the project root. */
export function readProjectFile(root: string, relPath: string): string {
  const abs = resolveInsideProject(root, relPath);
  return readFileSync(abs, 'utf8');
}
