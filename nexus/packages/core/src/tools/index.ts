/**
 * Registry assembly. One function wires every subsystem into the tool registry so
 * the server, the agent runtime and the tests all get an identical tool set.
 */
import type { Database } from '../storage/db.js';
import type { EventBus } from '../events/bus.js';
import type { ApprovalGate } from '../agents/approvals.js';
import type { EditorService } from '../editor/service.js';
import type { SnapshotService } from '../snapshots/service.js';
import type { TerminalManager } from '../terminal/manager.js';
import type { BrowserManager } from '../browser/manager.js';
import type { ProjectIndexer } from '../project/indexer.js';
import type { ProjectAnalyzer } from '../project/analyzer.js';
import type { VisionService } from '../vision/service.js';
import type { ModelRouter } from '../providers/router.js';
import { ToolRegistry } from './registry.js';
import { createFileTools } from './files.js';
import { createTerminalTools } from './terminal.js';
import { createProjectTools } from './project.js';
import { createMemoryTools } from './memory.js';
import { createBrowserTools } from './browser.js';
import { createAiTools } from './ai.js';

export { ToolRegistry, sanitizeInput } from './registry.js';
export { setSearchEngine } from './files.js';
export type { ToolContext, ToolDefinition, ToolResult, ToolExecutionOutcome } from './types.js';

export interface ToolRegistryDeps {
  db: Database;
  events?: EventBus;
  approvals: ApprovalGate;
  editor: EditorService;
  snapshots: SnapshotService;
  terminal: TerminalManager;
  browser: BrowserManager;
  indexer: ProjectIndexer;
  analyzer: ProjectAnalyzer;
  vision: VisionService;
  router: ModelRouter;
}

export function buildToolRegistry(deps: ToolRegistryDeps): ToolRegistry {
  const registry = new ToolRegistry(deps.db.observability, deps.approvals, deps.events);
  registry.registerAll(createFileTools({ db: deps.db, editor: deps.editor, snapshots: deps.snapshots }));
  registry.registerAll(createTerminalTools(deps.terminal));
  registry.registerAll(createProjectTools(deps.db, deps.indexer, deps.analyzer));
  registry.registerAll(createMemoryTools(deps.db.memories));
  registry.registerAll(createBrowserTools(deps.browser));
  registry.registerAll(createAiTools(deps.vision, deps.router));
  return registry;
}
