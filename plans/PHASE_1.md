# Phase 1 — Tooling baseline

1. **Goal** — Repo has one lint/format tool (Biome), typecheck commands, and a CI quality job; entire tree passes all three.
2. **Why** — No lint/format config exists today; style drift is why god-files grew unchecked (findings: errors ad-hoc, constants scattered). Gates must exist before restructuring so later phases prove cleanliness mechanically.
3. **Preconditions** — none (first phase). Working tree clean on `rework`.
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `biome.json` (repo root) | CREATE | `{ "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json", "formatter": { "enabled": true, "indentStyle": "tab", "lineWidth": 100 }, "javascript": { "formatter": { "quoteStyle": "double" } }, "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "off" } } }, "files": { "ignore": ["**/node_modules", "**/build", "**/dist", "**/.svelte-kit", "**/src-tauri/target", "**/graphify-out", "**/*.svelte"] } }`. `.svelte` excluded because Biome's Svelte support is partial — svelte-check covers those. If schema URL version mismatches installed Biome major, use the URL `npx biome init` generates. | None. |
| `package.json` (root) | MODIFY | Add devDependency `"@biomejs/biome": "^2"` (install with `npm i -D @biomejs/biome` at root). Add scripts: `"lint": "biome check ."`, `"lint:fix": "biome check --write ."`, `"typecheck": "cd backend && bun x tsc --noEmit && cd ../frontend && npm run check"`. | None. |
| `backend/tsconfig.json` | MODIFY (CREATE if absent) | Ensure `"noEmit": true`-compatible strict config exists: `compilerOptions` must include `"strict": true, "module": "esnext", "moduleResolution": "bundler", "target": "esnext", "types": ["bun-types"], "noEmit": true`. If file exists, add only missing keys; do not remove existing ones. | None. |
| `backend/package.json` | MODIFY | Add script `"typecheck": "tsc --noEmit"` and devDependency `"typescript": "^5"` if not present (`cd backend && bun add -d typescript`). | None. |
| whole tree | MODIFY (mechanical) | Run `npx biome check --write .` once. Only formatting/auto-fixable changes; zero manual logic edits. If Biome flags non-auto-fixable errors, fix only: unused imports/vars (delete), `==`→`===` where operands are same-type. Leave anything else and add it to Handoff Summary as Phase-2/3 input. | None. |
| CI workflow | MODIFY or CREATE | Decision rule: if `.github/workflows/` contains any workflow with a build job, add a new independent job `quality` to that file; else CREATE `.github/workflows/ci.yml` with `on: [push, pull_request]`. Job `quality` (runs-on: macos-latest): checkout → setup Bun (oven-sh/setup-bun@v2) → setup Node 22 → `npm ci` at root and in `frontend` → `cd backend && bun install` → `npx biome check .` → `cd backend && bun x tsc --noEmit && bun test` → `cd frontend && npm test -- --run`. Do NOT add `npm run check` (svelte-check) to CI yet — added in Phase 8 after frontend restructure stabilizes types. | None. |

5. **New features** — none.
6. **Tests to add/update** — none new; existing `cd backend && bun test` and `cd frontend && npm test -- --run` must stay green after the mechanical format pass.
7. **Docs/README deltas** — none (Phase 7 owns README).
8. **Definition of Done**
   - [ ] all listed files changed as specified
   - [ ] `npx biome check .` exits 0
   - [ ] `cd backend && bun x tsc --noEmit` exits 0 (if pre-existing type errors block this, fix only annotation-level errors; report count in Handoff)
   - [ ] backend + frontend test suites pass
   - [ ] no TODOs left unresolved without a linked follow-up phase
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 2.**
