/**
 * Server entry point.
 *
 *   node dist/server/main.js
 *
 * Env:
 *   NEXUS_PORT                (default 4400)
 *   NEXUS_DATA_DIR            (default ~/.nexus-ai)
 *   NEXUS_SEED_DEMO=1         register + index a demo project on first start
 *   NEXUS_DEMO_ROOT           directory to seed (default: parent repo, else this repo)
 *   GEMINI_API_KEY / GROQ_API_KEY
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildServer, config } from './index.js';
import { PlaywrightDriver } from '../../core/src/browser/driver.js';

async function main(): Promise<void> {
  const driver = new PlaywrightDriver();
  const server = await buildServer({ browserDriver: driver });
  const { port, host } = await server.listen(config.port);

  console.log('');
  console.log('  ███ NEXUS AI · autonomous desktop engineering agent');
  console.log(`  API      http://localhost:${port}/api`);
  console.log(`  Data     ${config.dataDir}`);
  console.log(`  Schema   v${server.nexus.db.version}`);
  console.log(`  AI       ${server.nexus.router.configuredProviders().join(', ') || 'none configured (add a key in Settings)'}`);
  const browser = await server.nexus.browser.availability();
  console.log(`  Browser  ${browser.available ? 'playwright ready' : `unavailable — ${browser.reason}`}`);
  console.log('');

  if (config.seedDemo) await seedDemo(server.nexus);

  // If nothing is configured yet, say so loudly but keep running: the app is
  // fully usable for projects, memory, search, terminal and rollback.
  if (server.nexus.router.configuredProviders().length === 0) {
    console.warn('  ⚠ No AI provider configured. Set GEMINI_API_KEY or GROQ_API_KEY,');
    console.warn('    or add a key in Settings → AI. Model-driven planning is disabled until then.');
    console.warn('');
  }

  const shutdown = async (signal: string) => {
    console.log(`\n[nexus] ${signal} received, shutting down…`);
    server.express.disable('x-powered-by');
    await server.nexus.shutdown();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  void host;
}

async function seedDemo(nexus: Awaited<ReturnType<typeof buildServer>>['nexus']): Promise<void> {
  // Register a project so the UI has something real to show. `NEXUS_DEMO_ROOT`
  // wins; otherwise fall back to the parent directory (the previous layout) and
  // finally to this repository itself, so the seeder works standalone.
  const explicit = process.env.NEXUS_DEMO_ROOT;
  const parent = resolve(process.cwd(), '..');
  const self = resolve(process.cwd());
  const candidate = explicit
    ? resolve(explicit)
    : existsSync(parent) && existsSync(resolve(parent, '.git'))
      ? parent
      : self;
  if (!existsSync(candidate)) {
    console.warn(`  ⚠ Demo seeding skipped: ${candidate} does not exist`);
    return;
  }
  const existing = await nexus.db.projects.findByRoot(candidate);
  if (existing) return;
  const project = await nexus.db.projects.create({
    name: candidate.split(/[\\/]/).filter(Boolean).pop() ?? 'Demo',
    rootPath: candidate,
    description: 'Seeded demo project',
  });
  const result = await nexus.indexer.index(project.id);
  console.log(`  Seeded demo project: ${result.scanned} files indexed (v${result.indexVersion})`);
}

main().catch((err) => {
  console.error('[nexus] fatal startup error:', err);
  process.exit(1);
});
