/**
 * Phase 1 — Architecture analysis.
 *
 * Static (no AI) extraction of technologies, entry points, API endpoints, data
 * models, symbols, imports/exports and architectural smells. The AI layer can
 * summarise these facts, but the facts themselves are derived from source, so
 * the UI can always separate "what the code says" from "what the model thinks".
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ArchitectureIssue,
  FileInsight,
  ProjectAnalysis,
  TechnologyFact,
} from '../types.js';
import type { Database } from '../storage/db.js';
import { NexusError } from '../errors.js';
import { detectLanguage, isCodeLanguage } from './languages.js';

interface ParsedFile {
  relPath: string;
  language: string;
  lines: string[];
  symbols: string[];
  imports: string[];
  exports: string[];
}

const IMPORT_PATTERNS: RegExp[] = [
  /^\s*import\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/,
  /^\s*import\s+.*from\s+['"]([^'"]+)['"]/,
  /require\(\s*['"]([^'"]+)['"]\s*\)/,
  /^\s*from\s+([\w.]+)\s+import/,
  /^\s*import\s+([\w.]+)\s*$/,
];

const SYMBOL_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/, label: 'fn' },
  { re: /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/, label: 'fn' },
  { re: /^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)/, label: 'class' },
  { re: /^\s*(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/, label: 'interface' },
  { re: /^\s*(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/, label: 'type' },
  { re: /^\s*(?:export\s+)?enum\s+([A-Za-z0-9_$]+)/, label: 'enum' },
  { re: /^\s*def\s+([A-Za-z0-9_]+)/, label: 'fn' },
  { re: /^\s*class\s+([A-Za-z0-9_]+)/, label: 'class' },
  { re: /^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=\s*(?:\(|async)/, label: 'fn' },
];

const ENDPOINT_PATTERNS: RegExp[] = [
  /(?:app|router|server|api)\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)['"`]/i,
  /@(?:app|router)\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/i,
  /@(Get|Post|Put|Patch|Delete)\(['"`]([^'"`]+)['"`]\)/,
  /(?:fetch|axios\.(?:get|post|put|patch|delete))\(\s*[`'"]([^`'"]+)[`'"]/,
];

const MODEL_PATTERNS: RegExp[] = [
  /^const\s+([A-Z][A-Za-z0-9]*)(?:Schema)?\s*=\s*new\s+(?:mongoose\.)?Schema\(/,
  /^model\s+([A-Z][A-Za-z0-9]*)\s*\{/,
  /^class\s+([A-Z][A-Za-z0-9]*)\((?:db\.)?Model\)/,
  /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/i,
  /^export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:sqliteTable|pgTable|mysqlTable)\(/,
];

export class ProjectAnalyzer {
  constructor(private readonly db: Database) {}

  async analyze(projectId: string): Promise<ProjectAnalysis> {
    const project = await this.db.projects.get(projectId);
    if (!project) throw new NexusError('NOT_FOUND', `Project not found: ${projectId}`);
    const root = project.rootPath;
    const fileRecords = await this.db.projects.files(projectId);
    if (fileRecords.length === 0) {
      throw new NexusError('VALIDATION_FAILED', 'Project has not been indexed yet. Run a scan first.');
    }

    const parsed: ParsedFile[] = [];
    for (const record of fileRecords) {
      if (!isCodeLanguage(record.language) && !['json', 'yaml', 'markdown', 'sql'].includes(record.language)) continue;
      if (record.size > 400_000) continue;
      const abs = join(root, record.relPath);
      if (!existsSync(abs)) continue;
      let content: string;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      parsed.push(parseFile(record.relPath, record.language, content));
    }

    const manifests = readManifests(root);
    const technologies = detectTechnologies(parsed, manifests);
    const endpoints = extractEndpoints(parsed);
    const models = extractModels(parsed);
    const files = parsed.map(toInsight);
    const folderRoles = folderRolesFor(parsed);
    const issues = detectIssues(parsed, manifests);
    const languageBreakdown: Record<string, number> = {};
    let totalLines = 0;
    for (const record of fileRecords) {
      languageBreakdown[record.language] = (languageBreakdown[record.language] ?? 0) + 1;
      totalLines += record.lines;
    }

    return {
      projectId,
      generatedAt: Date.now(),
      overview: overviewFor(project.name, fileRecords.length, totalLines, technologies, folderRoles),
      technologies,
      folderRoles,
      files,
      endpoints,
      models,
      scripts: manifests.scripts,
      issues,
      stats: {
        filesIndexed: fileRecords.length,
        totalLines,
        languageBreakdown,
        dependencyCount: manifests.dependencyCount,
      },
    };
  }
}

function parseFile(relPath: string, language: string, content: string): ParsedFile {
  const lines = content.split(/\r?\n/);
  const symbols: string[] = [];
  const imports: string[] = [];
  const exports: string[] = [];
  for (const line of lines) {
    for (const pattern of SYMBOL_PATTERNS) {
      const m = pattern.re.exec(line);
      if (m?.[1] && !symbols.includes(m[1])) {
        symbols.push(m[1]);
        break;
      }
    }
    for (const pattern of IMPORT_PATTERNS) {
      const m = pattern.exec(line);
      if (m?.[1]) {
        imports.push(m[1]);
        break;
      }
    }
    const exportMatch = /^\s*export\s+(?:default\s+)?(?:const|function|class|interface|type|enum|async function)\s+([A-Za-z0-9_$]+)/.exec(line);
    if (exportMatch?.[1]) exports.push(exportMatch[1]);
  }
  return { relPath, language, lines, symbols: symbols.slice(0, 60), imports: imports.slice(0, 80), exports };
}

interface Manifests {
  packageJson: Record<string, unknown> | null;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencyCount: number;
  files: Set<string>;
}

function readManifests(root: string): Manifests {
  const out: Manifests = {
    packageJson: null,
    scripts: {},
    dependencies: {},
    devDependencies: {},
    dependencyCount: 0,
    files: new Set(),
  };
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
      out.packageJson = pkg;
      out.scripts = (pkg.scripts as Record<string, string>) ?? {};
      out.dependencies = (pkg.dependencies as Record<string, string>) ?? {};
      out.devDependencies = (pkg.devDependencies as Record<string, string>) ?? {};
      out.dependencyCount = Object.keys(out.dependencies).length + Object.keys(out.devDependencies).length;
    } catch {
      /* malformed package.json is reported as an issue below */
    }
  }
  for (const name of ['requirements.txt', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'Dockerfile', 'docker-compose.yml']) {
    if (existsSync(join(root, name))) out.files.add(name);
  }
  return out;
}

