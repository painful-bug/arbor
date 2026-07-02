# Phase 7 — README & positioning

1. **Goal** — README converts a cold GitHub visitor in <60s: what/why/demo/quickstart/comparison, 500–1,500 words.
2. **Why** — §3B: viral repos share hero GIF, ≤3-step quickstart, comparison table, feature table over paragraphs (awesome-readme; dev.to star-guides). Current README is good but pre-dates new features and lacks a comparison vs live alternatives.
3. **Preconditions** — Phase 6 done (features exist to be advertised).
4. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `README.md` | MODIFY | Keep current structure/tone (it already follows best practice) and apply exactly: (a) badges row: add CI status badge (`![CI](https://github.com/painful-bug/arbor/actions/workflows/<ci-file>.yml/badge.svg)` using the workflow filename from Phase 1) and `platform-macOS` static badge; (b) features: add three rows/sections for Export (Markdown + Obsidian Canvas), Synthesize selection, Templates — one sentence + one sub-line each, matching existing feature-section style; also surface existing-but-unadvertised branching + command palette; (c) NEW section "## Arbor vs alternatives" after "Why Arbor?": table columns `| | Arbor | Open Canvas | NotebookLM | Obsidian + Canvas |`, rows: Local-first (✅/☁️ hosted-first/☁️/✅), Spatial canvas (✅/partial/❌/✅), Built-in RAG over your files (✅ zero-config/❌/✅ cloud/plugin-dependent), Multi-provider incl. Ollama (✅/partial/❌/n-a), AI writes onto canvas (✅/❌/❌/❌), Obsidian-interop export (✅/❌/❌/native). Keep claims defensible — footnote "as of mid-2026". (d) Quickstart: verify still 2 commands; add third line "open the app, drop a PDF, ask a question"; (e) word count 500–1,500 (`wc -w` check); (f) demo GIF: KEEP existing `.github/demo.gif` reference; add HTML comment `<!-- TODO(user): re-record demo.gif showing export + synthesize (cannot be automated) -->` — this is the single permitted TODO, linked here. | None. |
| `CLAUDE.md` | MODIFY | Sync: features list mention of export/synthesize/templates modules (one line each in the relevant tree sections), confirm kb/ + tools/ layouts reflect Phases 2–4 edits already made there. | None. |

5. **New features** — none.
6. **Tests to add/update** — none (docs phase). Validation: `wc -w README.md` in range; all relative links resolve (`rg -o "\]\(([^)h][^)]*)\)" README.md` targets exist); badge URL uses real workflow filename.
7. **Docs/README deltas** — is the phase.
8. **Definition of Done**
   - [ ] README updated exactly as specified; word count verified
   - [ ] link/badge validation performed
   - [ ] lint (markdown untouched by Biome — fine), repo tests still green
   - [ ] Handoff Summary printed per protocol
9. **STOP HERE. Do not begin Phase 8.**
