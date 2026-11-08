import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { makeProject, writeFiles, FIXTURE_APP } from './fixtures.js';
import { ProjectIndexer } from '../src/project/indexer.js';
import { ProjectAnalyzer } from '../src/project/analyzer.js';
import { SearchEngine } from '../src/search/engine.js';
import { walkProject } from '../src/project/scanner.js';
import { IgnoreMatcher, parseGitignore } from '../src/project/ignore.js';

test('scanner honours built-in ignore rules and skips secrets/binaries', () => {
  const project = makeProject({
    'src/app.ts': 'export const a = 1;',
    'node_modules/pkg/index.js': 'module.exports = 1;',
    '.env': 'SECRET=1',
    'src/.env.local': 'SECRET=2',
    'assets/logo.png': 'binary-ish',
    'dist/bundle.js': 'x',
    'config/keys.pem': 'pem',
    'src/deep/nested/file.ts': 'export const b = 2;',
  });
  const entries = walkProject(project.dir, []).map((e) => e.relPath);
  assert.ok(entries.includes('src/app.ts'));
  assert.ok(entries.includes('src/deep/nested/file.ts'));
  assert.ok(!entries.some((p) => p.includes('node_modules')));
  assert.ok(!entries.some((p) => p.includes('.env')));
  assert.ok(!entries.some((p) => p.endsWith('.png')));
  assert.ok(!entries.some((p) => p.startsWith('dist/')));
  assert.ok(!entries.some((p) => p.endsWith('.pem')));
  project.cleanup();
});

test('ignore matcher handles ** globs and directory rules', () => {
  const matcher = new IgnoreMatcher(['**/node_modules/**', '**/*.min.js', 'coverage/', '**/tmp']);
  assert.ok(matcher.ignores('node_modules/react/index.js'));
  assert.ok(matcher.ignores('packages/a/node_modules/x.js'));
  assert.ok(matcher.ignores('vendor/app.min.js'));
  assert.ok(matcher.ignores('coverage/lcov.info'));
  assert.ok(matcher.ignores('src/tmp'));
  assert.ok(!matcher.ignores('src/app.js'));
  assert.ok(!matcher.ignores('src/tmpfile.ts'));
});

test('parseGitignore converts patterns to globs', () => {
  const globs = parseGitignore('dist\n# comment\n*.log\n/src/gen\n!keep.txt\n');
  assert.deepEqual(globs, ['**/dist', '**/*.log', 'src/gen', '**/keep.txt']);
});

test('indexer performs incremental add/modify/remove cycles', async () => {
  const project = makeProject({ 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 2;\n' });
  const indexer = new ProjectIndexer(project.db);

  const first = await indexer.index(project.projectId);
  assert.equal(first.added, 3); // package.json + 2 sources
  assert.equal(first.removed, 0);

  const second = await indexer.index(project.projectId);
  assert.equal(second.added, 0);
  assert.equal(second.modified, 0);
  assert.equal(second.unchanged, 3);
  assert.ok(second.indexVersion > first.indexVersion);

  writeFileSync(join(project.dir, 'src/a.ts'), 'export const a = 99;\n');
  writeFiles(project.dir, { 'src/c.ts': 'export const c = 3;\n' });
  unlinkSync(join(project.dir, 'src/b.ts'));

  const third = await indexer.index(project.projectId);
  assert.equal(third.added, 1);
  assert.equal(third.modified, 1);
  assert.equal(third.removed, 1);
  assert.equal(project.db.projects.countFiles(project.projectId), 3);

  const files = project.db.projects.filesByPath(project.projectId);
  assert.ok(files.has('src/c.ts'));
  assert.ok(!files.has('src/b.ts'));
  project.cleanup();
});

test('analyzer extracts stack, endpoints, symbols and issues', async () => {
  const project = makeProject({
    'src/server.ts': FIXTURE_APP,
    'src/UserSchema.ts': 'const UserSchema = new mongoose.Schema({\n  email: String,\n  name: String,\n});\n',
    'src/big.ts': Array.from({ length: 800 }, (_, i) => `export const v${i} = ${i};`).join('\n'),
  });
  writeFileSync(
    join(project.dir, 'package.json'),
    JSON.stringify({ name: 'fixture', dependencies: { express: '^4.0.0', mongoose: '^8.0.0' }, scripts: {} }),
  );
  const indexer = new ProjectIndexer(project.db);
  await indexer.index(project.projectId);

  const analysis = new ProjectAnalyzer(project.db).analyze(project.projectId);
  const tech = analysis.technologies.map((t) => t.name);
  assert.ok(tech.includes('Express'));
  assert.ok(tech.includes('MongoDB'));
  assert.ok(tech.includes('typescript'));

  assert.ok(analysis.endpoints.some((e) => e.path === '/api/users' && e.method === 'GET'));
  const serverInsight = analysis.files.find((f) => f.relPath === 'src/server.ts');
  assert.ok(serverInsight?.symbols.includes('createServer'));
  assert.ok(serverInsight?.symbols.includes('UserService'));
  assert.equal(serverInsight?.kind, 'entry');

  const userModel = analysis.models.find((m) => m.name === 'UserSchema');
  assert.ok(userModel, 'mongoose schema detected');
  assert.ok(userModel!.fields.length >= 2);

  assert.ok(analysis.issues.some((i) => i.id === 'large-files'));
  assert.ok(analysis.issues.some((i) => i.id === 'no-test-script' || i.id === 'no-tests'));
  assert.ok(analysis.overview.includes('indexed files'));
  assert.ok(analysis.stats.totalLines > 0);
  project.cleanup();
});

test('analyzer flags secrets exposed to the client bundle', async () => {
  const project = makeProject({
    'src/aiService.js': "const key = import.meta.env.VITE_GROQ_API_KEY;\nfetch(url, { headers: { Authorization: key } });\n",
  });
  await new ProjectIndexer(project.db).index(project.projectId);
  const analysis = new ProjectAnalyzer(project.db).analyze(project.projectId);
  const issue = analysis.issues.find((i) => i.id === 'public-env-secret');
  assert.ok(issue, 'public env secret issue should be raised');
  assert.equal(issue!.severity, 'error');
  assert.ok(issue!.files.includes('src/aiService.js'));
  project.cleanup();
});

test('search returns ranked hits with file and line references', async () => {
  const project = makeProject({
    'src/userService.ts': [
      'export class UserService {',
      '  async findUsers() {',
      '    return db.user.findMany();',
      '  }',
      '}',
    ].join('\n'),
    'src/unrelated.ts': 'export const colors = ["red", "blue"];',
  });
  await new ProjectIndexer(project.db).index(project.projectId);
  const engine = new SearchEngine(project.db);
  const result = await engine.search({ projectId: project.projectId, query: 'findUsers user service' });

  assert.equal(result.strategy, 'keyword');
  assert.ok(result.hits.length > 0);
  assert.equal(result.hits[0]!.relPath, 'src/userService.ts');
  assert.ok(result.hits[0]!.startLine >= 1);
  assert.ok(result.hits[0]!.isSourceContent);
  assert.ok(result.hits[0]!.snippet.includes('findUsers'));
  assert.ok(result.tookMs >= 0);
  project.cleanup();
});

test('indexing a missing project fails with NOT_FOUND', async () => {
  const project = makeProject({});
  const indexer = new ProjectIndexer(project.db);
  await assert.rejects(() => indexer.index('prj_missing'), /Project not found/);
  project.cleanup();
});

export { readFileSync };
