# NEXUS AI

An autonomous desktop engineering agent: it inspects a real codebase, plans, executes tools under
permission control, verifies the result, and reports honestly — including when it fails.

**Not a chatbot wrapper.** The agent loop, tool registry, permission gate, audit log and storage
abstraction are the product; the LLM is one replaceable component inside it.

---

## Stack

```
Electron (context isolation, frozen preload bridge)
        │  11-channel IPC allow-list · OS keychain
        ▼
Express REST API + SSE        ← single process owns state and audit
        │
        ├── packages/core    agent runtime · tools · providers · storage · planner
        ▼
React 19 + TS renderer (13 surfaces, strict monochrome)
```

| Layer | Path | Contents |
| --- | --- | --- |
| Core | `packages/core/src` | types, errors, config, storage (**dual backend: SQLite or MongoDB**), security, providers, project/indexing, context, search, snapshots, editor, terminal, tools, agents, agent runtime, browser, vision, tasks, workflows, jobs, memory, `app.ts` |
| Server | `packages/server/src` | `buildServer`, route modules (`projects`, `agent`, `platform`), SSE stream, CSP + origin allow-list, static UI |
| Desktop | `packages/desktop` | hardened `main.ts`, `preload.ts` (11 channels), `safeStorage` key vault, backend supervision |
| UI | `ui/src` | `App.tsx` shell, 13 pages, shared components, typed API client, monochrome design system |
| Tests | `packages/core/test` | 11 suites, **82 tests** |

## Providers — Google Gemini and Groq only

No OpenAI, Anthropic, Claude or any other provider. Capabilities are validated **before** a request is
sent; model IDs are configurable; a fallback is attempted only when capability, configuration and the
`allowCrossProviderFallback` policy all permit it. Missing key ⇒ `PROVIDER_NOT_CONFIGURED`, never a
silent substitution.

### Model versions in this build

Every ID below was checked against the providers' own documentation on **2026-11-08**
(`ai.google.dev/gemini-api/docs/models`, `console.groq.com/docs/deprecations`). IDs live in
`packages/core/src/providers/models.ts` and `GET /api/models` reports the same table the router uses.

**Google Gemini**

| Role | Model ID | Context | Notes |
| --- | --- | --- | --- |
| Default (planning, reasoning, tools) | `gemini-3.8-flash` | 1,048,576 | Also the vision model |
| Vision | `gemini-3.8-flash` | 1,048,576 | `VISION_MODEL` constant |
| Previous generation | `gemini-3.6-flash` | 1,048,576 | Retained for comparison |
| High reasoning (preview) | `gemini-3.1-pro-preview` | 1,048,576 | Preview — may change without notice |
| Embeddings | `gemini-embedding-001` | 2,048 | `EMBEDDING_MODEL`; drives semantic search |
| Embeddings (multimodal) | `gemini-embedding-2` | 8,192 | Selectable, not the default |

**Groq**

| Role | Model ID | Context | Notes |
| --- | --- | --- | --- |
| Default (low-latency) | `openai/gpt-oss-120b` | 131,072 | Falls back here only when policy allows |
| Cheaper/smaller | `openai/gpt-oss-20b` | 131,072 | ~1000 tok/s class |
| Alternative | `qwen/qwen3.6-27b` | 131,072 | No list price captured |
| Speech-to-text | `whisper-large-v3-turbo` | — | Audio only, no text generation |

**IDs deliberately not shipped** — they are retired and would 404 at runtime:
`gemini-2.5-pro` / `gemini-2.5-flash` (auto-route away on 2026-12-01),
`gemini-2.0-flash` and `gemini-3-pro-preview` (shut down), `text-embedding-004` (superseded),
`llama-3.3-70b-versatile` (shut down 2026-08-16).

Model IDs drift faster than application code. `GET /api/models` is the single source of truth for what
this build will actually request; the router rejects an unknown or incapable model **before** sending a
request instead of failing mid-task.

## Quick start

