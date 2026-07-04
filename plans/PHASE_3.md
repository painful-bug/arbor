# Phase 3 — Backend restructure

1. **Goal** — tools.ts split into domain modules; LLM completion has one home; routes are thin; SSE has heartbeat; ollama pull dies on client abort; backend console.* → log.
2. **Why** — tools.ts 430L god-file; contextualize.ts duplicates provider calling; cleanup route embeds inline (mixed concerns); unkillable ollama pull (power leak); hung agent runs invisible to client.
3. **Preconditions** — Phase 2 done (config/errors/log/http exist).
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `backend/src/agent/tools/web-search.ts` | CREATE (from split) | Move Tavily + DDG search functions and their AgentTool definitions verbatim from tools.ts. Exports: the tool factory/objects currently exported for web search plus nothing else. | None. |
| `backend/src/agent/tools/scholar.ts` | CREATE (from split) | Move OpenAlex + arXiv search, `reconstructAbstract()`, `mergePapers()`, `formatPapers()` and scholar AgentTool defs verbatim. Un-export the three helpers (internal only — findings show no external consumers; verify `rg "reconstructAbstract|mergePapers|formatPapers" backend/src --glob '!agent/tools*'` → no hits). | None. |
| `backend/src/agent/tools/research.ts` | CREATE (from split) | Move research-plan tool(s) verbatim. | None. |
| `backend/src/agent/tools/kb.ts` | CREATE (from split) | Move KB tool factories (rag/kb search tools) verbatim. | None. |
| `backend/src/agent/tools/index.ts` | CREATE | Re-export everything the old tools.ts exported, from the four new modules, preserving every export name — so `agent/run.ts` changes only its import path (`"./tools.ts"` → `"./tools/index.ts"`). | None. |
| `backend/src/agent/tools.ts` | DELETE | After split. Verify: `rg 'from "./tools(\.ts)?"' backend/src` shows only the updated run.ts import; `rg "agent/tools\b" backend frontend` → no other hits. Move/merge `tools.test.ts` → `agent/tools/web-search.test.ts` + `scholar.test.ts` (split existing DDG + scholar tests along module lines). | None. |
| `backend/src/agent/llm.ts` | CREATE | Single non-streaming completion helper — move the three provider branches out of contextualize.ts verbatim: ```ts
export interface CompleteReq { provider: "anthropic" | "google" | "openai-compat"; baseUrl?: string; model: string; apiKey: string; system?: string; prompt: string; maxTokens?: number; }
/** One-shot text completion. Throws AppError on upstream failure. */
export async function completeText(req: CompleteReq): Promise<string>
``` Body = the existing header/body construction + response-shape extraction from contextualize.ts:19-89, switched over `req.provider`, all HTTP via `fetchJson`. If current contextualize supports exactly N providers, `provider` union must list exactly those N (adjust union to match reality — the sweep saw anthropic/google/openai-compat). | None. |
| `backend/src/kb/contextualize.ts` | MODIFY | Delete inlined provider-fetch code; call `completeText()`. Keeps: settings/key lookup, batch loop (`CONTEXTUALIZE_BATCH` from config), prompt template, result mapping. Net size target ≤ 90 lines. | None. |
| `backend/src/cleanup/arrange.ts` | MODIFY | Add exported orchestrator so route is thin: `export async function arrangeCanvas(nodes: ArrangeReqNode[], edges: ArrangeEdge[])` — moves the embed-all-node-texts batch (currently in routes/cleanup.ts:21-51) here, then calls existing `arrange()`. `arrange()` itself unchanged. | None. |
| `backend/src/routes/cleanup.ts` | MODIFY | Route body: parse JSON → `arrangeCanvas(...)` → `c.json({layout})`; keep existing catch→`{layout:null}` fallback. | None. |
| `backend/src/routes/agent.ts` | MODIFY | SSE heartbeat: inside `/prompt`, after creating writer, `const hb = setInterval(() => writer.write(enc.encode(": ping\n\n")).catch(() => {}), 25_000);` and in the existing `.finally(...)` add `clearInterval(hb)`. 25s chosen: < typical 30s proxy/TCP idle cutoffs, only runs during an active agent run (no idle cost). | None. |
| `backend/src/routes/ollama.ts` | MODIFY | Pull route: after `Bun.spawn(...)`, register `c.req.raw.signal.addEventListener("abort", () => proc.kill())`; also `clearInterval`-equivalent cleanup in stream close path (call `proc.kill()` if stream consumer errors). List route uses `spawnSync` — leave. | None. |
| backend-wide console.* | MODIFY | Replace every `console.log/error/warn` in backend/src (≈6 sites, `[KB]`/`[arbor]` prefixes) with `log.info/error/warn("<scope>", ...)`, scope = existing bracket tag lowercased. EXCEPTION: the handshake stdout line in server.ts stays raw. Verify `rg "console\." backend/src --glob '!*test*'` → only handshake remains. | None. |
| exported symbols touched this phase | MODIFY | Add JSDoc per global conventions to every export in the new/modified files above. | None. |

5. **New features** — none (heartbeat/abort are robustness, not user features).
6. **Tests to add/update**
   - `agent/tools/web-search.test.ts`, `scholar.test.ts` — carried/split from old tools.test.ts, all previously-passing assertions preserved.
   - `agent/llm.test.ts` — for each provider branch: stub upstream via Bun.serve, assert request shape (auth header, model field) and extracted text; upstream 500 → AppError UPSTREAM.
   - `routes/agent.test.ts` (extend) — heartbeat: fake a slow handlePrompt (50ms), read stream with 30s intervals mocked? Simpler deterministic assertion: temporarily inject heartbeat interval via optional export `HEARTBEAT_MS` from config.ts default 25_000; test sets tiny value by importing route with config override is not feasible — instead add `HEARTBEAT_MS` to config.ts and have test monkey-patch not possible in Bun cleanly → DECISION: put `HEARTBEAT_MS = 25_000` in config.ts; test asserts only that stream still terminates cleanly with heartbeat wired (no `: ping` assertion required). Edge case covered by code review, not flaky timing test.
   - `routes/ollama.test.ts` CREATE — list route: with PATH stubbed to a fake `ollama` shell script echoing a fixture, returns parsed models; pull abort: issue request with AbortController, abort after first chunk, assert fake long-running script's PID is dead within 1s (script writes PID to tmp file).
   - `routes/cleanup.test.ts` (update) — route still returns layout via arrangeCanvas; embed failure → `{layout:null}`.
7. **Docs/README deltas** — CLAUDE.md: update "Adding an agent tool" section to point at `agent/tools/<domain>.ts` + `tools/index.ts` wiring.
8. **Definition of Done**
   - [ ] all listed files changed; all manifest greps clean
   - [ ] tests added and passing; zero lost assertions from old tools.test.ts
   - [ ] lint/typecheck clean
   - [ ] no TODOs left unresolved without a linked follow-up phase
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 4.**
