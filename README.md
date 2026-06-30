<div align="center">

# Arbor

### A spatial research canvas that thinks with you — drop files, ask questions, and branch ideas on an infinite surface.

<br/>

[![License](https://img.shields.io/badge/License-Private-gray?style=flat-square)](LICENSE)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?style=flat-square&logo=bun)](https://bun.sh)
[![SvelteKit](https://img.shields.io/badge/Frontend-SvelteKit%202-ff3e00?style=flat-square&logo=svelte&logoColor=white)](https://svelte.dev)
[![Tauri](https://img.shields.io/badge/Shell-Tauri-ffc131?style=flat-square&logo=tauri&logoColor=white)](https://tauri.app)

<br/>

<img src=".github/demo.gif" alt="Arbor demo" width="100%" style="border-radius: 12px;" />

</div>

---

## What is Arbor?

Most AI tools are linear — you type, it responds, you scroll. Arbor is different. It gives you an **infinite 2D canvas** where your documents, AI conversations, and notes become spatial objects you can rearrange, connect, and explore freely.

Drop a PDF onto the canvas. Ask a question. Branch the conversation in a new direction. Connect two ideas with an edge. Zoom out to see the whole picture. This is research the way your mind actually works.

**Everything runs locally.** Your data never leaves your machine.

---

## Why Arbor?

| Pain | Arbor's answer |
|------|----------------|
| Chat UIs bury context in a scroll | Spatial cards — nothing gets lost |
| RAG tools require cloud setup | Embedded LanceDB + BGE embeddings, zero config |
| Scanned PDFs break most RAG pipelines | Multi-tier OCR: Apple Vision → Tesseract → vision LLM fallback |
| Vendor lock-in | 7 providers including local Ollama |
| Your research data in someone else's cloud | 100% local-first, `~/.arbor`, no telemetry |

---

## Features

### Spatial Canvas
Infinite 2D workspace with drag-and-drop cards, directional edges, grouping, and zoom-to-fit. Arrange your research the way your brain works — not in a linear thread.

### Knowledge Base (RAG)
Drop PDFs, DOCX, Markdown, or images directly onto a canvas. They're chunked, embedded locally with `BGE-small-en-v1.5`, and instantly searchable via hybrid vector + keyword search (LanceDB). No cloud, no API calls for embeddings.

### Deep Research Mode
Plan-then-search workflow using **OpenAlex** and **arXiv** for real academic papers. Returns citation counts, author lists, and clickable DOI links — not hallucinated references.

### Multi-Provider AI
Works with your existing API keys:

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4, Claude Haiku 4 |
| OpenAI | GPT-4o, GPT-4.1, o3-mini |
| Google | Gemini 2.5 Pro / Flash |
| Mistral | Mistral Large, Codestral |
| Groq | Llama 3.3, Mixtral |
| DeepSeek | DeepSeek Chat / Reasoner |
| Ollama | Any locally running model |

### OCR Pipeline
Three-tier fallback for scanned documents: **Apple Vision** (macOS, highest quality) → **Tesseract** → cloud vision LLM. Handles handwritten notes, low-res scans, and complex layouts that break standard PDF parsers.

### Canvas-Aware AI Tools
The AI can create new cards, write notes, and update existing content **directly on your canvas** — not just in a chat window. Your canvas is the output.

### Research Workflows
Tuned system prompts for: literature review, paper drafting, methodology critique, evidence synthesis, and comparative analysis.

### Local-First, Always
All data in `~/.arbor`. OS keychain for API keys (`Bun.secrets`). No cloud sync. No telemetry. No subscriptions.

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) (latest)
- [Node.js](https://nodejs.org) 22+
- [Rust + Cargo](https://rustup.rs) (for Tauri builds)

### Development

```bash
# Terminal 1 — backend (Bun + Hono, port 8765+)
cd backend && bun run dev

# Terminal 2 — frontend (Tauri + SvelteKit)
npm run dev
```

Or with just the web frontend (no Tauri):

```bash
npm run dev:web      # http://localhost:5173
npm run dev:backend  # http://localhost:8765
```

### Build (macOS)

```bash
bash scripts/build-macos.sh
```

Output: `frontend/src-tauri/target/release/bundle/`

### Tests

```bash
cd backend && bun test
# 24 tests across 6 files
```

---

## Architecture

```
arbor/
├── frontend/          SvelteKit 2 + Svelte 5 runes + thin Tauri shell (Rust)
└── backend/           TypeScript/Bun, Hono HTTP server — all data + AI processing
```

**Frontend = UI only.** All data, AI calls, file processing, and secrets live in the backend. The frontend talks to it over `127.0.0.1` using HTTP + SSE with a random bearer token. Nothing sensitive ever reaches the webview.

### Data Directory

```
~/.arbor/
  arbor.db        SQLite — canvases, settings, blob metadata (Drizzle ORM)
  lancedb/        vector store — one table per canvas
  blobs/          raw file bytes
  models/         transformers.js model cache (BGE-small-en-v1.5)
```

---

## Configuration

Add API keys in **Settings → Providers**. Keys are stored in the OS keychain via `Bun.secrets` (service: `app.arbor.canvas`). The app never sends keys anywhere except directly to the configured provider.

---

## License

Private — not yet licensed for distribution.
