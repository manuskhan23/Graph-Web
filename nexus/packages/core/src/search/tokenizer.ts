/** Tokenizer shared by the keyword index and BM25 scoring. */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of', 'to', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'this', 'that', 'these', 'those', 'as',
  'with', 'from', 'by', 'do', 'does', 'did', 'how', 'what', 'why', 'when', 'where', 'which', 'i',
  'you', 'we', 'they', 'he', 'she', 'my', 'your', 'our', 'their', 'can', 'could', 'should', 'would',
  'please', 'me', 'us', 'about', 'into', 'than', 'so', 'not', 'no', 'yes', 'there', 'here', 'use',
]);

/** Split identifiers (`getUserById` → get, user, by, id) and lowercase. */
export function tokenize(text: string): string[] {
  const raw = text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9_$]+/)
    .filter((t) => t.length > 1 && t.length < 40);
  const out: string[] = [];
  for (const token of raw) {
    if (STOPWORDS.has(token)) continue;
    out.push(token);
    if (token.includes('_')) out.push(...token.split('_').filter((p) => p.length > 1));
  }
  return out;
}

export function uniqueTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

export { STOPWORDS };
