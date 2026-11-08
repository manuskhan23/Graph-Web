# NEXUS AI — Step 2: Dependency-Aware Implementation Roadmap

Legend: ✅ implemented & tested · 🟡 implemented, partially verified · ⛔ blocked by environment

Because this repository contains **none** of the required desktop stack, the roadmap is ordered so that
every later phase only depends on layers that already exist and are tested. Phases are implemented in
this exact order; each phase lands backend → contracts → UI → tests.

## Layer 0 — Foundation (no phase, must come first)

| Item | Files | Why first |
| --- | --- | --- |
| Monorepo scaffolding | `nexus/package.json`, `nexus/tsconfig.json`, `nexus/ui/*` | everything compiles against it |
| Shared contracts | `packages/shared/*` | single source of truth for REST + IPC + SSE payloads |
| Structured config | `config/appConfig.ts` | execution limits, ports, ignore rules, provider models |
| Error taxonomy | `core/errors.ts` | required by every service |
| Event bus | `core/events/*` | SSE, activity, notifications, analytics all consume it |

## Layer 1 — Phases 10, 12, 16 (storage-backed, no AI needed)

| Phase | Objective | Modules | API | DB |
| --- | --- | --- | --- | --- |
| **10** Data model | Persistence before features | `core/storage/{db,migrations,repositories}` | — | all tables |
| **16** Settings | AI/agent/project/app settings, keys outside React | `core/settings`, `core/keys` | `GET/PUT /api/settings` | `app_settings` |
| **12** Memory | Editable long-term memory + secret guard | `core/memory` | `/api/memory*` | `memories` |

Dependencies: none. Security: `keys` service never returns raw secrets to the UI (masked only).

## Layer 2 — Phases 1, 11 (project intelligence + search, no AI needed)

| Phase | Objective | Modules | API | DB |
| --- | --- | --- | --- | --- |
| **1** Project intelligence | register/switch/remove projects, scan, incremental index, architecture analysis | `core/project/{registry,scanner,indexer,analyzer}` | `/api/projects*` | `projects`, `project_files`, `project_index_runs` |
| **11** Search | keyword + semantic + hybrid retrieval with file/line refs | `core/search/{tokenizer,index,embeddings}` | `/api/search` | `file_chunks`, `embeddings` |

Dependencies: Layer 1 storage. Security: ignore rules always exclude `.env*`, keys, binaries; all paths
resolved inside the project root (traversal guard).

## Layer 3 — Phase 6 (terminal), Phase 4 (snapshots/rollback), Phase 3 (editing)

| Phase | Objective | Modules | API |
| --- | --- | --- | --- |
| **6** Terminal & process manager | allow-list validation, approval for destructive commands, streaming output, process ownership, timeouts | `core/terminal/*` | `/api/terminal/*` |
| **4** Version history | content-hash snapshots, project/file restore, retention policy | `core/snapshots/*` | `/api/snapshots/*` |
| **3** Code editing | read/write/patch with hash-conflict detection, diff preview, apply-after-approval | `core/editor/*` | `/api/editor/*` |

Dependencies: 1 (paths), 4 must exist **before** 3 (every edit snapshots first).

## Layer 4 — Phases 5, 8, 13 (AI core)

| Phase | Objective | Modules | API |
| --- | --- | --- | --- |
| **17 (routing §7)** | Gemini + Groq only, capability validation, fallback, usage accounting | `core/providers/*` | `/api/providers/*` |
| **2** Context management | layered context, ranking, dedupe, budgeting, source attribution | `core/context/*` | (internal) |
| **5** Task planner | task states machine, plans, steps, checkpoints, cancel/pause/resume | `core/tasks/*` | `/api/tasks/*` |
| **8** Vision | Gemini vision analysis of screenshots/attachments | `core/vision` | `/api/vision/analyze` |
| **13** Background execution & events | job queue, SSE stream, interruption recovery | `core/jobs/*`, `server/sse` | `/api/events/stream` |

Dependencies: 1+2 (context), 17 (providers), 3/6 (tools).

## Layer 5 — Phases 9, 7, 14, 15 (agentic + observability)

| Phase | Objective | Modules | API |
| --- | --- | --- | --- |
| **9** Multi-agent orchestration | 7 role agents, central orchestrator, file-lock conflict detection | `core/agents/*` | `/api/agents/*` |
| **7** Browser automation | Playwright session manager, actions, screenshots, sensitive-action approval | `core/browser/*` | `/api/browser/*` |
| **14** Activity & notifications | activity log, notification centre, OS notifications (Electron) | `core/activity` | `/api/activity/*` |
| **15** Analytics | task/provider/tool metrics from **real** rows only | `core/analytics` | `/api/analytics` |

Dependencies: Layer 4. Analytics must never invent data — every number is a SQL aggregate.

## Layer 6 — Phase 10 (workflow engine) + agent runtime

| Phase | Objective | Modules | API |
| --- | --- | --- | --- |
| **10** Workflow engine | 9 block types, templates, pause/resume, execution history | `core/workflows/*` | `/api/workflows/*` |
| **5** Agent runtime | plan → validate → permission → execute → observe → verify → recover loop, hard limits | `core/agent/*` | `/api/agent/run` |

Dependencies: everything above (tools + providers + tasks + events).

## Layer 7 — Desktop shell (Phases: §4 architecture, §11 security)

| Item | Files |
| --- | --- |
| Electron main | `packages/desktop/main.ts` — secure window, CSP, owns API-key keychain, spawns Express |
| Preload | `packages/desktop/preload.ts` — frozen, channel allow-list, argument validation |
| IPC | `packages/desktop/ipc.ts` — dialog/clipboard/notifications/keychain/window control only |

