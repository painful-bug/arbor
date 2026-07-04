# Phase 2 — Shared utilities & dedup

1. **Goal** — One home each for config constants, typed errors, logging, HTTP fetch, and debounce; dead code deleted. All prior scattered/duplicated sites redirected.
2. **Why** — Findings: 16 magic constants across 7 files; ~20 ad-hoc error responses; ~8 hand-rolled debounces; duplicated fetch handling in tools.ts + contextualize.ts; dead vitest-examples.
3. **Preconditions** — Phase 1 done (lint/typecheck gates green).
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `backend/src/config.ts` | CREATE | Exports (all `export const`, CONSTANT_CASE, one JSDoc line each, values copied from current sites): `HOST = "127.0.0.1"`, `FIRST_PORT = 8765` (from server.ts:21-22); `KB_CHUNK_SIZE = 800`, `KB_CHUNK_OVERLAP = 120` (chunk.ts:6-7); `RERANK_STRONG = 0.5`, `RERANK_WEAK = 0.05` (kb/index.ts:20-21); `ARRANGE_SIM_K = 4`, `ARRANGE_SIM_FLOOR = 0.3`, `ARRANGE_TICKS = 400`, `ARRANGE_PAD = 36`, `ARRANGE_REF_GAP = 8` (arrange.ts:50-54); `CONTEXTUALIZE_BATCH = 5` (contextualize.ts:100); `OLLAMA_SEARCH_PATHS: string[]` (ollama.ts:7-12); `HTTP_TIMEOUT_MS = 15_000` (new, used by http.ts); `SERVER_IDLE_TIMEOUT_S = 120` (new, consumed in Phase 5). Update every listed origin site to import from config.ts and delete the local constant. Grep `rg "8765|SIM_K|STRONG|OVERLAP"` backend/src to confirm no stragglers. | None. |
| `backend/src/errors.ts` | CREATE | ```ts
/** Structured application error carried across layers to the HTTP boundary. */
export class AppError extends Error {
  constructor(
    message: string,
    /** HTTP status the boundary should respond with. */ readonly status: number = 500,
    /** Stable machine-readable code, SCREAMING_SNAKE. */ readonly code: string = "INTERNAL",
  ) { super(message); this.name = "AppError"; }
}
/** Convenience 4xx factories. */
export const badRequest = (m: string) => new AppError(m, 400, "BAD_REQUEST");
export const notFound = (m: string) => new AppError(m, 404, "NOT_FOUND");
``` | None. |
| `backend/src/log.ts` | CREATE | Minimal leveled console wrapper (no dep — sidecar stays lean; ponytail ceiling: swap for pino if log volume ever matters): ```ts
type Level = "info" | "warn" | "error";
const ORDER = { info: 0, warn: 1, error: 2 } as const;
const MIN = (process.env.ARBOR_LOG_LEVEL as Level) ?? "info";
function emit(level: Level, scope: string, msg: string, data?: unknown) {
  if (ORDER[level] < ORDER[MIN]) return;
  const line = `[${scope}] ${msg}`;
  data === undefined ? console[level](line) : console[level](line, data);
}
/** Structured, leveled logger. Scope = module tag e.g. "kb", "agent". */
export const log = {
  info: (s: string, m: string, d?: unknown) => emit("info", s, m, d),
  warn: (s: string, m: string, d?: unknown) => emit("warn", s, m, d),
  error: (s: string, m: string, d?: unknown) => emit("error", s, m, d),
};
``` NOTE: the `ARBOR_BACKEND {...}` handshake println in server.ts is protocol, NOT logging — leave it as bare console/stdout write. | None. |
| `backend/src/http.ts` | CREATE | ```ts
import { HTTP_TIMEOUT_MS } from "./config.ts";
import { AppError } from "./errors.ts";
/**
 * fetch → parsed JSON with timeout. Throws AppError(status:502, code:"UPSTREAM")
 * on non-2xx or network failure; AppError(504,"UPSTREAM_TIMEOUT") on timeout.
 */
export async function fetchJson<T>(url: string, init?: RequestInit, timeoutMs = HTTP_TIMEOUT_MS): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
    .catch((e) => { throw e?.name === "TimeoutError" ? new AppError(`timeout: ${url}`, 504, "UPSTREAM_TIMEOUT") : new AppError(`fetch failed: ${url}: ${e?.message}`, 502, "UPSTREAM"); });
  if (!res.ok) throw new AppError(`${res.status} from ${url}`, 502, "UPSTREAM");
  return res.json() as Promise<T>;
}
``` Redirect call sites in `agent/tools.ts:20-87` (Tavily, DDG, OpenAlex, arXiv fetches — where a site needs raw text not JSON, add sibling `fetchText` with identical contract but `res.text()`) and `kb/contextualize.ts:19-89` provider fetches (keep their provider-specific headers/body building; only the fetch+status-check+parse goes through fetchJson). | None. |
| `backend/src/server.ts` | MODIFY | Add central error boundary after app creation: `app.onError((err, c) => { const e = err instanceof AppError ? err : new AppError(err.message ?? "internal error"); log.error("http", e.message); return c.json({ error: e.message, code: e.code }, e.status); })`. Response keeps `error: string` key → no frontend regression; `code` is additive. Existing per-route try/catch that merely reformat errors: delete the catch and let onError handle it — EXCEPT catches that return domain fallbacks (e.g. cleanup.ts returns `{layout:null}`): keep those. Import HOST/FIRST_PORT from config.ts. | None. |
| `frontend/src/lib/debounce.ts` | CREATE | ```ts
/** Debounce fn by ms. Returned fn has .cancel() and .flush() (flush runs pending call now). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null; let last: A | null = null;
  const run = (...a: A) => { last = a; if (t) clearTimeout(t); t = setTimeout(() => { t = null; fn(...(last as A)); }, ms); };
  run.cancel = () => { if (t) clearTimeout(t); t = null; last = null; };
  run.flush = () => { if (t) { clearTimeout(t); t = null; fn(...(last as A)); } };
  return run;
}
``` Redirect ALL of: store.svelte.ts:164 (save 400ms), :628 (KB index 2000ms), :1022 (settings 400ms); Canvas.svelte:618 (save 400ms), :708 (KB search 200ms); globalSearch.svelte.ts:189-190 (120ms + 260ms — two separate debounced fns); autolink.ts:105 (800ms); PdfViewer.svelte:199 (200ms), :262 (render). Settings status-reset timeouts (settings/+page.svelte:91,110,187) are NOT debounces — leave. Keep each existing ms value exactly. | None. |
| `frontend/src/lib/vitest-examples/` | DELETE | Delete directory (greet.ts, greet.spec.ts). Verify orphan: `rg "vitest-examples|greet" frontend/src` must return only these files pre-delete. | None. |
| `frontend/src/lib/canvas/Canvas.svelte` | MODIFY | Line 2: remove unused `Controls` from the SvelteFlow import list (verify with `rg "<Controls" frontend/src` → no hits). | None. |

