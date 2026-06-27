#!/usr/bin/env bash
# =============================================================================
#  Graphiti — No-Docker Installer for Loom (macOS)
#
#  Installs everything Loom needs to run a per-canvas temporal knowledge graph:
#    • Python 3.12 (managed by uv) + uv
#    • getzep/graphiti MCP server      → ~/.graphiti  (uv env, providers extra)
#    • FalkorDBLite                    → embedded FalkorDB (Redis+module), no Docker
#    • Ollama embedding model          → nomic-embed-text (default local embedder)
#    • libomp                          → FalkorDB native runtime dep
#
#  This script is an INSTALLER ONLY. It does NOT start any server and writes
#  NO secrets to disk. Loom owns the runtime: it spawns the FalkorDB launcher
#  and the MCP server as child processes, injecting the API key from the macOS
#  keychain and generating config.yaml from the Loom settings page.
#
#  MCP endpoint (when Loom starts it): http://localhost:8000/mcp/
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[graphiti]${RESET}  $*"; }
success() { echo -e "${GREEN}[graphiti] ✔${RESET}  $*"; }
warn()    { echo -e "${YELLOW}[graphiti] ⚠${RESET}  $*"; }
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }
die()     { echo -e "${RED}[graphiti] ✖ ERROR:${RESET}  $*" >&2; emit_summary "error" "$*"; exit 1; }

# ── Config ───────────────────────────────────────────────────────────────────
GRAPHITI_DIR="${GRAPHITI_INSTALL_DIR:-$HOME/.graphiti}"
REPO_URL="https://github.com/getzep/graphiti.git"
GRAPHITI_REF="${GRAPHITI_REF:-main}"          # pin a tag/commit for reproducibility
PYTHON_VERSION="3.12"                          # falkordblite requires >=3.12
EMBED_MODEL="${LOOM_EMBED_MODEL:-nomic-embed-text}"
LLM_MODEL="${LOOM_GRAPH_LLM_MODEL:-llama3.2:3b}" # local graph-building LLM (capable, ~2GB)
SUMMARY_FILE="${GRAPHITI_SUMMARY_FILE:-}"
MCP_SERVER_DIR="${GRAPHITI_DIR}/mcp_server"
LAUNCHER_PATH="${GRAPHITI_DIR}/falkor_launcher.py"
LOOM_DATA_DIR="${LOOM_DIR:-$HOME/.loom}/graphiti"

[[ "$(uname)" == "Darwin" ]] || die "This installer targets macOS only."

emit_summary() {
  local status="$1" message="$2" json
  json=$(printf '{
  "graphiti_setup": {
    "status": "%s",
    "message": "%s",
    "install_dir": "%s",
    "mcp_server_dir": "%s",
    "launcher": "%s",
    "data_dir": "%s",
    "embed_model": "%s",
    "transport": "http",
    "database": "falkordb-lite"
  }
}' "$status" "$message" "$GRAPHITI_DIR" "$MCP_SERVER_DIR" "$LAUNCHER_PATH" "$LOOM_DATA_DIR" "$EMBED_MODEL")
  echo "$json"
  [[ -n "$SUMMARY_FILE" ]] && echo "$json" >"$SUMMARY_FILE"
}

add_to_path() { [[ ":$PATH:" != *":$1:"* ]] && export PATH="$1:$PATH" || true; }

section "Graphiti No-Docker Installer for Loom"
info "Install dir : ${GRAPHITI_DIR}"
info "Data dir    : ${LOOM_DATA_DIR}"
info "macOS       : $(sw_vers -productVersion)"

