# NEXUS AI — Step 1: Existing Repository Audit

Date: 2026-11-08
Branch audited: `6c28757` (`main`) — "Add robots.txt (block /private and /user from indexing), backend .gitignore, vercel env.local ignore"

## 1. What this repository actually is

| Aspect | Finding |
| --- | --- |
| Product | **MyGraph** — a public web app for creating/sharing graph & chart dashboards |
| Frontend | React 19.2 + Vite 7.2, plain JavaScript (`.jsx`), React Router 7, Framer Motion, Chart.js, react-markdown, SweetAlert2 |
| Backend | **Flask 2.3** (`backend/server.py`, 130 lines) — a single `/api/chat` proxy to the Groq REST API + `/health` |
| Data layer | **Firebase** (Auth, Realtime Database, Storage) — used directly from the browser (`src/firebase.js`, 805 lines) |
| Hosting | Vercel (frontend, `vercel.json`) + Render (backend, `backend/Procfile` → gunicorn) |
| Desktop shell | **None.** No Electron dependency, no `electron/` directory, no preload script, no IPC |
| Express | **None.** No Express server, no REST service in Node at all |
| SQLite / persistence abstraction | **None.** All persistence is Firebase RTDB through ad-hoc functions |
| Playwright | **None** |
| Tests | **None.** No test runner, no test files, no CI |
| TypeScript | **None.** `@types/*` packages exist but no `tsconfig.json` and zero `.ts/.tsx` files |

## 2. Architectural problems found

1. **No desktop architecture.** The specification's Electron → preload → main → Express chain does not exist.
   Every privileged capability (filesystem, processes, SQLite, Playwright) must be built from scratch.
2. **Secret exposure in the renderer.** `src/services/aiService.js` calls the Groq API **directly from the
   browser** using `VITE_GROQ_API_KEY`, and falls back to a live API key inlined into the client bundle.
   Any `VITE_*` variable is public by definition. This is a critical vulnerability (see §5).
3. **No AI-provider abstraction.** Groq model id (`openai/gpt-oss-120b`) is hardcoded in two places
   (`backend/server.py`, `src/services/aiService.js`). No Gemini integration at all, no capability
   validation, no routing, no usage accounting.
4. **Fat components / business logic in the UI.** `AIChat.jsx` (527 lines) performs persistence, URL
   management and network calls inline. No services layer on the frontend.
5. **Duplicated AI logic** across Flask and the React client, with slightly different prompts.
6. **No request validation** anywhere on the backend (`data.get('message')` only), CORS is effectively `*`
   (`origins=[..., "*"]`), and it coexists with an explicit allow-list — a contradictory config.
7. **Accessibility / UX debt** that is out of scope for this task (inline styles, gradient theme,
   no design system) — must not be refactored, per "preserve working code".
8. **Two empty stub pages** (`UserDashboard.jsx`, `UserGraphView.jsx`, 2 lines each) and an empty
   `src/Routes.jsx` — dead files, harmless.

## 3. Reusable assets

* Working Vite/React toolchain, ESLint 9 flat config (`npm run lint`, `npm run build`).
* Existing UI pages stay untouched and keep working; NEXUS AI is added as an **isolated subsystem** that
  does not import Firebase and does not change any existing route.
* Groq is an approved provider in the spec, so the existing provider choice is compatible.

## 4. Constraints of this build environment (important for honest reporting)

| Constraint | Consequence |
| --- | --- |
| No display / no X server, no Chromium installed | Electron **main process cannot be launched** here. It will be fully written, statically validated and lint-checked, but "app startup" is verified on the Express/React side and via a headless smoke test of the preload contract, not by opening a window. |
| `electron` binary download is large and not needed for verification | `electron`, `electron-builder` are declared as real dependencies; the postinstall binary is not fetched in this sandbox. |
| No Playwright browsers, restricted network (github/npm/pypi only) | Browser automation is implemented against `playwright`; browser *download* cannot be verified here. The browser tool layer is unit-tested with a **stub driver** so the agent/tool contracts are proven; live navigation is marked **Blocked (environment)** in the matrix. |
| No Gemini/Groq API keys | Provider calls are real HTTP clients but tests use a mocked transport. Live provider tests are marked **Blocked (credentials)**. |
| Node 22.22 ships `node:sqlite` (`DatabaseSync`) | SQLite works with **zero native compilation**. It is wrapped behind a storage abstraction so `better-sqlite3` (the Electron-packaged choice) can be swapped in for distribution. |

## 5. Security findings to fix in this work

| # | Severity | Finding | Action |
| --- | --- | --- | --- |
| S1 | Critical | Groq API key shipped to the browser (`VITE_GROQ_API_KEY`) | NEXUS keeps all keys in the backend/keychain; add a documented remediation note + lint-level guard |
| S2 | High | Backend CORS `*` | NEXUS Express uses a strict origin allow-list |
| S3 | High | No input validation | `zod` schemas on every route |
| S4 | Medium | Existing renderer would be a path-traversal risk if given Node access | NEXUS renderer keeps `contextIsolation: true`, `nodeIntegration: false`, sandboxed preload with an explicit channel allow-list |
| S5 | Medium | No audit trail | Tool registry writes an append-only audit log |

## 6. Decision

The repository contains **no part of NEXUS AI**. Building it requires a greenfield subsystem.
To respect "do not rewrite working code", NEXUS AI is implemented **inside this repo but isolated**:

```
nexus/                 <- new: all NEXUS AI code
  packages/
    shared/            types, contracts, zod schemas (used by backend + desktop + UI)
    core/              storage, providers, tools, agent, memory, search, workflow, browser, terminal
    server/            Express REST + SSE
    desktop/           Electron main + preload
    ui/                React 19 + TS + Vite NEXUS renderer (monochrome design system)
```

No file under `src/` (MyGraph) is modified except the two security/doc notes described in
`ROADMAP.md` §Remediation. The MyGraph app and NEXUS AI share nothing at runtime.

See `ROADMAP.md` for the dependency-aware phase plan and `FEATURE-MATRIX.md` for verified status.