5. **New features** — none.
6. **Tests to add/update**
   - `backend/src/errors.test.ts`: AppError carries status/code; server onError maps AppError→`{error,code}`+status and generic Error→500 (use existing route-test harness in `routes/test-utils.ts`).
   - `backend/src/http.test.ts`: fetchJson happy path (Bun.serve stub returning JSON); non-2xx → AppError code UPSTREAM; timeout path with 1ms timeout against a hanging stub → UPSTREAM_TIMEOUT.
   - `frontend/src/lib/debounce.test.ts` (Vitest fake timers): coalesces rapid calls to one trailing call with last args; cancel prevents call; flush fires immediately.
   - Existing suites stay green (proves constant/debounce redirects preserved values).
7. **Docs/README deltas** — none. But MODIFY `CLAUDE.md`: replace stale `rag/` section paths with `kb/` layout (index/store/chunk/embeddings/rerank/contextualize/cloud-ocr), and add one line each for config.ts/errors.ts/log.ts/http.ts under the backend tree diagram.
8. **Definition of Done**
   - [ ] all listed files changed as specified; greps in manifest run and clean
   - [ ] tests added and passing (backend + frontend)
   - [ ] `npx biome check .` and typechecks clean
   - [ ] no TODOs left unresolved without a linked follow-up phase
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 3.**
