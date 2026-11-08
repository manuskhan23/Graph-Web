/**
 * Glob matching for ignore rules. Implemented locally (no dependency) with
 * support for `**`, `*`, `?` and directory suffixes.
 */
export function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // `**/` matches zero or more directories
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (ch === '?') {
      out += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(`^${out}$`);
}

export class IgnoreMatcher {
  private readonly matchers: RegExp[];
  private readonly directoryMatchers: RegExp[];

  constructor(globs: string[]) {
    this.matchers = [];
    this.directoryMatchers = [];
    for (const glob of globs) {
      if (!glob || glob.startsWith('#')) continue;
      if (glob.endsWith('/')) {
        this.directoryMatchers.push(globToRegExp(`${glob}**`));
        this.directoryMatchers.push(globToRegExp(glob.slice(0, -1)));
      } else if (glob.endsWith('/**')) {
        this.directoryMatchers.push(globToRegExp(glob));
        this.directoryMatchers.push(globToRegExp(glob.slice(0, -3)));
      } else {
        this.matchers.push(globToRegExp(glob));
      }
    }
  }

  ignores(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
    for (const m of this.matchers) if (m.test(normalized)) return true;
    if (this.directoryMatchers.length > 0) {
      const segments = normalized.split('/');
      for (let i = 1; i <= segments.length; i += 1) {
        const prefix = segments.slice(0, i).join('/');
        for (const m of this.directoryMatchers) if (m.test(prefix) || m.test(`${prefix}/`)) return true;
      }
    }
    return false;
  }
}

/** Minimal `.gitignore` reader so project rules are honoured automatically. */
export function parseGitignore(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
    .map((l) => {
      let glob = l.replace(/^!/, '').replace(/\/$/, '/');
      if (!glob.startsWith('**') && !glob.startsWith('/')) {
        if (!glob.includes('/')) return `**/${glob}${glob.endsWith('/') ? '**' : ''}`;
        return `**/${glob}`;
      }
      return glob.replace(/^\//, '');
    });
}
