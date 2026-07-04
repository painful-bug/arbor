# Arbor Revamp — Plan Index

**Goal:** Revamp Arbor into a viral-ready, Google-TS-style, DRY, layered codebase with measured macOS battery efficiency and three research-sourced features. Success = every phase merged with green build/tests, before/after power numbers recorded in PHASE_5, README rewritten per PHASE_7, no regressions (CLAUDE.md directive 1).

| Phase | Title | Goal | Depends on | Size |
|---|---|---|---|---|
| 1 | Tooling baseline | Biome + typecheck + CI quality gate | — | S |
| 2 | Shared utilities & dedup | config.ts, errors.ts, log.ts, http.ts, debounce.ts; kill dead code | 1 | M |
| 3 | Backend restructure | split tools.ts, unify LLM calls, thin routes, SSE heartbeat, ollama abort | 2 | L |
| 4 | Frontend restructure | split store.svelte.ts / Canvas.svelte / settings page; card factory | 2 | L |
| 5 | Battery & power efficiency | measured before/after; visibility-driven timers/animations | 3, 4 | M |
| 6 | New features | canvas export, synthesize-selection, template canvases | 5 | L |
| 7 | README & positioning | viral-ready README | 6 | S |
| 8 | Hardening | test-gap fill, CI completeness, edge cases | 7 | M |

## Stop-and-wait protocol (verbatim, applies to every phase)

"After completing all tasks and acceptance criteria in a phase file:
 1. Run the phase's test/build/lint commands and paste only the pass/fail
    summary (not full logs).
 2. Print a short 'Handoff Summary' block: what changed, files touched,
    any deviations from plan and why, exact next command to run.
 3. STOP. Do not begin the next phase's tasks. Wait for the user to run
    /compact and reply with an explicit go-ahead (e.g. 'continue Phase 3')
    before opening the next phase file."

## Global conventions (decided once — phase files reference, never repeat)

- **Naming:** UpperCamelCase types/classes/Svelte components; lowerCamelCase functions/vars; CONSTANT_CASE for exported module-level constants; file names kebab-case for .ts, UpperCamelCase for .svelte. No underscore prefixes.
- **Docstrings:** JSDoc `/** */` on every exported symbol: one-line contract + `@param`/`@returns`/`@throws` where non-obvious. No JSDoc on non-exported helpers unless tricky.
- **Errors:** backend throws `AppError` (see PHASE_2) or built-in `Error` subclasses only; HTTP boundary converts via central `app.onError` to `{ error: string, code: string }` + status. No silent `.catch(() => {})` without a `// justified:` comment. Frontend: fetch failures surface to UI state, never swallowed.
- **Logging:** backend uses `log.info|warn|error(scope, msg, data?)` from `backend/src/log.ts` (PHASE_2); no bare console.* in backend src after Phase 3. Frontend may console.error in dev paths only.
- **Layering:** routes (HTTP parse/respond) → domain modules (agent/, kb/, cleanup/) → infra (store/, paths, config). Routes never touch LanceDB/SQLite directly. No layer reaches two levels down.
- **Formatting/lint:** Biome, config at repo root `biome.json` (tabs, double quotes, line width 100 — matches existing style). Typecheck: `tsc --noEmit` (backend), `svelte-check` (frontend).
- **Tests:** Bun test (backend) / Vitest (frontend) mirror source paths (`foo.ts` → `foo.test.ts` beside it). Every module created/split in a phase ships tests in that phase.
- **Commands:** backend: `cd backend && bun test && bun x tsc --noEmit`; frontend: `cd frontend && npm test && npm run check`; lint: `npx biome check .` at root.

## Rollback policy

Each phase = exactly one commit on branch `rework`, message `revamp(phase-N): <title>`. Revert a phase with `git revert <sha>`. Phases 3 and 4 are independent (both depend only on 2) and revertible independently. Never rebase published history.
