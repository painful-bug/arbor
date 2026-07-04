# Phase 4 — Frontend restructure

1. **Goal** — store.svelte.ts ≤ 700 lines with satellite modules; Canvas.svelte ≤ 900 lines; settings page decomposed; single card-creation path.
2. **Why** — 1,471/1,359/969-line god-files; 4 copy-paste card factories; search/shortcut/overlay logic tangled into Canvas.svelte.
3. **Preconditions** — Phase 2 done. (Independent of Phase 3.)
4. **File-wise change manifest**

Rule for every extraction below: **public API frozen** — every symbol currently exported from `store.svelte.ts` remains importable from `store.svelte.ts` (re-export moved pieces); zero call-site changes outside `src/lib/canvas/`. Verify after: `cd frontend && npm run check` + full grep `rg "from .*canvas/store" frontend/src` unchanged list compiles.

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `frontend/src/lib/canvas/cards.ts` | CREATE | Card factory consolidation. `export function buildCardNode(opts: { kind: "chat" | "web" | "file" | "text"; pos: {x:number;y:number}; data: Record<string, unknown>; id: string }): FlowNode` — pure function producing the node object (the shared shape currently duplicated in addCard :449 / addWebCard :520 / addFileCard :558 / addTextCard :611: id, type, position, block-cycle/palette assignment, data spread). Kind-specific data defaults live in a `const DEFAULTS: Record<kind, …>` map in this file. The four `add*Card` store actions stay in store.svelte.ts (they mutate state + create parent edge + persist) but each becomes ≤ 10 lines: `const node = buildCardNode(...); flow.nodes.push(node); if (parentId) addEdge(parentId, node.id); persist();`. Exact FlowNode type = whatever the four functions construct today; factor it, don't change it. | None. |
| `frontend/src/lib/canvas/persistence.ts` | CREATE | Move save/load plumbing: the 400ms debounced canvas save (store.svelte.ts:164, using Phase-2 `debounce`), settings persist (:1022), library fire-and-forget save (:94). Shape: `export function createPersistence(deps: { getSnapshot(): CanvasSnapshot; apiPut: typeof apiPut })` returning `{ scheduleSave, saveNow, loadCanvas(id) }` — dependency-injected, no direct store import (avoids cycles). store.svelte.ts instantiates it once. Fire-and-forget saves now `.catch(e => console.error("[persist]", e))` — findings flagged swallowed errors. | None. |
| `frontend/src/lib/canvas/history.ts` | CREATE | Move undo/redo stack + the 500ms history-lock timeouts (store.svelte.ts:289,301). Export `createHistory<T>(limit: number)` → `{ push(snapshot: T), undo(): T | null, redo(): T | null, locked: () => boolean }`. Keep current limit value (read it from existing code when moving; it is a moved constant, not a new decision). | None. |
| `frontend/src/lib/canvas/kb-sync.ts` | CREATE | Move `indexTextCard` + the 2s debounced text-index trigger (store.svelte.ts:621-642) and any KB add/remove calls the store makes. Export `createKbSync(deps: { ragAdd: typeof ragAdd })` → `{ onTextChanged(cardId, text), removeCard(cardId) }`. | None. |
| `frontend/src/lib/canvas/store.svelte.ts` | MODIFY | Becomes: runes state + mutations + thin actions delegating to the four modules above; re-exports moved public symbols. Target ≤ 700 lines. No behavior change: every existing export name, signature, and observable behavior preserved. | None. |
| `frontend/src/lib/canvas/CanvasSearch.svelte` | CREATE (from split) | Extract from Canvas.svelte: search bar UI, KB-search debounce trigger (:708), results modal + sources list (:922-936). Props: `{ open: boolean, onNavigate(nodeId: string): void }`; internally uses existing globalSearch store. Canvas.svelte renders `<CanvasSearch bind:open={searchOpen} onNavigate={focusNode} />`. | None. |
| `frontend/src/lib/canvas/shortcuts.ts` | CREATE (from split) | Extract Canvas.svelte's window `keydown` handler body into `export function handleCanvasShortcut(e: KeyboardEvent, actions: CanvasShortcutActions): boolean` (returns true if handled) with `interface CanvasShortcutActions { … }` — one callback per action the current handler performs (enumerate them while moving: e.g. openSearch, deleteSelection, undo, redo, zoomToFit, openPalette…). Canvas.svelte keeps a 3-line listener delegating to it. Pure function → unit-testable. | None. |
| `frontend/src/lib/canvas/Canvas.svelte` | MODIFY | After the two extractions + Phase-2 debounce/Controls cleanups: target ≤ 900 lines. Auto-cleanup interval (:602) and save debounce (:618) stay here (Phase 5 rewires the interval). | None. |
| `frontend/src/routes/settings/ProviderCard.svelte` | CREATE (from split) | Extract per-provider block from settings/+page.svelte: key input, save, test button, status line. Props: `{ provider: ProviderInfo }`; emits nothing — calls existing api helpers directly (same code, relocated). | None. |
| `frontend/src/routes/settings/OllamaPanel.svelte` | CREATE (from split) | Extract Ollama section (model list, pull progress SSE, status timeouts :187). | None. |
| `frontend/src/routes/settings/+page.svelte` | MODIFY | Composes ProviderCard list + OllamaPanel + remaining general settings. Target ≤ 450 lines. | None. |
| `frontend/src/lib/canvas/kinds.ts` | CREATE | Type guards consolidating repeated literal checks (FilePanel.svelte:55-184, AgentTimeline.svelte:52-74, Canvas.svelte:125, store.svelte.ts:129): `export const isPdfFile = (f: {kind?: string}) => f.kind === "pdf";` plus one guard per literal currently compared ≥ 2 places (enumerate while editing: file kinds, timeline event types, node types). Redirect those call sites. | None. |

5. **New features** — none.
6. **Tests to add/update** (Vitest)
   - `cards.test.ts` — buildCardNode: each kind produces correct type/data defaults; position passed through; unique ids respected.
   - `history.test.ts` — push/undo/redo round-trip; limit eviction; redo cleared on new push.
   - `persistence.test.ts` (fake timers) — scheduleSave coalesces to one apiPut; saveNow flushes; failed save logs, doesn't throw.
   - `shortcuts.test.ts` — table-driven: each mapped key combo calls exactly its action and returns true; unmapped returns false.
   - `kinds.test.ts` — one assertion per guard.
7. **Docs/README deltas** — CLAUDE.md frontend tree: add cards/persistence/history/kb-sync/shortcuts/kinds lines.
8. **Definition of Done**
   - [ ] all listed files changed; store public API frozen (svelte-check + grep verification passes)
   - [ ] line-count targets met (`wc -l` on the three god-files) — if a target missed by >10%, report why in Handoff, do not force artificial splits
   - [ ] tests added and passing; lint/typecheck clean
   - [ ] no TODOs left unresolved without a linked follow-up phase
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 5.**