## Layer 8 — UI

13 navigation surfaces (Dashboard, Chat, Projects, Codebase, Tasks, Terminal, Browser, Agents,
Workflows, Memory, Analytics, Activity, Settings) on a monochrome design system, with streaming chat,
diff review, approval controls, task inspector and live SSE activity.

## Testing requirements per layer

`node --test` suite compiled with the sources: storage/migrations, path guards, scanner ignore rules,
snapshot restore, command validation, patch/conflict detection, provider routing + fallback, context
budgeting, task state machine, agent loop limits (incl. infinite-loop protection), workflow blocks,
search ranking, memory secret guard, analytics aggregates, and Express route integration via `fetch`
against an ephemeral server. Electron/preload: contract tests. Live AI/Playwright: ⛔ blocked.

## Remediation of existing issues (minimal, no rewrite)

1. `src/services/aiService.js` — remove the in-browser API-key fallback path; route through the backend.
2. `docs/nexus/SECURITY-NOTES.md` — document S1–S5 and rotation instructions.

---

## Implementation status (2026-11-08)

Layers 0–8 are built. See `COMPLETION_MATRIX.md` for the per-feature verdict with evidence.

### Verification actually run

| Check | Command | Result |
| --- | --- | --- |
| Core test suite | `npm run test:build` | **82 tests, 82 pass, 0 fail** (11 suites) |
| Server typecheck | `tsc -p packages/server/tsconfig.json --noEmit` | clean |
| Desktop typecheck | `tsc -p packages/desktop/tsconfig.json --noEmit` | clean |
| UI typecheck | `tsc -p ui/tsconfig.json` | clean |
| Production build | `npm run build` | `dist/server/src/main.js` + `ui/dist` (471 kB JS, 15 kB CSS) |
| Live server | `NEXUS_SEED_DEMO=1 npm start` | serves UI + `/api` + SSE on `:4400` |
| Route smoke test | 12 endpoints incl. negative probes | all as expected (see below) |
| UI render test | jsdom mount of the real app against the live backend, all 13 surfaces | no React errors, real data rendered |

### Bugs found and fixed during implementation

1. **Workflow block limit threw out of the engine.** A workflow exceeding the 60-block ceiling raised `AGENT_LIMIT_EXCEEDED` from inside `execute`, leaving the execution row stuck in `running` forever. Fixed: the engine now persists `status:'failed'` with `error` + `finishedAt`, emits an error notification, and returns normally. Covered by a test.
2. **Runtime read a stale plan.** Dependency gating consulted the plan captured at task start, not `currentPlan`, so steps appended mid-run had their dependencies silently ignored. Fixed in `agent/runtime.ts`.
3. **`completed` was reachable without verification.** A task could be marked `completed` when some steps were `skipped`/`failed`. Fixed: every step must be `status === 'completed'`, and the verify step must pass.
4. **Cancellation left approvals hanging.** `AgentRuntime.cancel()` now calls `approvals.denyTask(...)`, so a cancelled run cannot leave a pending approval blocking a task forever.
5. **Router matched tool signals as substrings.** `'edit'` matched `'credit'`. Fixed with word-boundary matching.
6. **`decide()` could route before checking configuration.** It now throws `PROVIDER_NOT_CONFIGURED` rather than attempting a request with no key.
7. **UI scroll crash.** `element.scrollTo` is absent in some webviews; replaced with `scrollTop` assignment. Found by the jsdom render test.
8. **Renderer crash blanked the whole window.** Added an `ErrorBoundary` per surface, so one bad page shows an error card instead of a white screen.

### Deliberate non-goals

- Raw PTY shell (bypasses command validation and the audit trail).
- Parallel independent agent daemons (violates the single-orchestrator audit requirement).
- Drag-and-drop workflow canvas (definitions are authored via templates/API and rendered for inspection).
- Any fabricated analytics: undefined metrics render as `—`, with the reason shown.

### Storage: dual backend, async everywhere

SQLite (default) and MongoDB are both implemented behind one set of async store interfaces
(`storage/contracts.ts`). The backend is selected by `MONGODB_URI` and reported by `GET /api/health`
(`{ backend, location, version, serverVersion }`).

| Backend | Status | Evidence |
| --- | --- | --- |
| SQLite | **Verified** | 82/82 unit tests, 54/54 HTTP checks, live server on `dist/` |
| MongoDB | **Unverified — Blocked (environment)** | compiles clean, 85/85 contract methods present on 8 stores; no `mongod`/Docker in this sandbox, so no query has ever been executed against a server |

Shared semantics are replicated deliberately rather than assumed: `projectId: null` matches global
rows (`projectId = ? OR projectId IS NULL`), patch `undefined` keeps the existing value, memory revision
history keeps the last 20 entries, `messages(n)` returns the last N in ascending order, and cascades are
explicit multi-collection deletes because there are no foreign keys. A failed connection raises one
actionable `STORAGE_ERROR` and never silently falls back to SQLite.

### Environment-blocked (not code gaps)

| Capability | Blocker |
| --- | --- |
| Electron window | no display / no Electron binary in this sandbox |
| Live Playwright browser | Chromium not downloaded (`npx playwright install chromium` on a desktop) |
| Gemini/Groq calls, vision, embeddings | no API key supplied; `MockProvider` + `StubDriver` cover the code paths |
| MongoDB happy path | no `mongod` and no Docker in this sandbox — connect, indexes, reads, writes and cascades are unexecuted |
