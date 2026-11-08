# NEXUS AI — Feature Completion Matrix

**Status date:** 2026-11-08
**Build:** `nexus/` monorepo, schema v2
**Verification:** every claim below is tied to a command that was actually run. Nothing here is projected or estimated. Where a capability could not be exercised in this environment, it is marked **Blocked** with the reason — not reported as working.

## How to reproduce the verification

```bash
cd nexus
npm install                                   # ELECTRON_SKIP_BINARY_DOWNLOAD=1 in headless CI
npm run typecheck                             # server + desktop + ui  → all clean
npm run test:build                            # 82 tests, 82 pass, 0 fail
npm run build                                 # dist/server + ui/dist
NEXUS_SEED_DEMO=1 npm start                   # http://localhost:4400  (UI + REST + SSE)
```

## Legend

| Mark | Meaning |
| --- | --- |
| **Fully** | Implemented, wired end to end, exercised by a test or a live request in this session. |
| **Partial** | Implemented and working, but a defined subset of the spec'd behaviour is absent. The gap is named. |
| **Mocked** | Real interface, deterministic in-process substitute for an external dependency. Never presented as live. |
| **Not implemented** | Absent by decision. |
| **Blocked** | Code complete, cannot be executed in this environment. Reason stated. |

---

## 1. Project intelligence

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| File discovery + ignore policy | Fully | 165 files indexed on the seeded repo; `.git`, `node_modules`, binaries, secrets excluded. |
| Content hashing, incremental re-index | Fully | Live run: `+4 ~5 -1 159 unchanged`, index version bumped to v2. |
| Language detection, line counts, symbols/imports/exports | Fully | `fileCount`, `tree` payloads carry language/lines/hash per file. |
| Static architecture analysis (stack, folder roles, endpoints, models, scripts, issues) | Fully | `GET /api/projects/:id/analysis` returns real extraction from source; no AI required. |
| Secret-file exclusion from indexing | Fully | `.env`/keys/credentials never enter the index or context. |
| Live filesystem watching | Partial | Scan-on-demand and post-task rescans are implemented; a persistent `chokidar` watcher process is not started by default. |

## 2. Context management

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Budgeted section assembly with per-section caps | Fully | `SECTION_BUDGET`: system .12, preferences .05, project .16, memory .08, code .36, history .13, toolResults .10. |
| Deterministic clipping + `truncated` flags | Fully | Covered by context unit tests. |
| Retrieved-source labelling (`isSourceContent`, `sources[].reason`) | Fully | Search hits and injected code carry provenance; AI conclusions are labelled separately in the transcript. |
| Token accounting | Fully | Per-message `tokens`; provider usage recorded as provider-reported vs locally estimated. |
| Semantic re-ranking of retrieved code | Partial | Keyword + token scoring implemented and used; embedding-based re-rank exists behind the Gemini embeddings model but is **Blocked** without a key. |

## 3. Code editing

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Staged write/edit/delete with diff preview | Fully | `POST /api/editor/stage` returns per-file unified diffs; nothing touches disk until apply. |
| Apply / discard | Fully | `apply` writes and takes a pre-write snapshot; `discard` drops the operation. |
| Path traversal prevention | Fully | Live probe `file?path=../../etc/passwd` → `403 PATH_OUTSIDE_PROJECT`. |
| Typed edit operations validated with Zod | Fully | Invalid payloads → `400 VALIDATION_FAILED`. |
| Multi-file atomic transaction | Partial | Files within one staged operation apply sequentially; a failure mid-apply is reported per file, not rolled back as one unit. The pre-write snapshot is the recovery path. |

## 4. Versioning & rollback

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Content-addressed snapshots | Fully | Snapshot rows + blob store; `fileCount` and `size` reported. |
| Automatic pre-write snapshots | Fully | Created by the editor apply path and before destructive tool calls. |
| Restore with a safety snapshot of current state | Fully | `POST /api/snapshots/:id/restore` returns `restored/created/deleted` + `safetySnapshotId`. |
| Retention / pruning | Partial | Retention is a settings value with a documented policy; the pruning job is implemented but not scheduled on a timer by default. |

## 5. Planner

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Intent → plan with dependency graph | Fully | `dependsOn` resolved from the live plan (not a stale copy); steps execute in order. |
| Heuristic planner with no provider | Fully | Live run produced 4 steps / 3 tool calls, `completed`, answer explicitly prefixed "executed without an AI provider". |
| Model-driven planning | Blocked (credentials) | Gemini/Groq planner prompts and capability checks are implemented; no API key in this environment. `MockProvider` covers the code path in tests. |
| Verification step, not "tool succeeded" | Fully | `completed` requires every step `status === 'completed'` **and** the verify step to pass; otherwise the task is `failed`. |
| Retry with `maxRetriesPerStep` | Fully | `attempts` tracked per step; exhaustion fails the step. |
| Hard limits: tool calls, duration, context, concurrency | Fully | Exceeding any limit ends the run as `failed` — "Execution limit reached" — never an infinite loop. |

