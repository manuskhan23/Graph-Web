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
| Core | `packages/core/src` | types, errors, config, storage (SQLite, 22 tables, migrations v1/v2), security, providers, project/indexing, context, search, snapshots, editor, terminal, tools, agents, agent runtime, browser, vision, tasks, workflows, jobs, memory, `app.ts` |
| Server | `packages/server/src` | `buildServer`, route modules (`projects`, `agent`, `platform`), SSE stream, CSP + origin allow-list, static UI |
| Desktop | `packages/desktop` | hardened `main.ts`, `preload.ts` (11 channels), `safeStorage` key vault, backend supervision |
| UI | `ui/src` | `App.tsx` shell, 13 pages, shared components, typed API client, monochrome design system |
| Tests | `packages/core/test` | 11 suites, **82 tests** |

## Providers — Google Gemini and Groq only

No OpenAI, Anthropic, Claude or any other provider. Capabilities are validated **before** a request is
sent; model IDs are configurable; a fallback is attempted only when capability, configuration and the
`allowCrossProviderFallback` policy all permit it. Missing key ⇒ `PROVIDER_NOT_CONFIGURED`, never a
silent substitution.

| Need | Provider | Default model |
| --- | --- | --- |
| Planning, reasoning, vision | Gemini | `gemini-2.5-pro` (vision forced to `gemini-2.5-flash`) |
| Low-latency, high-volume | Groq | `openai/gpt-oss-120b` |

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
| `NEXUS_DATA_DIR` | `~/.nexus-ai` | SQLite database, snapshots, secrets file |
| `NEXUS_SEED_DEMO=1` | off | Register + index this repository as a demo project |
| `GEMINI_API_KEY` | — | Enables Gemini |
| `GROQ_API_KEY` | — | Enables Groq |

No key at all? The app still runs: projects, indexing, search, terminal, memory, snapshots, workflows,
analytics and the UI all work; planning falls back to the deterministic heuristic planner and says so in
the answer.

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
this sandbox — is in **[`docs/nexus/COMPLETION_MATRIX.md`](../../docs/nexus/COMPLETION_MATRIX.md)**.
The audit that preceded the build is in [`docs/nexus/AUDIT.md`](../../docs/nexus/AUDIT.md), and the
dependency-ordered plan in [`docs/nexus/ROADMAP.md`](../../docs/nexus/ROADMAP.md).

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
