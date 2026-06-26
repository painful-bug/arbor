# Spatial Canvas AI Chat — Market Research & Product Strategy

> Standalone copy of the research deliverable. Full build plan lives in
> `~/.claude/plans/normally-interfaces-like-cloud-jiggly-reddy.md`.

## Bottom line up front
Demand for non-linear / spatial AI chat is **real and validated at scale**, but the concept
is **already crowded** — including products that ship the *exact* highlight-to-branch
interaction. The opportunity is **not** "invent spatial AI chat." It is **win on execution,
aesthetic delight, and a sharp niche** (researchers) the incumbents serve poorly.

## 1. Demand exists (validated top to bottom)
- **OpenAI shipped ChatGPT conversation branching (Sept 2025)** after repeated community
  requests — biggest signal that "linear chat is a trap" is mainstream pain.
- Recurring complaint: linear chats become traps; exploring a new direction means
  overwriting context or starting a new chat → duplication, lost history, messy sidebar.
- 2024 Tsinghua / BIT paper formalized linear-LLM inefficiency for planning & learning.
- Indie devs build non-linear ChatGPT UIs "out of frustration" (Show HN).
- Adjacent market scale: AI productivity tools ~$8.8B (2024) → ~$36B (2033); knowledge-mgmt
  software ~$13.4B (2025) → ~$62B (2034).

## 2. Competitive landscape (crowded)
**Direct (canvas + branching):** Flowith (**1M+ users**, PH #1 June 2025, NVIDIA/Google/MS/AWS
backed), Canvas Chat (**has exact highlight-and-branch + merge + web search**), ContextTree
(per-node model/prompt), Chatvas (desktop, animated edges), LLM Canvas, tldraw branching-chat
starter kit (**clones the MVP in a weekend**), Cognograph.
**Adjacent:** Storyflow, Heptabase, Obsidian Canvas + plugins, Apple Freeform, tldraw Make
Real / tldraw.computer ($10M Series A), ChatGPT branching + Claude Artifacts/Canvas.

**Three under-served gaps:** (1) aesthetic & interaction *delight* (all competitors look
utilitarian), (2) tablet/gesture-first (everyone is mouse-first desktop-web), (3) a sharp
single-persona workflow vs. generic "thinking tool."

## 3. Chosen wedge
Be the **unreasonably delightful, local-first spatial AI canvas for researchers**, on
macOS. Win on *feel* (Apple-grade motion) + a *deep researcher job* (drop your sources,
per-canvas RAG, branch through them, export). Incumbents structurally ignore both.

## 4. Differentiating features (beyond commodity core)
1. **Physical/joyful interaction** — spring card spawn, haptics, elastic edges (the bet).
2. **Visible branch-context control** — see/toggle which ancestor cards + sources feed each card.
3. **Merge/synthesize nodes** with parent citations + disagreement diffs.
4. **Per-canvas RAG** over dropped files + conversations (the researcher moat).
5. **Export tree → doc/outline** — "I thought spatially, now ship it."
6. **Source/citation cards** with provenance (→ future Zotero integration).
7. **Per-branch model choice** (cheap to explore, frontier to commit).

## 5. Risks
Low technical moat (tldraw kit + API = weekend clone) → moat must be taste/brand/niche;
incumbent encroachment (ChatGPT/Claude absorbing the middle); novelty-not-retention; branching
multiplies API cost (mitigated by on-device Apple Intelligence default).

## 6. Decisions locked
macOS desktop (Tauri + SvelteKit/Svelte 5 + Svelte Flow), researcher persona, real shippable
startup, **aesthetic-delight** bet. On-device Apple Intelligence default + BYO NVIDIA NIM /
OpenRouter / Groq. Per-canvas local RAG (`sqlite-vec` + `fastembed-rs`). Design from
`DESIGN.md` (pastel sticky cards) + Apple Liquid Glass motion. Zotero = future scope.