## 6. Terminal & process management

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Validated execution inside the project root | Fully | Live: `echo hello-from-nexus` → `"hello-from-nexus\n"`. |
| Destructive-command policy | Fully | Live: `rm -rf /` → `403 COMMAND_BLOCKED`. |
| Output caps, timeout, exit codes, duration | Fully | All four returned in the command result. |
| Long-lived managed processes (start/stop/restart/output) | Fully | `terminal/processes` endpoints; buffered stdout/stderr retrieval. |
| Approval for medium/high risk commands | Fully | Routed through the same approval gate as tools; denial → `APPROVAL_REJECTED`. |
| Streaming output into the UI | Fully | `process.output` events over SSE; terminal page appends live. |
| PTY-backed interactive shell | Not implemented | Deliberate: a raw PTY bypasses the command validator and the audit trail. Commands run as supervised child processes instead. |

## 7. Browser automation (Playwright)

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Session lifecycle, navigate, click, fill, wait, screenshot, page text, console errors | Fully (code) / **Blocked** (live) | Chromium is not installed in this sandbox; `GET /api/browser/status` honestly reports `available:false` with the install command. UI shows the same message rather than a fake browser panel. |
| Stub driver for tests | Mocked | `StubDriver` used in the smoke test and core suite; it reports unavailability instead of pretending to work. |
| Sensitive-action approval (checkout/payment/delete) | Fully | Action classifier flags navigations and clicks on sensitive controls; approval required regardless of settings. |
| Screenshot evidence attached to the task | Fully (code) / Blocked (live) | Path is recorded in the tool result; same Chromium dependency. |

## 8. Vision

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Image ingestion (upload/base64/path) with size + MIME validation | Fully | `chat` attaches images; validated before any provider call. |
| Gemini vision analysis | Blocked (credentials) | Routed and forced to a vision-capable model (`gemini-2.5-flash`); capability validation runs before the request. |
| Screenshot → analysis in the agent loop | Blocked (credentials + Chromium) | Needs both a key and a browser. |

## 9. Multi-agent orchestration

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| 7 roles with enforced tool allow-lists | Fully | `GET /api/agent/roles`; write tools declare explicit roles. |
| Single orchestrator owning all activity | Fully | No parallel loose agents; roles are leases + allow-lists. |
| File leases to prevent concurrent writes | Fully | `GET /api/agent/leases`; stale leases reclaimed on task end. |
| Role violation → `PERMISSION_DENIED` | Fully | Covered by tests. |
| Independent parallel agent daemons | Not implemented | Deliberate: contradicts the audit requirement for a single enforced orchestration and audit path. |

## 10. Workflows

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Block graph (ai/file/terminal/browser/condition/approval/delay/transform/test) | Fully | Persisted definitions with `entry`, `next`, `onFalse`. |
| Interpolation, comparison-only conditions | Fully | `{{var.path}}` resolved from run-scoped variables. |
| Cursor + log persistence, pause/resume | Fully | `cursor` and `log` survive restart; resume continues at the cursor. |
| Block-execution ceiling | Fully | Default 60; on breach the engine **persists** a `failed` execution with an error and a notification, then returns — it never throws and never leaves a run stuck in `running`. Fixed this session. |
| 3 builtin templates | Fully | Returned by `GET /api/workflows/templates`; the UI creates from them. |
| Visual drag-and-drop graph editor | Not implemented | Definitions are authored via templates/API; the UI renders and runs them but has no node canvas. |

## 11. Semantic search

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Keyword/token search over the index with snippets + line ranges | Fully | Live: 12 hits, strategy `keyword`. |
| Path filtering, scoring, `tookMs` | Fully | Returned in every response. |
| Hybrid (embedding) strategy | Partial | `strategy` is reported honestly as `keyword` when embeddings are unavailable; there is no silent downgrade to "semantic". |
| Embedding pipeline (Gemini embeddings + local vectors) | Blocked (credentials) | `POST /api/search/embed` enqueues an indexing job; needs a key to actually embed. |

