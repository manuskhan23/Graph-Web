/**
 * Line-window chunker used by search and context assembly.
 * Chunks keep 1-based line ranges so every hit can cite `path:line`.
 */
export interface Chunk {
  startLine: number;
  endLine: number;
  content: string;
}

const DEFAULT_WINDOW = 40;
const DEFAULT_OVERLAP = 8;
const MAX_CHUNK_CHARS = 4000;

export function chunkFile(
  relPath: string,
  content: string,
  window = DEFAULT_WINDOW,
  overlap = DEFAULT_OVERLAP,
): Chunk[] {
  if (content.length === 0) return [];
  const lines = content.split(/\r?\n/);
  // Small files are a single chunk.
  if (lines.length <= window) {
    return [{ startLine: 1, endLine: lines.length, content }];
  }
  const chunks: Chunk[] = [];
  const step = Math.max(1, window - overlap);
  for (let start = 0; start < lines.length; start += step) {
    const end = Math.min(lines.length, start + window);
    let text = lines.slice(start, end).join('\n');
    if (text.length > MAX_CHUNK_CHARS) text = text.slice(0, MAX_CHUNK_CHARS);
    chunks.push({ startLine: start + 1, endLine: end, content: text });
    if (end === lines.length) break;
  }
  return chunks;
}

/** Collapse blank-line runs so prompts stay dense without losing structure. */
export function condense(text: string, maxLines = 400): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blankRun += 1;
      if (blankRun > 1) continue;
    } else {
      blankRun = 0;
    }
    out.push(line);
    if (out.length >= maxLines) {
      out.push(`… (${lines.length - maxLines} more lines)`);
      break;
    }
  }
  return out.join('\n');
}