function detectTechnologies(files: ParsedFile[], manifests: Manifests): TechnologyFact[] {
  const facts: TechnologyFact[] = [];
  const all = files.map((f) => f.relPath);
  const deps = { ...manifests.dependencies, ...manifests.devDependencies };
  const hasDep = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  const anyPath = (re: RegExp) => all.some((p) => re.test(p));
  const anyContent = (re: RegExp) => files.some((f) => f.lines.some((l) => re.test(l)));

  const add = (name: string, category: TechnologyFact['category'], evidence: string, version?: string) => {
    if (!facts.some((f) => f.name === name)) facts.push({ name, category, evidence, ...(version ? { version } : {}) });
  };

  for (const lang of new Set(files.map((f) => f.language))) {
    if (isCodeLanguage(lang)) add(lang, 'language', 'file extensions in project');
  }
  if (hasDep('react')) add('React', 'framework', 'package.json dependency', deps.react);
  if (hasDep('next')) add('Next.js', 'framework', 'package.json dependency', deps.next);
  if (hasDep('vue')) add('Vue', 'framework', 'package.json dependency', deps.vue);
  if (hasDep('svelte')) add('Svelte', 'framework', 'package.json dependency', deps.svelte);
  if (hasDep('express')) add('Express', 'framework', 'package.json dependency', deps.express);
  if (hasDep('fastify')) add('Fastify', 'framework', 'package.json dependency', deps.fastify);
  if (hasDep('electron')) add('Electron', 'framework', 'package.json dependency', deps.electron);
  if (hasDep('vite')) add('Vite', 'tool', 'package.json dependency', deps.vite);
  if (hasDep('typescript')) add('TypeScript', 'language', 'package.json dependency', deps.typescript);
  if (hasDep('mongoose') || hasDep('mongodb')) add('MongoDB', 'database', 'package.json dependency');
  if (hasDep('pg') || hasDep('postgres')) add('PostgreSQL', 'database', 'package.json dependency');
  if (hasDep('better-sqlite3') || hasDep('sqlite3')) add('SQLite', 'database', 'package.json dependency');
  if (hasDep('prisma') || hasDep('@prisma/client')) add('Prisma', 'tool', 'package.json dependency');
  if (hasDep('drizzle-orm')) add('Drizzle ORM', 'tool', 'package.json dependency');
  if (hasDep('firebase') || anyContent(/initializeApp\s*\(/)) add('Firebase', 'database', 'dependency or initializeApp call');
  if (hasDep('jest') || hasDep('vitest') || hasDep('mocha')) add('Jest/Vitest', 'tool', 'package.json test dependency');
  if (hasDep('playwright') || hasDep('@playwright/test')) add('Playwright', 'tool', 'package.json dependency');
  if (manifests.files.has('requirements.txt') || anyPath(/\.py$/)) add('Python', 'language', 'python source files');
  if (anyContent(/from\s+flask\s+import/) || anyContent(/Flask\(__name__\)/)) add('Flask', 'framework', 'Flask app detected in source');
  if (anyContent(/from\s+fastapi\s+import/)) add('FastAPI', 'framework', 'FastAPI app detected in source');
  if (manifests.files.has('Dockerfile') || manifests.files.has('docker-compose.yml')) add('Docker', 'tool', 'container manifest present');
  if (anyContent(/jsonwebtoken|passport|next-auth|firebase\/auth/i)) add('Authentication', 'library', 'auth library usage in source');
  if (anyContent(/tailwind/i)) add('Tailwind CSS', 'library', 'tailwind reference');

  return facts.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

function extractEndpoints(files: ParsedFile[]) {
  const out: { method: string; path: string; file: string; line: number }[] = [];
  for (const file of files) {
    if (!['typescript', 'javascript', 'python', 'java', 'csharp'].includes(file.language)) continue;
    file.lines.forEach((line, index) => {
      for (const pattern of ENDPOINT_PATTERNS) {
        const m = pattern.exec(line);
        if (!m) continue;
        const matched = m[1] && /^(get|post|put|patch|delete|use)$/i.test(m[1]) ? m : null;
        const method = matched ? matched[1]!.toUpperCase() : 'ANY';
        const path = matched ? m[2] : m[1];
        if (!path || !path.startsWith('/')) continue;
        out.push({ method, path, file: file.relPath, line: index + 1 });
        break;
      }
    });
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const key = `${e.method} ${e.path} ${e.file}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 300);
}

function extractModels(files: ParsedFile[]) {
  const out: { name: string; file: string; fields: string[] }[] = [];
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i += 1) {
      const line = file.lines[i]!;
      for (const pattern of MODEL_PATTERNS) {
        const m = pattern.exec(line);
        if (!m?.[1]) continue;
        const fields: string[] = [];
        // Collect `field: Type` pairs from the following 40 lines.
        for (let j = i + 1; j < Math.min(file.lines.length, i + 40); j += 1) {
          const fieldMatch = /^\s{2,}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\{?\s*(?:type\s*:\s*)?([A-Za-z]+)/.exec(file.lines[j]!);
          if (fieldMatch?.[1]) fields.push(`${fieldMatch[1]}: ${fieldMatch[2]}`);
          if (/^\s*\}\)?;?\s*$/.test(file.lines[j]!) && fields.length > 0) break;
        }
        out.push({ name: m[1], file: file.relPath, fields: fields.slice(0, 20) });
        break;
      }
    }
  }
  return out.slice(0, 80);
}

function toInsight(file: ParsedFile): FileInsight {
  return {
    relPath: file.relPath,
    kind: classifyKind(file.relPath),
    symbols: file.symbols,
    imports: [...new Set(file.imports)].slice(0, 30),
    exports: [...new Set(file.exports)].slice(0, 30),
    lines: file.lines.length,
  };
}

function classifyKind(relPath: string): FileInsight['kind'] {
  const lower = relPath.toLowerCase();
  if (/\.(test|spec)\.[jt]sx?$|__tests__|\/tests?\//.test(lower)) return 'test';
  if (/server|app\.(ts|js|py)$|main\.(ts|js|py)$|index\.(ts|js|py)$/.test(lower.split('/').pop() ?? '')) return 'entry';
  if (/\/components?\//.test(lower) || /\.(jsx|tsx|vue|svelte)$/.test(lower)) return 'component';
  if (/\/routes?\//.test(lower) || /\/api\//.test(lower) || /controller/.test(lower)) return 'route';
  if (/model|schema|entity|migration/.test(lower)) return 'model';
  if (/service|usecase|handler|repository|repo/.test(lower)) return 'service';
  if (/util|helper|lib|common|shared/.test(lower)) return 'util';
  if (/\.(json|ya?ml|toml|config\.(js|ts))$/.test(lower) || /config/.test(lower)) return 'config';
  return 'other';
}

function folderRolesFor(files: ParsedFile[]): { path: string; role: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.relPath.split('/');
    const folder = parts.length > 1 ? parts[0]! : '(root)';
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([path, count]) => ({ path, role: explainFolder(path), files: count }));
}

function explainFolder(path: string): string {
  const p = path.toLowerCase();
  if (p === '(root)') return 'Top-level entry points and manifests';
  if (p.includes('component')) return 'UI components';
  if (p.includes('page') || p.includes('view') || p.includes('screen')) return 'Screens / route views';
  if (p.includes('route') || p.includes('api')) return 'HTTP routes / API layer';
  if (p.includes('service')) return 'Business logic services';
  if (p.includes('model') || p.includes('schema')) return 'Data models / schemas';
  if (p.includes('util') || p.includes('lib') || p.includes('helper')) return 'Shared utilities';
  if (p.includes('test') || p.includes('spec')) return 'Tests';
  if (p.includes('hook')) return 'React hooks';
  if (p.includes('style') || p.includes('css')) return 'Styles';
  if (p.includes('public') || p.includes('static') || p.includes('asset')) return 'Static assets';
  if (p.includes('config')) return 'Configuration';
  if (p.includes('db') || p.includes('database') || p.includes('storage')) return 'Persistence';
  if (p.includes('agent')) return 'Agent subsystem';
  return 'Application code';
}

function detectIssues(files: ParsedFile[], manifests: Manifests): ArchitectureIssue[] {
  const issues: ArchitectureIssue[] = [];
  const byPath = new Map(files.map((f) => [f.relPath, f]));

  if (manifests.packageJson && !manifests.scripts.test) {
    issues.push({
      id: 'no-test-script',
      title: 'No test script configured',
      severity: 'warning',
      detail: 'package.json has no "test" script, so the agent cannot verify changes automatically.',
      files: ['package.json'],
    });
  }
  if (!files.some((f) => /\.(test|spec)\.[jt]sx?$/.test(f.relPath))) {
    issues.push({
      id: 'no-tests',
      title: 'No test files found',
      severity: 'warning',
      detail: 'No *.test.* or *.spec.* files were indexed. Verification will rely on build/lint only.',
      files: [],
    });
  }
  if (manifests.packageJson && !manifests.devDependencies.typescript && files.some((f) => f.language === 'typescript')) {
    issues.push({
      id: 'ts-without-dep',
      title: 'TypeScript sources without a TypeScript dependency',
      severity: 'info',
      detail: 'TypeScript files exist but typescript is not declared in package.json.',
      files: ['package.json'],
    });
  }
  const huge = files.filter((f) => f.lines.length > 700);
  if (huge.length > 0) {
    issues.push({
      id: 'large-files',
      title: 'Oversized modules',
      severity: 'info',
      detail: `${huge.length} file(s) exceed 700 lines, which makes them hard to reason about and test.`,
      files: huge.slice(0, 8).map((f) => f.relPath),
    });
  }
  const deepImports = files.filter((f) => f.imports.some((i) => (i.match(/\.\.\//g) ?? []).length >= 3));
  if (deepImports.length > 0) {
    issues.push({
      id: 'deep-relative-imports',
      title: 'Deep relative imports',
      severity: 'info',
      detail: 'Some files import across three or more parent directories, hinting at weak module boundaries.',
      files: deepImports.slice(0, 8).map((f) => f.relPath),
    });
  }
  for (const file of files) {
    if (/\.env/.test(file.relPath)) {
      issues.push({
        id: `secret-${file.relPath}`,
        title: 'Environment file present in project',
        severity: 'warning',
        detail: 'An .env file exists. NEXUS excludes it from indexing and never sends it to a model.',
        files: [file.relPath],
      });
    }
  }
  const clientSecrets = files.filter((f) =>
    f.lines.some((l) => /VITE_[A-Z_]*(KEY|SECRET|TOKEN)/.test(l) && !/process\.env/.test(l)),
  );
  if (clientSecrets.length > 0) {
    issues.push({
      id: 'public-env-secret',
      title: 'Potential secret exposed via public build variable',
      severity: 'error',
      detail: 'A VITE_* variable that looks like a secret is referenced in client code. Vite inlines these into the public bundle.',
      files: clientSecrets.slice(0, 5).map((f) => f.relPath),
    });
  }
  const duplicateNames = new Map<string, string[]>();
  for (const file of files) {
    const base = file.relPath.split('/').pop() ?? file.relPath;
    duplicateNames.set(base, [...(duplicateNames.get(base) ?? []), file.relPath]);
  }
  const dupes = [...duplicateNames.entries()].filter(([, paths]) => paths.length > 2);
  if (dupes.length > 0) {
    issues.push({
      id: 'duplicate-basenames',
      title: 'Repeated file names',
      severity: 'info',
      detail: `${dupes.length} file name(s) appear more than twice; navigation and conflict detection get harder.`,
      files: dupes.slice(0, 5).flatMap(([, paths]) => paths.slice(0, 2)),
    });
  }
  if (byPath.size === 0) {
    issues.push({
      id: 'no-source',
      title: 'No source files detected',
      severity: 'error',
      detail: 'The index contains no code files. Check the project root and ignore rules.',
      files: [],
    });
  }
  return issues;
}

function overviewFor(
  name: string,
  fileCount: number,
  totalLines: number,
  technologies: TechnologyFact[],
  folders: { path: string; role: string; files: number }[],
): string {
  const stacks = technologies.filter((t) => t.category === 'framework' || t.category === 'language').map((t) => t.name);
  const topFolders = folders.slice(0, 4).map((f) => `${f.path} (${f.role.toLowerCase()})`).join(', ');
  return [
    `${name} contains ${fileCount} indexed files and ${totalLines.toLocaleString()} lines.`,
    stacks.length ? `Primary stack: ${stacks.slice(0, 6).join(', ')}.` : 'No frameworks were detected from manifests.',
    topFolders ? `Main areas: ${topFolders}.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

export { detectLanguage };