```bash
cd nexus
npm install          # add ELECTRON_SKIP_BINARY_DOWNLOAD=1 in headless/CI environments
npm run build        # server → dist/, UI → ui/dist
npm start            # http://localhost:4400
```

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEXUS_PORT` | `4400` | HTTP port |
| `NEXUS_DATA_DIR` | `~/.nexus-ai` | SQLite database, artifacts, secrets file |
| `MONGODB_URI` | — | Switches storage to MongoDB (see below) |
| `MONGODB_DB` | `nexus` | MongoDB database name |
| `MONGODB_COLLECTION_PREFIX` | `nexus_` | Prefix applied to every collection |
| `NEXUS_SEED_DEMO=1` | off | Register + index a demo project on first start |
| `NEXUS_DEMO_ROOT` | parent repo, else this repo | Directory to seed when `NEXUS_SEED_DEMO=1` |
| `GEMINI_API_KEY` | — | Enables Gemini |
| `GROQ_API_KEY` | — | Enables Groq |

No key at all? The app still runs: projects, indexing, search, terminal, memory, snapshots, workflows,
analytics and the UI all work; planning falls back to the deterministic heuristic planner and says so in
the answer.

## Storage backends

Storage is chosen at startup from one variable and exposed as async store interfaces
(`packages/core/src/storage/contracts.ts`), so nothing above the storage layer knows which
backend is live. `GET /api/health` reports it: `{ database: { backend, location, version, serverVersion } }`.

| Backend | Selected when | Notes |
| --- | --- | --- |
| **SQLite** (default) | `MONGODB_URI` unset | `node:sqlite`, WAL, schema v2, 23 tables, migrations |
| **MongoDB** | `MONGODB_URI` set | 8 collections + indexes, schema v2, cascades written by hand |

```bash
MONGODB_URI='mongodb+srv://user:pass@cluster.example.net/nexus' npm start
```

MongoDB design notes:

- `_id` is the application id string (`prj_…`, `tsk_…`) so ids are identical on both backends.
- Documents are camelCase with epoch-millisecond numbers — no `Date` objects on the wire.
- Uniqueness (`projects.root_path`) becomes a unique index, created idempotently on connect.
- There are no foreign keys: `ProjectStore.remove` and `SnapshotStore` cascades are explicit
  multi-collection deletes.
- `projectId: null` matches global rows, mirroring the SQL `(projectId = ? OR projectId IS NULL)`.
- The URI is never logged or returned; `/api/health` shows a redacted form (`mongodb://user:***@host/db`).

**Verification status — stated plainly.** The MongoDB backend compiles, its 85 contract methods are
present on all 8 stores, and a failed connection produces a single actionable `STORAGE_ERROR`. But
this environment has **no `mongod` and no Docker**, so the Mongo happy path — connect, index creation,
every read/write, and the cascades — has **never been executed against a real server**. It is
**unverified**, not "working". SQLite is the backend that the 82 tests and the 54-check HTTP suite
actually run against. Treat MongoDB as reviewable code that needs a live cluster before you rely on it.

Setting an unreachable `MONGODB_URI` fails loudly at startup rather than silently falling back to
SQLite:

```
NexusError [STORAGE_ERROR]: Cannot reach MongoDB at mongodb://… .
Check MONGODB_URI, the server status and any IP allow-list.
```

## Desktop shell

```bash
npm run build && npm run desktop     # requires an Electron binary and a display
```

The renderer has no Node access. All privileged operations go through the preload bridge, which exposes
exactly eleven channels and freezes the bridge object. API keys live in the OS keychain (`safeStorage`)
and are refused if the platform cannot encrypt them.

## Agent lifecycle

```
intent → context → plan → validate → tool select → permission → execute
       → observe → verify → recover → report
```

- A task is `completed` only when **every** step completed **and** the verification step passed.
- Hard caps on tool calls, duration, retries per step, context tokens and concurrency; breaching one
  fails the run with "Execution limit reached" — no infinite loops.
- Risk levels (low/medium/high) with an approval gate; denials produce `APPROVAL_REJECTED`, not a retry
  around the gate. Cancelling a task denies its outstanding approvals.
- AI-generated instructions are treated as untrusted input. Every tool call and permission decision is
  written to the security audit log.

## Security

| Control | Implementation |
| --- | --- |
| Context isolation | `contextIsolation: true`, `nodeIntegration: false`, sandboxed renderer |
| IPC | named-channel allow-list, argument validation, frozen bridge |
| CSP | meta tag in `ui/index.html` + response header from the server |
| Origin allow-list | localhost / 127.0.0.1 / `*.e2b.app`; everything else rejected |
| Path traversal | every file tool resolves inside the project root; `../../etc/passwd` → `403 PATH_OUTSIDE_PROJECT` |
| Commands | validated against a destructive-command policy before spawn; `rm -rf /` → `403 COMMAND_BLOCKED` |
| Secrets | never returned to the renderer (masked fingerprint only), never logged, rejected from memory writes |
| Indexing | `.env`, keys, credentials, binaries and dependency folders are excluded |

## Verification

```bash
npm run test:build     # 82 tests, 82 pass, 0 fail
npm run typecheck      # server + desktop + ui, all clean
```

The full per-feature verdict — including what is partial, mocked, deliberately absent, or blocked by
this sandbox — is in **[`docs/COMPLETION_MATRIX.md`](docs/COMPLETION_MATRIX.md)**.
The audit that preceded the build is in [`docs/AUDIT.md`](docs/AUDIT.md), and the
dependency-ordered plan in [`docs/ROADMAP.md`](docs/ROADMAP.md).

Metrics shown in the product are SQL aggregates over real rows. Where a number cannot be known it
renders as `—` with the reason attached; nothing is fabricated.

## Repository layout

```
nexus/
├── packages/
│   ├── core/      agent runtime + tools + storage (all logic, 82 tests)
│   ├── server/    Express API, SSE, static UI host
│   └── desktop/   Electron main + preload
├── ui/            React renderer (13 surfaces)
└── dist/          build output (git-ignored)
```

The host repository's existing **MyGraph** application is untouched; NEXUS lives entirely in `nexus/`.
