/**
 * Application composition root for the NEXUS backend.
 *
 * Everything is constructed once, here, in dependency order. The server, the
 * agent runtime, workflows and tests all use exactly this graph, so there is no
 * second place where business logic can drift.
 */
import { mkdirSync } from 'node:fs';
import { config } from './config.js';
import { getDatabase, type Database } from './storage/db.js';
import { EventBus, eventBus } from './events/bus.js';
import { KeyStore, keyStore } from './security/keys.js';
import { SettingsService } from './settings/service.js';
import { ModelRouter } from './providers/router.js';
import { GeminiProvider } from './providers/gemini.js';
import { GroqProvider } from './providers/groq.js';
import { ProjectIndexer } from './project/indexer.js';
import { ProjectAnalyzer } from './project/analyzer.js';
import { SearchEngine } from './search/engine.js';
import { SnapshotService } from './snapshots/service.js';
import { EditorService } from './editor/service.js';
import { TerminalManager } from './terminal/manager.js';
import { BrowserManager } from './browser/manager.js';
import { PlaywrightDriver, StubDriver, type BrowserDriver } from './browser/driver.js';
import { ApprovalGate } from './agents/approvals.js';
import { AgentOrchestrator } from './agents/orchestrator.js';
import { ToolRegistry, buildToolRegistry, setSearchEngine } from './tools/index.js';
import { TaskPlanner } from './tasks/planner.js';
import { ContextManager } from './context/manager.js';
import { AgentRuntime } from './agent/runtime.js';
import { WorkflowEngine } from './workflows/engine.js';
import { VisionService } from './vision/service.js';
import { MemoryService } from './memory/service.js';
import { JobManager } from './jobs/manager.js';

export interface NexusApp {
  db: Database;
  events: EventBus;
  keys: KeyStore;
  settings: SettingsService;
  router: ModelRouter;
  indexer: ProjectIndexer;
  analyzer: ProjectAnalyzer;
  search: SearchEngine;
  snapshots: SnapshotService;
  editor: EditorService;
  terminal: TerminalManager;
  browser: BrowserManager;
  approvals: ApprovalGate;
  orchestrator: AgentOrchestrator;
  registry: ToolRegistry;
  planner: TaskPlanner;
  context: ContextManager;
  runtime: AgentRuntime;
  workflows: WorkflowEngine;
  vision: VisionService;
  memory: MemoryService;
  jobs: JobManager;
  shutdown(): Promise<void>;
}

export interface CreateAppOptions {
  /** Use an isolated in-memory database and stub browser (tests). */
  test?: boolean;
  /** Inject a prepared database (tests / embedding). */
  db?: Database;
  events?: EventBus;
  keys?: KeyStore;
  browserDriver?: BrowserDriver;
  /** Pre-built providers for offline tests. */
  providers?: ConstructorParameters<typeof ModelRouter>[0]['providers'];
}

export async function createApp(options: CreateAppOptions = {}): Promise<NexusApp> {
  const events = options.events ?? eventBus;
  const keys = options.keys ?? keyStore;

  mkdirSync(config.dataDir, { recursive: true });
  mkdirSync(config.artifactDir, { recursive: true });

  // Dynamic imports keep the heavy test-only paths out of production startup.
  const db =
    options.db ??
    (options.test ? (await import('./storage/db.js')).createTestDatabase() : getDatabase());

  const settings = new SettingsService(db.observability);

  const router = new ModelRouter({
    settings,
    observability: db.observability,
    getKey: (provider) => keys.get(provider),
    events,
    providers: options.providers ?? {
      gemini: new GeminiProvider(() => keys.get('gemini')),
      groq: new GroqProvider(() => keys.get('groq')),
    },
  });

  const indexer = new ProjectIndexer(db, events);
  const analyzer = new ProjectAnalyzer(db);
  const search = new SearchEngine(db, router);
  setSearchEngine(search);

  const snapshots = new SnapshotService(db);
  const editor = new EditorService(db, snapshots);
  const terminal = new TerminalManager(db, events);
  const browser = new BrowserManager(options.browserDriver ?? new StubDriver(), db, events);
  const approvals = new ApprovalGate(db.observability, db.tasks, settings, events);
  const vision = new VisionService(router, db.observability);
  const memory = new MemoryService(db.memories, settings);
  const jobs = new JobManager(db, events);

  const registry = buildToolRegistry({
    db,
    events,
    approvals,
    editor,
    snapshots,
    terminal,
    browser,
    indexer,
    analyzer,
    vision,
    router,
  });
  // Agents are seeded after the registry exists so their tool allow-lists are
  // the ones actually enforced.
  const orchestrator = new AgentOrchestrator(db, events, registry);

  const planner = new TaskPlanner(registry, router);
  const context = new ContextManager(db, settings, router, search);
  const runtime = new AgentRuntime({
    db,
    events,
    settings,
    router,
    registry,
    planner,
    context,
    approvals,
    vision,
  });
  const workflows = new WorkflowEngine({ db, events, registry, approvals });

  return {
    db,
    events,
    keys,
    settings,
    router,
    indexer,
    analyzer,
    search,
    snapshots,
    editor,
    terminal,
    browser,
    approvals,
    orchestrator,
    registry,
    planner,
    context,
    runtime,
    workflows,
    vision,
    memory,
    jobs,
    async shutdown() {
      approvals.dispose();
      terminal.shutdown();
      await browser.closeAll();
      if (!options.test) db.close();
    },
  };
}

export { PlaywrightDriver, StubDriver };
