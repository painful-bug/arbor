# Phase 8 — Final hardening

1. **Goal** — Critical untested modules covered; CI runs full gate incl. svelte-check; edge cases closed; zero stray TODOs.
2. **Why** — Findings: zero tests for agent/run.ts, kb/store.ts, kb/index.ts, routes/{settings,keys,files}; frontend store had none before Phase 4 (partially closed); CI lacks svelte-check (deferred from Phase 1).
3. **Preconditions** — Phase 7 done.
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `backend/src/kb/store.test.ts` | CREATE | Point LanceDB at a temp dir (set the paths module's dir via env/injection the same way existing kb.test.ts does — reuse `routes/test-setup.ts` harness). Tests: upsert 3 chunks + hybrid search returns the semantically-nearest first (use trivial distinct texts, e.g. "quantum physics" vs "chocolate cake", query "particles"); chat rows excluded by NOT_CHAT filter; clear removes table. Guard: skip suite with `test.skipIf` when model download unavailable offline — embeddings need BGE; if existing tests already stub embed(), reuse that stub instead (preferred; check kb.test.ts pattern first and mirror it). | None. |
| `backend/src/kb/index.test.ts` | CREATE | addFile happy path with a small in-repo markdown fixture (create `backend/src/kb/fixtures/sample.md`, ~20 lines): returns chunk count > 0, search finds it; edge: unsupported MIME → typed AppError, not crash. Stub contextualize (no key) path: addFile still succeeds without LLM keys. | None. |
| `backend/src/agent/run.test.ts` | CREATE | Extend beyond existing SSE plumbing tests (routes/agent.test.ts): handlePrompt with no keys emits graceful error event (assert event shape); cancel path: start run, call cancel, run's emit stream ends with cancelled/aborted event; rate-limit regex (RATE_LIMIT_RE) matches representative provider messages ("429", "rate limit exceeded") and not normal errors. | None. |
| `backend/src/routes/settings.test.ts`, `keys.test.ts`, `files.test.ts` | CREATE ×3 | Per route: happy path GET/PUT round-trip; one edge each — settings: PUT invalid JSON → 400; keys: GET returns presence boolean only, never key material (assert response body lacks the stored value — directive 7 regression test); files: read of nonexistent path → 404 code NOT_FOUND, write outside allowed scope if such a guard exists (mirror current behavior; if no guard exists, test documents current behavior with a comment, no new guard invented). | None. |
| `frontend/src/lib/canvas/store.test.ts` | CREATE | Store integration (happy + edge): addCard/addTextCard produce nodes via buildCardNode + parent edge when parentId given; deleting a card removes its edges; undo restores deleted card. Use Vitest + the store's real module (runes work under vitest with svelte plugin — mirror however Phase 4 module tests import state; if store.svelte.ts state can't run headless, test via the extracted pure modules only and note it). | None. |
| CI workflow (from Phase 1) | MODIFY | Add to `quality` job: `cd frontend && npm run check` (svelte-check). Confirm job runs Biome + backend tsc + backend tests + frontend tests + svelte-check. | None. |
| repo-wide | MODIFY | `rg -n "TODO|FIXME|XXX" backend/src frontend/src` — every hit either resolved or is the single permitted Phase-7 demo-GIF TODO. Fix stragglers or delete stale ones. | None. |

5. **New features** — none.
6. **Tests to add/update** — the manifest is the test list (≥1 happy + ≥1 edge per module, as specified per row).
7. **Docs/README deltas** — none.
8. **Definition of Done**
   - [ ] all listed test files exist and pass locally: `cd backend && bun test` and `cd frontend && npm test -- --run`
   - [ ] CI quality job includes svelte-check and passes on push
   - [ ] TODO sweep clean (one permitted GIF TODO)
   - [ ] lint/typecheck clean
   - [ ] Handoff Summary printed per protocol — final; revamp complete
9. **STOP HERE. Revamp complete — await user.**
