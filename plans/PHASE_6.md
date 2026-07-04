# Phase 6 — New features (research-sourced)

1. **Goal** — Ship: canvas export (Markdown + Obsidian Canvas JSON), Synthesize-selection, template canvases.
2. **Why (each cites §3B research)** — Export: interop/shareability is the #1 virality lever in this niche (Obsidian Canvas ecosystem; open-canvas positions on interop). Synthesize: "synthesis across threads is difficult" is the top reported pain (Canvas Chat, ericmjl 2025). Templates: blank-canvas onboarding friction; category tools ship starter templates. NOT building: conversation branching + command palette — already exist in Arbor (findings), README will surface them instead.
3. **Preconditions** — Phase 5 done (features land on the efficient baseline).
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `backend/src/canvases/export.ts` | CREATE | ```ts
export function toMarkdown(canvas: CanvasDoc): string;
export function toObsidianCanvas(canvas: CanvasDoc): string; // JSON string
``` `CanvasDoc` = the stored canvas shape from store/db (reuse existing type; do not invent a new one). toMarkdown: `# <canvas title>`, then one `## <card title or first 60 chars>` section per node in reading order (sort by y then x), body = card text / chat transcript (`**You:** … / **AI:** …` per turn) / file cards → `![[<filename>]]` line + note of blob id / web cards → `[<title>](<url>)`; end with `## Connections` listing `- <src title> → <dst title>` per edge. toObsidianCanvas: JSON Canvas 1.0 spec (github.com/obsidianmd/jsoncanvas): `{ nodes: [{ id, type: "text"|"file"|"link", x, y, width, height, text?|url? }], edges: [{ id, fromNode, toNode, fromSide: "bottom", toSide: "top" }] }` — map chat/text cards → type "text" (text = same rendering as markdown section body), web → "link", file → "text" with `![[name]]` placeholder; use each node's stored position/size, defaults 320×200 when absent. | None. |
| `backend/src/routes/canvases.ts` | MODIFY | Add `GET /:id/export?format=md|canvas`. Load canvas (existing store fn); `format=md` → `toMarkdown`, `Content-Type: text/markdown`, `Content-Disposition: attachment; filename="<slug>.md"`; `format=canvas` → `toObsidianCanvas`, `application/json`, `<slug>.canvas`. Unknown format → `badRequest("format must be md or canvas")`. Slug = title lowercased, non-alnum → `-`. | None. |
| `frontend/src/lib/canvas/Canvas.svelte` (or toolbar component) | MODIFY | Add "Export" menu (toolbar button, two items: "Markdown (.md)", "Obsidian Canvas (.canvas)") → `apiFetch` the export route → save via existing files API (`POST /api/files/write` after an OS save-dialog path? — Tauri thin-shell rule: no new Rust commands. DECISION: fetch export → trigger browser download via `Blob` + `URL.createObjectURL` + anchor click; WKWebView in Tauri handles the download to ~/Downloads. If download silently no-ops in the Tauri webview during verification, fallback (decision rule): write to `~/Downloads/<slug>.<ext>` via existing `POST /api/files/write` and show a toast with the path). | None. |
| `frontend/src/lib/ai/workflows.ts` | MODIFY | Add `synthesize` workflow: system prompt template (exact text): "You are a research synthesist. You will receive the contents of several cards from the user's canvas. Produce a single coherent synthesis: identify agreements, contradictions, and gaps, and end with a 3-bullet 'So what'. Be concise; cite cards by their titles in [brackets]." | None. |
| `frontend/src/lib/canvas/store.svelte.ts` + `Canvas.svelte` | MODIFY | "Synthesize N cards" action: enabled when selection ≥ 2 cards; gathers selected cards' text (same extraction as export markdown body, reuse a small shared helper `cardPlainText(node)` placed in `cards.ts`), creates a new chat card (via existing addCard) positioned at the selection's bounding-box center-bottom + 80px, then runs the agent on it with workflow=synthesize and the concatenated card contents (prefixed `[Card: <title>]\n`) as the prompt. Surface: context-menu/toolbar button "Synthesize" + CommandPalette entry (palette exists — add command). | None. |
| `frontend/src/lib/canvas/templates.ts` | CREATE | `export const CANVAS_TEMPLATES: { id: string; name: string; description: string; seed: CanvasSeed }[]` with exactly 3 templates, each seed = nodes+edges JSON: **lit-review** (cards: "Research question" text card; "Papers" group of 3 empty file-drop placeholders text cards; "Synthesis" chat card; edges question→papers→synthesis), **paper-draft** (text cards: Outline, Introduction, Methods, Results, Discussion, chained edges), **compare-sources** (two "Source A/B" text cards → "Comparison" chat card). Positions: hand-laid grid, x/y multiples of 360/240, no overlaps. | None. |
| `frontend/src/lib/Library.svelte` | MODIFY | "New canvas" flow gains "Start from template" row listing CANVAS_TEMPLATES (name + description); selecting one calls existing create-canvas then bulk-adds seed nodes/edges via existing store actions and saves. | None. |

5. **New features (acceptance criteria)**
   - **Export:** GET export of a canvas with ≥1 of each card type returns valid Markdown containing every card's content, and `.canvas` output parses as JSON matching JSON-Canvas node/edge required fields; UI button downloads both formats; exported .canvas opens in Obsidian without errors (manual check noted in Handoff).
   - **Synthesize:** selecting 3 text cards → Synthesize creates one new chat card whose agent run receives all 3 cards' text; result streams into the card; works with zero API keys → existing graceful no-key error path shows in card.
   - **Templates:** creating from each of the 3 templates yields a canvas with the seeded nodes/edges, saved and reload-stable.
6. **Tests to add/update**
   - `backend/src/canvases/export.test.ts` — fixture canvas (text+chat+web+file cards, 2 edges): toMarkdown snapshot-style asserts (contains each section header, connections lines); toObsidianCanvas: JSON.parse succeeds, every node has id/type/x/y/width/height, edges reference existing node ids; empty canvas → still-valid outputs.
   - `backend/src/routes/canvases.test.ts` — CREATE (route previously untested): CRUD happy path + export endpoint content-type/disposition + bad format → 400 code BAD_REQUEST.
   - `frontend/src/lib/canvas/templates.test.ts` — each template: node ids unique, all edge endpoints exist, no two nodes overlap (AABB check with stored width/height defaults).
   - `frontend` cards.test.ts (extend) — `cardPlainText` per card kind.
7. **Docs/README deltas** — none here (Phase 7 rewrites README including these features).
8. **Definition of Done**
   - [ ] all listed files changed; acceptance criteria demonstrated (test output + manual notes in Handoff)
   - [ ] tests added and passing; lint/typecheck clean
   - [ ] no TODOs left unresolved without a linked follow-up phase
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 7.**