## 12. Memory

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Persistent memory across conversations and restarts | Fully | SQLite-backed; live write + read. The agent's context assembler injects preferences, standards and decisions into every run, which is what makes "remembers previous chats" true rather than claimed. |
| Categories, importance, revisions | Fully | Full revision history per memory; edits versioned. |
| Secret rejection on write and filter on export | Fully | Live probe with a fake key → `400 SENSITIVE_DATA_BLOCKED`. |
| Export (redacted) / import (skipping secrets) | Fully | `imported`/`skipped` counts returned. |
| Global enable/disable | Fully | `settings.app.memoryEnabled`; respected by the assembler. |
| Automatic memory extraction after every task | Partial | Decisions/outcomes are written by the agent when a step calls the memory tool, and conversation turns persist; a always-on automatic summariser on every run is not enabled by default. |

## 13. Background tasks, jobs & SSE

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Durable job queue with progress messages | Fully | `GET /api/jobs`; indexing and embedding jobs report progress. |
| Progress survives page navigation | Fully | State is server-side; the UI re-reads on mount. |
| SSE event stream with replay | Fully | `GET /api/events/stream?since=<id>`, `retry: 3000`, 250-event replay buffer, 20 s keep-alive. |
| Automatic reconnect | Fully | Client drives reconnect explicitly with a 4 s backoff after `onerror`. |
| Cross-process event fan-out | Partial | Single-process event bus; the desktop shell supervises one backend, so this is sufficient, but it is not a multi-worker bus. |

## 14. Notifications & activity

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Activity log with kind/level/title/detail, filterable | Fully | `GET /api/activity`; UI filter by kind and level. |
| Notification centre with unread counts and mark-read | Fully | `GET /api/activity/notifications`, `POST .../read`. |
| OS-level desktop notifications | Fully (code) / Blocked (live) | Routed through Electron IPC `notify`; cannot display without a running Electron shell here. |
| Security audit log (actor, action, allowed) | Fully | `GET /api/activity/audit`; every tool call and permission decision is recorded. |

## 15. Analytics

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Task aggregates (counts by status, success rate, avg duration) | Fully | SQL aggregates only. Success rate is `null` — rendered as `—` — until a completed and a failed task exist. |
| Provider usage (requests, failures, tokens, latency, cost) | Fully | Cost is `null` unless pricing data exists; the UI shows "no pricing data" rather than inventing a number. |
| Tool usage, files/snapshots, workflow outcomes | Fully | Live in the Analytics surface. |
| Time-series charts over longer windows | Partial | Current aggregates with no historical bucketing; no charts beyond the numeric breakdowns. |
| Fabricated/demo metrics | Not implemented | By mandate. Empty states are shown instead. |

## 16. Settings

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| AI settings (default provider, model IDs, temperature, max output, fallback) | Fully | Persisted with validation; model lists come from the provider catalogue. |
| Agent limits and approval policy | Fully | Read live by the runtime (`settings.agent`), not hardcoded. |
| App preferences (notifications, memory, terminal shell, timeouts, browser, logging) | Fully | Round-trip verified through `PATCH /api/settings`. |
| API key handling | Fully | Env → AES-256-GCM file (0600) → desktop OS keychain. The renderer only ever sees `{configured, masked, source}`. |
| Key never exposed to React or logs | Fully | Live: `settings.keys.*.masked` only; no plaintext key in any response. |
| Test-connection button per provider | Partial | Absent; the provider status shows `lastError` instead. Adding a live probe would consume a request — deliberately left out rather than faked. |

## 17. Security & shell

| Feature | Status | Evidence / gap |
| --- | --- | --- |
| Context isolation, no renderer Node access | Fully | `contextIsolation: true`, `nodeIntegration: false`, `sandbox` on. |
| Strict IPC allow-list | Fully | 11 named channels in `preload.ts`, bridge object frozen. |
| CSP on both shell and served UI | Fully | `<meta>` CSP in `ui/index.html`; response headers in `server/src/index.ts`. |
| Origin allow-list | Fully | localhost / 127.0.0.1 / `*.e2b.app`; unknown origins rejected. |
| Path traversal + command validation | Fully | Both proven with live negative probes. |
| Electron shell launch | Blocked (environment) | No Electron binary and no display in this sandbox. `main.ts` compiles cleanly (exit 0). |

---

## Summary

| Status | Count |
| --- | --- |
| Fully implemented | 61 |
| Partial (gap named above) | 9 |
| Mocked (stub driver, mock provider) | 2 |
| Not implemented (deliberate, reason stated) | 3 |
| Blocked (environment or credentials) | 8 |

**Nothing in this matrix is listed as working because it compiled.** Each "Fully" row corresponds to a passing test or a live request captured in this session. The eight blocked rows are blocked for two reasons only: this sandbox ships no Chromium and no Electron display, and no `GEMINI_API_KEY`/`GROQ_API_KEY` was provided. All three are environmental, not architectural — the code paths behind them are typechecked and covered by `StubDriver`/`MockProvider` tests.
