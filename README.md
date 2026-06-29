# Arbor

A spatial research canvas for exploring ideas, papers, and files. Drop documents, ask questions, branch conversations — everything lives on an infinite canvas you can rearrange, connect, and export.

## Features

- **Spatial canvas** — drag-and-drop cards, files, and notes on an infinite 2D surface with edges, grouping, and zoom-to-fit
- **Multi-provider AI** — works with OpenAI, Anthropic, Google, Mistral, Groq, DeepSeek, and local Ollama models
- **Knowledge base** — drop PDFs, DOCX, markdown, or images onto a canvas; they're chunked, embedded (BGE-small), and searchable via hybrid RAG (LanceDB)
- **Deep research** — plan-then-search workflow using OpenAlex + arXiv for real papers with citation counts and clickable links
- **Web search** — Tavily or DuckDuckGo integration for current information
- **Research workflows** — tuned system prompts for literature review, paper drafting, methodology critique, and synthesis
- **Canvas tools** — the AI can create cards, notes, and update existing content directly on the canvas
- **OCR pipeline** — Apple Vision → Tesseract → cloud vision LLM fallback chain for scanned documents
- **Local-first** — all data stored in `~/.arbor` (SQLite + LanceDB + file blobs). No cloud sync, no telemetry

## Architecture

```
frontend/   — SvelteKit 2 + Svelte 5 + thin Tauri shell (Rust)
backend/    — TypeScript/Bun, Hono HTTP server, all processing
```

The frontend is UI only. All data, AI, file processing, and secrets management lives in the backend, which runs on `127.0.0.1` and communicates via HTTP + SSE. A random bearer token secures the localhost boundary.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) (latest)
- [Node.js](https://nodejs.org) 22+
- [Rust](https://rustup.rs) (for Tauri builds)

### Development

```bash
# Terminal 1: backend
cd backend && bun run dev

# Terminal 2: frontend (Tauri dev)
npm run dev
```

Or run just the web frontend without Tauri:

```bash
npm run dev:web      # frontend on localhost:5173
npm run dev:backend  # backend on localhost:8765
```

### Build

```bash
# macOS DMG
bash scripts/build-macos.sh
```

The DMG and .app bundle are output to `frontend/src-tauri/target/release/bundle/`.

### Tests

```bash
cd backend && bun test
```

## Configuration

Add API keys in the app's Settings panel. Keys are stored in the OS keychain via `Bun.secrets` (service: `app.arbor.canvas`). The app never sends keys to any server other than the configured provider.

### Supported Providers

| Provider | Models |
|----------|--------|
| OpenAI | GPT-4o, GPT-4.1, o3-mini, etc. |
| Anthropic | Claude Sonnet, Claude Haiku |
| Google | Gemini 2.5 Pro/Flash |
| Mistral | Mistral Large, Codestral |
| Groq | Llama, Mixtral |
| DeepSeek | DeepSeek Chat/Reasoner |
| Ollama | Any locally running model |

## Data Directory

```
~/.arbor/
  arbor.db          — SQLite (canvases, settings, blob metadata)
  lancedb/          — vector store (one table per canvas)
  blobs/            — raw file bytes
  models/           — transformers.js model cache
```

Falls back to `~/.loom` if it exists (backward compat from pre-rebrand).

## License

Private — not yet licensed for distribution.
