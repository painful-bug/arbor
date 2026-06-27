# Loom — codebase guide for Claude

## Architecture

Monolith with two packages:

```
frontend/   — SvelteKit UI + thin Tauri shell (Rust)
backend/    — TypeScript/Bun, all processing, local HTTP/SSE API
```

**Rule: frontend = UI only. All data, AI, and file processing lives in backend.**

### Transport

Backend binds `127.0.0.1` on a free port (tries 8765+) and prints one handshake line:

```
LOOM_BACKEND {"port":NNNN,"token":"<hex>"}
```

Rust captures this on startup, stores `{port, token}`, exposes them via `backend_info()` Tauri command.

Frontend `src/lib/api.ts` → `apiFetch()` prefixes every request with `http://127.0.0.1:PORT` and `Authorization: Bearer <token>`. The token is the localhost trust boundary — no cookies, no CORS credentials.

Agent streaming uses SSE (`POST /api/agent/prompt` → `text/event-stream`). Cancel via `POST /api/agent/:cardId/cancel`.

### Data dir: `~/.loom`

```
~/.loom/loom.db          — SQLite (canvases, settings, blob metadata)
~/.loom/lancedb/         — vector store (one table per canvas)
~/.loom/blobs/           — raw file bytes
~/.loom/models/          — transformers.js model cache (BGE-small-en-v1.5)
```

Legacy `~/.loom/canvases/*.json` + `settings.json` are imported once on first boot by `backend/src/store/import-legacy.ts` and left in place as backup.

---

## Backend (`backend/`)

Runtime: **Bun**. Framework: **Hono**.

```
src/
  server.ts              — app factory, port scan, handshake, spawn entry
  paths.ts               — LOOM_DIR, BACKEND_HANDSHAKE_FILE
  routes/
    agent.ts             — POST /api/agent/prompt (SSE), POST /api/agent/:id/cancel
    rag.ts               — POST /api/rag/:canvas/files, GET /api/rag/:canvas/search
    keys.ts              — PUT/GET /api/keys/:provider, POST /api/providers/:provider/test
    canvases.ts          — GET/PUT /api/canvases, CRUD /api/canvases/:id
    settings.ts          — GET/PUT /api/settings
    blobs.ts             — PUT/GET /api/blobs/:id
    files.ts             — GET /api/files/read, GET /api/files/read-bytes, POST /api/files/write
  agent/
    run.ts               — handlePrompt(), runs map (cancel), Bun.secrets for keys
    providers.ts         — pi-ai provider catalog
    tools.ts             — web search, scholar search, rag_search, research plan tools
  rag/
    index.ts             — addFile(), search() — LanceDB + transformers.js BGE-small
    loaders.ts           — MIME→LangChain loader registry
  store/
    db.ts                — Drizzle schema + DB singleton
    import-legacy.ts     — one-time ~/.loom JSON → SQLite import
  secrets/               — (keytar wrapper if extracted from routes/keys.ts)
```

### Key libraries
| Purpose | Library |
|---|---|
| Vector store | `@lancedb/lancedb` (embedded, table per canvas) |
| Embeddings | `@xenova/transformers` — `Xenova/bge-small-en-v1.5`, cache `~/.loom/models` |
| Chunking | `RecursiveCharacterTextSplitter` (~800/120) |
| Persistence | `bun:sqlite` + Drizzle ORM |
| Secrets | `Bun.secrets` (OS keychain, service `"app.loom.canvas"`) |
| Agent | `@mariozechner/pi-agent-core` + `pi-ai` + `pi-coding-agent` v0.73.1 |
| Web framework | Hono |

### Auth
All `/api/*` routes require `Authorization: Bearer <token>`. `GET /health` is unauthenticated. Bearer token is random 24-byte hex generated at startup.

### Adding an API route
1. Create `backend/src/routes/foo.ts` — export `const fooRoutes = new Hono()`.
2. Wire in `server.ts`: `import { fooRoutes } from "./routes/foo.ts"` + `app.route("/api/foo", fooRoutes)`.
3. Add a test in `backend/src/routes/foo.test.ts`.

### Adding a file loader
In `backend/src/rag/loaders.ts` — add a MIME key to the loader registry. Loaders must return `Document[]` with `pageContent: string`.

### Adding an agent tool
In `backend/src/agent/tools.ts` — define a TypeBox schema + return an `AgentTool` object. Wire into the tools array in `backend/src/agent/run.ts`.

### Tests
```bash
cd backend && bun test
```
24 tests across 6 files. Agent tests don't hit a real LLM — they verify SSE plumbing and graceful no-key error path.

---

## Frontend (`frontend/`)

Runtime: **SvelteKit 2 + Svelte 5 runes**. Bundler: **Vite 8**.

```
src/lib/
  api.ts                 — apiFetch(), backendBase() (memoized backend_info call)
  ai/
    client.ts            — runAgent() SSE reader, cancelAgent(), testConnection(), ragAdd()
    workflows.ts         — system prompt templates per workflow
  canvas/
    Canvas.svelte        — main canvas, drag-drop → /api/files/read-bytes → ragAdd
    store.svelte.ts      — canvas state, persisted via /api/canvases
    AgentTimeline.svelte — tool event display
  files.ts               — readFile/writeFile → /api/files/*, openPath → Tauri invoke
  settings/
    store.svelte.ts      — settings state, persisted via /api/settings
```

### Tauri IPC (the only two remaining commands)
- `backend_info()` → `{ port: number, token: string }` — called once at startup
- `open_path(path)` → opens file/URL with OS default handler

Everything else (keys, canvases, settings, blobs, RAG, agent, file read/write) is HTTP to the backend.

### Browser-dev fallback
`apiFetch` checks `__TAURI_INTERNALS__`; in browser dev mode it hits `http://127.0.0.1:8765` with `VITE_DEV_TOKEN`. `runAgent` falls back to a synthetic echo when the backend is unreachable.

---

## Rust shell (`frontend/src-tauri/`)

**Keep thin.** `lib.rs` has exactly two commands plus the `run()` entry point:
- `backend_info()` — returns `{ port, token }` from managed `Backend` state
- `open_path()` — `app.shell().open(path)`

`backend.rs` — spawns `bun backend/src/server.ts`, reads handshake line, drains stdout to log, kills child on `RunEvent::Exit`.

**Do not add new Rust commands.** If you need a new capability, add a backend HTTP route instead.

---

## Dev workflow

```bash
# Terminal 1: backend watch
cd backend && bun run dev

# Terminal 2: frontend (Tauri dev)
npm run dev            # from repo root — runs tauri dev which runs vite
```

Or just `npm run dev` from root which does both via `cd frontend && npx tauri dev` (Tauri's `beforeDevCommand` starts Vite).

---

## Core directives (do not violate)

1. **No feature may regress** — only improve.
2. **Library-first** — never hand-roll what a battle-tested library provides (RAG, embeddings, chunking, persistence, HTTP).
3. **Frontend = UI only** — no data processing, no secrets, no direct filesystem access except via backend API.
4. **Human-readable, simple code** — shortest diff that works; no speculative abstractions.
5. **Root-cause fixes** — never patch a bug with a workaround that hides the symptom.
6. **`~/.loom` is the data dir** — never change this; existing users' data lives here.
7. **Secrets never cross to the webview** — keys stay in `Bun.secrets`; UI only sees presence boolean.