# =============================================================================
section "Step 1/6 — Homebrew + libomp"
# =============================================================================
if ! command -v brew &>/dev/null; then
  info "Installing Homebrew…"
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || die "Homebrew install failed."
  [[ -f /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
fi
add_to_path "$(brew --prefix)/bin"
# FalkorDB module needs the OpenMP runtime at load time.
brew list libomp &>/dev/null || { info "Installing libomp…"; brew install libomp || die "libomp install failed."; }
success "Homebrew + libomp ready."

# =============================================================================
section "Step 2/6 — uv (Python toolchain)"
# =============================================================================
if ! command -v uv &>/dev/null; then
  info "Installing uv…"
  curl -LsSf https://astral.sh/uv/install.sh | sh || die "uv install failed."
  add_to_path "$HOME/.local/bin"; add_to_path "$HOME/.cargo/bin"
  grep -q '\.local/bin' "$HOME/.zshrc" 2>/dev/null \
    || printf '\nexport PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"\n' >>"$HOME/.zshrc"
fi
command -v uv &>/dev/null || die "uv not found after install. Open a new terminal and re-run."
info "Ensuring Python ${PYTHON_VERSION} is available via uv…"
uv python install "${PYTHON_VERSION}" || die "uv python install failed."
success "uv $(uv --version | awk '{print $2}')"

# =============================================================================
section "Step 3/6 — git + Graphiti repository"
# =============================================================================
command -v git &>/dev/null || { brew install git || die "git install failed."; }
mkdir -p "$(dirname "$GRAPHITI_DIR")"
if [[ -d "$GRAPHITI_DIR/.git" ]]; then
  info "Updating existing checkout…"
  git -C "$GRAPHITI_DIR" fetch --depth 1 origin "$GRAPHITI_REF" 2>/dev/null \
    && git -C "$GRAPHITI_DIR" checkout -q FETCH_HEAD 2>/dev/null \
    || warn "Update failed (dirty worktree?) — using existing checkout."
else
  info "Cloning ${REPO_URL} (${GRAPHITI_REF})…"
  git clone --depth 1 --branch "$GRAPHITI_REF" "$REPO_URL" "$GRAPHITI_DIR" 2>/dev/null \
    || git clone --depth 1 "$REPO_URL" "$GRAPHITI_DIR" \
    || die "Clone failed. Check your internet connection."
fi
[[ -d "$MCP_SERVER_DIR" ]] || die "mcp_server/ not found — upstream layout changed?"
# FalkorDBLite requires Python >=3.12; the repo pins 3.10 via .python-version.
# graphiti's requires-python is >=3.10,<4, so 3.12 is compatible — force it.
echo "$PYTHON_VERSION" >"$MCP_SERVER_DIR/.python-version"
success "Repository ready at ${GRAPHITI_DIR}"

# =============================================================================
section "Step 4/6 — Python deps (graphiti MCP + providers + FalkorDBLite)"
# =============================================================================
cd "$MCP_SERVER_DIR"
info "uv sync (this pulls graphiti-core, mcp, and provider SDKs — a few minutes)…"
# --extra providers → groq, google-genai, anthropic, voyage, sentence-transformers
uv sync --python "$PYTHON_VERSION" --extra providers || die "uv sync failed. See output above."
info "Adding FalkorDBLite (embedded, no-docker FalkorDB)…"
uv pip install falkordblite || die "falkordblite install failed."
# Sanity: both the MCP entrypoint and the embedded DB must import.
uv run python -c "import falkordb; from redislite.falkordb_client import FalkorDB; print('falkordblite ok')" \
  || die "FalkorDBLite import failed (is libomp installed?)."
success "Python dependencies installed."

# =============================================================================
section "Step 5/6 — Ollama embedding model (default local embedder)"
# =============================================================================
if command -v ollama &>/dev/null; then
  info "Pulling Ollama embed model '${EMBED_MODEL}'…"
  ollama pull "$EMBED_MODEL" 2>&1 | tail -1 || warn "Ollama pull failed — pull '${EMBED_MODEL}' manually, or pick Gemini embeddings in Loom settings."
  info "Pulling Ollama graph LLM '${LLM_MODEL}' (capable local extractor, ~2GB)…"
  ollama pull "$LLM_MODEL" 2>&1 | tail -1 || warn "Ollama pull failed — pull '${LLM_MODEL}' manually, or pick Gemini/Groq in Loom settings."
  success "Ollama models ready."
else
  warn "Ollama not installed. Install from https://ollama.com to use local embeddings,"
  warn "or choose Gemini embeddings in Loom's Knowledge Base settings (needs a Google key)."
fi

# =============================================================================
section "Step 6/6 — FalkorDB launcher script"
# =============================================================================
# Loom spawns this with `uv run python falkor_launcher.py`. It starts the
# embedded FalkorDB on a TCP port (FALKOR_PORT, default 6379) with AOF
# persistence under FALKOR_DATA, prints a handshake line, and stays alive.
mkdir -p "$LOOM_DATA_DIR"
cat >"$LAUNCHER_PATH" <<'PYEOF'
#!/usr/bin/env python3
"""FalkorDBLite launcher for Loom — embedded FalkorDB over TCP with AOF persistence.

Env:
  FALKOR_PORT  TCP port to bind        (default 6379)
  FALKOR_DATA  persistence directory   (default ~/.loom/graphiti)
Prints `LOOM_FALKOR {"port": N}` once ready, then blocks.
"""
import json
import os
import signal
import sys
import threading
from pathlib import Path

from redislite.falkordb_client import FalkorDB

port = os.environ.get("FALKOR_PORT", "6379")
data_dir = Path(os.environ.get("FALKOR_DATA", str(Path.home() / ".loom" / "graphiti")))
data_dir.mkdir(parents=True, exist_ok=True)

db = FalkorDB(
    str(data_dir / "falkor.db"),
    serverconfig={
        "port": str(port),
        "appendonly": "yes",            # AOF persistence (durable)
        "appendfilename": "loom.aof",
        "save": "300 10",               # plus periodic RDB snapshots
    },
)
actual = db.client.execute_command("CONFIG", "GET", "port")[1]
print("LOOM_FALKOR " + json.dumps({"port": int(actual)}), flush=True)

stop = threading.Event()
signal.signal(signal.SIGTERM, lambda *_: stop.set())
signal.signal(signal.SIGINT, lambda *_: stop.set())
try:
    stop.wait()
finally:
    db.close()
    sys.exit(0)
PYEOF
chmod +x "$LAUNCHER_PATH"
success "Launcher written → ${LAUNCHER_PATH}"

# =============================================================================
section "Install Complete"
# =============================================================================
echo -e "${GREEN}${BOLD}"
echo "  Graphiti is installed (no Docker)."
echo "  Loom will start FalkorDB + the MCP server on demand."
echo -e "${RESET}"
echo -e "${CYAN}Default knowledge-base config (editable in Loom → Settings):${RESET}"
echo "    LLM       : Ollama (${LLM_MODEL})  — local, no key, no rate limits"
echo "    Embedder  : Ollama (${EMBED_MODEL})  — local, no key"
echo "    Database  : FalkorDBLite (persistent, ${LOOM_DATA_DIR})"
echo ""
echo "    LLM options    : Ollama (local) · Google Gemini · Groq · custom OpenAI-compatible"
echo "    Embed options  : Ollama (local) · Google Gemini"
echo ""

emit_summary "success" "Graphiti installed (FalkorDBLite, no Docker). Loom manages runtime."
exit 0
