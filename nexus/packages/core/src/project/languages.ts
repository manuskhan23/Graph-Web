/** Language detection from file extension (indexing metadata only). */
const MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.kt': 'kotlin',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.css': 'css',
  '.scss': 'scss',
  '.sass': 'sass',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.xml': 'xml',
  '.md': 'markdown',
  '.mdx': 'markdown',
  '.sql': 'sql',
  '.sh': 'shell',
  '.ps1': 'powershell',
  '.bat': 'batch',
  '.dockerfile': 'docker',
  '.vue': 'vue',
  '.svelte': 'svelte',
  '.graphql': 'graphql',
  '.proto': 'proto',
};

export const CODE_LANGUAGES = new Set([
  'typescript', 'javascript', 'python', 'ruby', 'go', 'rust', 'java', 'kotlin',
  'csharp', 'php', 'swift', 'c', 'cpp', 'vue', 'svelte', 'css', 'scss', 'html',
]);

export function detectLanguage(relPath: string): string {
  const lower = relPath.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  if (base === 'dockerfile') return 'docker';
  if (base === 'makefile') return 'make';
  const dot = base.lastIndexOf('.');
  if (dot === -1) return 'unknown';
  return MAP[base.slice(dot)] ?? 'unknown';
}

export function isCodeLanguage(lang: string): boolean {
  return CODE_LANGUAGES.has(lang);
}
