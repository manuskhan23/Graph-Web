/**
 * Unified diff generation for the diff viewer. Uses the `diff` package for the
 * actual algorithm, then normalises the output into a UI-friendly shape.
 */
import { createTwoFilesPatch } from 'diff';

export interface DiffHunkLine {
  type: 'add' | 'del' | 'context';
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface FileDiff {
  relPath: string;
  additions: number;
  deletions: number;
  unified: string;
  lines: DiffHunkLine[];
  binarySafe: boolean;
}

export function buildFileDiff(relPath: string, before: string, after: string): FileDiff {
  const patch = createTwoFilesPatch(relPath, relPath, before, after, 'before', 'after', { context: 3 });
  const lines: DiffHunkLine[] = [];
  let additions = 0;
  let deletions = 0;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('Index:') || raw.startsWith('====')) continue;
    if (raw.startsWith('@@')) {
      const match = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (match) {
        oldLine = Number(match[1]);
        newLine = Number(match[2]);
      }
      lines.push({ type: 'context', text: raw, oldLine: null, newLine: null });
      continue;
    }
    if (raw.startsWith('+')) {
      lines.push({ type: 'add', text: raw.slice(1), oldLine: null, newLine: newLine++ });
      additions += 1;
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'del', text: raw.slice(1), oldLine: oldLine++, newLine: null });
      deletions += 1;
    } else if (raw.length > 0 || lines.length > 0) {
      lines.push({ type: 'context', text: raw.replace(/^ /, ''), oldLine: oldLine++, newLine: newLine++ });
    }
  }

  return { relPath, additions, deletions, unified: patch, lines, binarySafe: isMostlyText(after) };
}

function isMostlyText(text: string): boolean {
  if (text.length === 0) return true;
  let control = 0;
  for (let i = 0; i < Math.min(text.length, 4000); i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0) return false;
    if (code < 9 || (code > 13 && code < 32)) control += 1;
  }
  return control / Math.min(text.length, 4000) < 0.02;
}

/** Aggregate stats for the review UI. */
export function summarizeDiffs(diffs: FileDiff[]) {
  return {
    files: diffs.length,
    additions: diffs.reduce((sum, d) => sum + d.additions, 0),
    deletions: diffs.reduce((sum, d) => sum + d.deletions, 0),
  };
}
