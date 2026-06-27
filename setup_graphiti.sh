#!/usr/bin/env bash
# =============================================================================
#  Graphiti MCP Server — No-Docker One-Click Setup for macOS
#
#  Stack (zero Docker):
#    • Neo4j Community Edition  — graph database, installed via Homebrew
#    • Python 3.12 + uv         — runs the Graphiti MCP server natively
#    • getzep/graphiti repo     — cloned to ~/.graphiti
#
#  The MCP server starts as a background process managed by a launchd plist,
#  so it survives reboots automatically.
#
#  MCP endpoint: http://localhost:8000/mcp/
# =============================================================================

set -Eeuo pipefail
IFS=$'\n\t'

# ── Colour helpers ─────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info() { echo -e "${CYAN}[graphiti]${RESET}  $*"; }
success() { echo -e "${GREEN}[graphiti] ✔${RESET}  $*"; }
warn() { echo -e "${YELLOW}[graphiti] ⚠${RESET}  $*"; }
die() {
  echo -e "${RED}[graphiti] ✖ ERROR:${RESET}  $*" >&2
  emit_summary "error" "$*"
  exit 1
}
section() { echo -e "\n${BOLD}${CYAN}══ $* ══${RESET}\n"; }

# ── Configurable via environment ───────────────────────────────────────────────
GRAPHITI_DIR="${GRAPHITI_INSTALL_DIR:-$HOME/.graphiti}"
REPO_URL="https://github.com/getzep/graphiti.git"
MCP_PORT="${GRAPHITI_MCP_PORT:-8000}"
MCP_ENDPOINT="http://localhost:${MCP_PORT}/mcp/"
SUMMARY_FILE="${GRAPHITI_SUMMARY_FILE:-}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:-demodemo}" # Graphiti's default
OPENAI_API_KEY="${OPENAI_API_KEY:-}"

LAUNCHD_LABEL="com.graphiti.mcp"
PLIST_PATH="$HOME/Library/LaunchAgents/${LAUNCHD_LABEL}.plist"
LOG_DIR="$HOME/Library/Logs/graphiti"

# ── macOS guard ────────────────────────────────────────────────────────────────
[[ "$(uname)" == "Darwin" ]] || die "This script targets macOS only."

# ── Summary emitter (read by parent TypeScript installer) ─────────────────────
emit_summary() {
  local status="$1" message="$2"
  local json
  json=$(printf '{
  "graphiti_setup": {
    "status": "%s",
    "message": "%s",
    "mcp_endpoint": "%s",
    "install_dir": "%s",
    "mcp_port": %s,
    "transport": "http",
    "database": "neo4j",
    "neo4j_bolt": "bolt://localhost:7687"
  }
}' "$status" "$message" "$MCP_ENDPOINT" "$GRAPHITI_DIR" "$MCP_PORT")
  echo "$json"
  if [[ -n "$SUMMARY_FILE" ]]; then
    echo "$json" >"$SUMMARY_FILE"
    info "Summary written → ${SUMMARY_FILE}"
  fi
}

# ── Semver comparator — returns 0 if $1 >= $2 ─────────────────────────────────
version_gte() {
  python3 -c "
import sys
def parse(v): return tuple(int(x) for x in v.split('.')[:3])
sys.exit(0 if parse('$1') >= parse('$2') else 1)
" 2>/dev/null
}

# ── Wait for a TCP port to accept connections ──────────────────────────────────
wait_for_port() {
  local host="$1" port="$2" retries="${3:-30}" delay="${4:-3}"
  for ((i = 1; i <= retries; i++)); do
    if nc -z "$host" "$port" 2>/dev/null; then return 0; fi
    echo -n "."
    sleep "$delay"
  done
  echo ""
  return 1
}

# ── Wait for an HTTP endpoint to return 200/404/etc (any response) ────────────
wait_for_http() {
  local url="$1" retries="${2:-40}" delay="${3:-5}"
  for ((i = 1; i <= retries; i++)); do
    if curl -sf --max-time 3 "$url" -o /dev/null 2>/dev/null; then return 0; fi
    echo -n "."
    sleep "$delay"
  done
  echo ""
  return 1
}

# ── Idempotent PATH update for the current session ────────────────────────────
add_to_path() {
  local dir="$1"
  [[ ":$PATH:" != *":$dir:"* ]] && export PATH="$dir:$PATH"
}

# =============================================================================
#  BANNER
# =============================================================================
section "Graphiti MCP Server — No-Docker Setup"
info "Install dir  : ${GRAPHITI_DIR}"
info "MCP endpoint : ${MCP_ENDPOINT}"
info "macOS        : $(sw_vers -productVersion)"
echo ""

# =============================================================================
#  STEP 1 — Homebrew
# =============================================================================
section "Step 1/6 — Homebrew"

if ! command -v brew &>/dev/null; then
  info "Homebrew not found — installing…"
  NONINTERACTIVE=1 /bin/bash -c \
    "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" ||
    die "Homebrew installation failed. Check your internet connection."

  # Apple Silicon prefix
  if [[ -f /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    grep -q 'homebrew' "$HOME/.zprofile" 2>/dev/null ||
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >>"$HOME/.zprofile"
  fi
fi

add_to_path "$(brew --prefix)/bin"
success "Homebrew $(brew --version | head -1 | awk '{print $2}')"

# =============================================================================
#  STEP 2 — Python 3.12 + uv
# =============================================================================
section "Step 2/6 — Python 3.12 and uv"

# --- Python: need 3.12+ for falkordblite and graphiti ---
PYTHON_CMD=""
for py in python3.13 python3.12; do
  if command -v "$py" &>/dev/null; then
    PY_VER=$("$py" --version 2>&1 | awk '{print $2}')
    if version_gte "$PY_VER" "3.12.0"; then
      PYTHON_CMD="$py"
      success "Python ${PY_VER} (${py})"
      break
    fi
  fi
done

if [[ -z "$PYTHON_CMD" ]]; then
  info "Installing Python 3.12 via Homebrew (this may take a few minutes)…"
  brew install python@3.12 ||
    die "Failed to install Python 3.12. Check brew output above."
  PYTHON_CMD="$(brew --prefix)/bin/python3.12"
  add_to_path "$(dirname "$PYTHON_CMD")"
  success "Python 3.12 installed."
fi

# --- uv ---
if ! command -v uv &>/dev/null; then
  info "Installing uv…"
  curl -LsSf https://astral.sh/uv/install.sh | sh ||
    die "uv installation failed."
  # uv installs to ~/.local/bin or ~/.cargo/bin depending on version
  add_to_path "$HOME/.local/bin"
  add_to_path "$HOME/.cargo/bin"
  # Persist for future shells
  grep -q '\.local/bin' "$HOME/.zshrc" 2>/dev/null ||
    printf '\nexport PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"\n' >>"$HOME/.zshrc"
fi

command -v uv &>/dev/null || die "uv not found after install. Please open a new terminal and re-run."
success "uv $(uv --version)"

# =============================================================================
#  STEP 3 — git
# =============================================================================
section "Step 3/6 — git"

if ! command -v git &>/dev/null; then
  info "Installing git via Homebrew…"
  brew install git || die "git installation failed."
fi
success "git $(git --version | awk '{print $3}')"

# =============================================================================
#  STEP 4 — Neo4j Community (Homebrew service, no Java install needed)
# =============================================================================
section "Step 4/6 — Neo4j Community Edition"

# Check if already installed via Homebrew
NEO4J_INSTALLED=false
if brew list neo4j &>/dev/null 2>&1; then
  NEO4J_INSTALLED=true
  success "Neo4j already installed via Homebrew."
else
  info "Installing Neo4j Community Edition via Homebrew…"
  info "(Homebrew will install a compatible JDK automatically as a dependency)"
  brew install neo4j ||
    die "Neo4j installation failed. Try: brew install neo4j manually."
  NEO4J_INSTALLED=true
  success "Neo4j installed."
fi

# ── Set the password Graphiti expects (demodemo) ──────────────────────────────
# Neo4j's Homebrew formula stores neo4j.conf at:
#   $(brew --prefix)/etc/neo4j/neo4j.conf
# We also need to set the initial password via the cypher-shell or neo4j-admin.
# Easiest approach: use neo4j-admin dbms set-initial-password before first start.

NEO4J_BIN="$(brew --prefix)/bin/neo4j"
NEO4J_ADMIN="$(brew --prefix)/bin/neo4j-admin"
NEO4J_CONF_DIR="$(brew --prefix)/etc/neo4j"

# Ensure the config dir exists (it does after install, but be defensive)
[[ -d "$NEO4J_CONF_DIR" ]] || die "Neo4j config directory not found at ${NEO4J_CONF_DIR}. Installation may be incomplete."

# Set initial password — this only takes effect before the first DB start
info "Configuring Neo4j initial password…"
"$NEO4J_ADMIN" dbms set-initial-password "$NEO4J_PASSWORD" 2>/dev/null ||
  warn "Could not set initial password (database may already be initialised — will proceed)."

# ── Enable HTTP bolt connector on default port ─────────────────────────────────
# Homebrew's default neo4j.conf already has bolt on 7687. Nothing to change.

# ── Start Neo4j as a Homebrew service ─────────────────────────────────────────
info "Starting Neo4j service…"
brew services start neo4j 2>/dev/null ||
  brew services restart neo4j 2>/dev/null ||
  warn "brew services start failed — attempting direct start."

# ── Wait for Bolt port (7687) to be ready ─────────────────────────────────────
info "Waiting for Neo4j Bolt on port 7687…"
if wait_for_port localhost 7687 40 4; then
  echo ""
  success "Neo4j is up on bolt://localhost:7687"
else
  echo ""
  # Neo4j sometimes takes longer on first boot (index rebuild, etc.)
  warn "Neo4j port 7687 not yet open after ~160 s."
  warn "This can happen on the very first boot while Neo4j initialises its store."
  warn "The script will continue — the MCP server will retry the connection."
fi

# =============================================================================
#  STEP 5 — Clone / update Graphiti repo + install Python deps
# =============================================================================
section "Step 5/6 — Graphiti repository and dependencies"

mkdir -p "$(dirname "$GRAPHITI_DIR")"

if [[ -d "$GRAPHITI_DIR/.git" ]]; then
  info "Repository already exists at ${GRAPHITI_DIR} — pulling latest…"
  git -C "$GRAPHITI_DIR" pull --ff-only 2>/dev/null ||
    warn "Git pull failed (dirty worktree?) — using existing checkout."
else
  info "Cloning ${REPO_URL} → ${GRAPHITI_DIR}…"
  git clone --depth 1 "$REPO_URL" "$GRAPHITI_DIR" ||
    die "Clone failed. Check your internet connection."
fi
success "Repository ready."

MCP_SERVER_DIR="${GRAPHITI_DIR}/mcp_server"
[[ -d "$MCP_SERVER_DIR" ]] ||
  die "mcp_server/ not found inside the repo. The upstream layout may have changed — check ${REPO_URL}."

# ── Install Python dependencies via uv ────────────────────────────────────────
info "Installing Python dependencies (uv sync)…"
cd "$MCP_SERVER_DIR"

# Tell uv which Python to use — must be 3.12+
uv sync --python "$PYTHON_CMD" ||
  die "uv sync failed. See output above."
success "Dependencies installed."

# =============================================================================
#  STEP 6 — API key, config.yaml, and MCP server launch
# =============================================================================
section "Step 6/6 — Configuration and MCP server launch"

# ── OpenAI key ────────────────────────────────────────────────────────────────
ENV_FILE="${MCP_SERVER_DIR}/.env"

if [[ -z "$OPENAI_API_KEY" ]]; then
  # Try reading from a previous run
  if [[ -f "$ENV_FILE" ]]; then
    OPENAI_API_KEY=$(grep -E '^OPENAI_API_KEY=' "$ENV_FILE" |
      cut -d= -f2- | tr -d '"' | tr -d "'") || true
  fi
fi

if [[ -z "$OPENAI_API_KEY" ]]; then
  echo ""
  echo -e "${BOLD}An OpenAI API key is required for Graphiti's LLM operations.${RESET}"
  echo -e "Get one at: ${CYAN}https://platform.openai.com/api-keys${RESET}"
  echo ""
  read -rsp "  Paste your OpenAI API key and press Enter: " OPENAI_API_KEY
  echo ""
  [[ -z "$OPENAI_API_KEY" ]] && die "No API key entered. Aborting."
fi

[[ "$OPENAI_API_KEY" == sk-* ]] ||
  warn "Key doesn't start with 'sk-' — it may be invalid. Continuing anyway."

# ── Write .env ────────────────────────────────────────────────────────────────
cat >"$ENV_FILE" <<ENV
# Graphiti MCP — generated by setup_graphiti.sh
OPENAI_API_KEY=${OPENAI_API_KEY}
MODEL_NAME=gpt-4.1-mini
GRAPHITI_TELEMETRY_ENABLED=false
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=${NEO4J_PASSWORD}
ENV
chmod 600 "$ENV_FILE"
success ".env written."

# ── Write config.yaml (neo4j backend, http transport) ─────────────────────────
CONFIG_FILE="${MCP_SERVER_DIR}/config.yaml"
cat >"$CONFIG_FILE" <<YAML
server:
  transport: "http"
  port: ${MCP_PORT}

llm:
  provider: "openai"
  model: "gpt-4.1-mini"

database:
  provider: "neo4j"
  providers:
    neo4j:
      uri: "bolt://localhost:7687"
      username: "neo4j"
      password: "${NEO4J_PASSWORD}"

graphiti:
  group_id: "main"
YAML
success "config.yaml written."

# ── Build the uv path we'll use in the plist ──────────────────────────────────
UV_BIN="$(command -v uv)"
MAIN_PY="${MCP_SERVER_DIR}/main.py"
[[ -f "$MAIN_PY" ]] || die "main.py not found at ${MAIN_PY}. Repo structure may have changed."

# ── Stop any previous MCP server instance ─────────────────────────────────────
if [[ -f "$PLIST_PATH" ]]; then
  info "Unloading previous launchd agent…"
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
fi

# Kill any orphan process already on the port
if lsof -ti ":${MCP_PORT}" &>/dev/null; then
  info "Killing process already using port ${MCP_PORT}…"
  lsof -ti ":${MCP_PORT}" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── Create log directory ───────────────────────────────────────────────────────
mkdir -p "$LOG_DIR"

# ── Write launchd plist (auto-restarts on crash, starts at login) ─────────────
mkdir -p "$HOME/Library/LaunchAgents"
cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${UV_BIN}</string>
    <string>run</string>
    <string>${MAIN_PY}</string>
    <string>--database-provider</string>
    <string>neo4j</string>
    <string>--transport</string>
    <string>http</string>
    <string>--port</string>
    <string>${MCP_PORT}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${MCP_SERVER_DIR}</string>

  <!-- Environment variables for the MCP process -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>OPENAI_API_KEY</key>
    <string>${OPENAI_API_KEY}</string>
    <key>MODEL_NAME</key>
    <string>gpt-4.1-mini</string>
    <key>NEO4J_URI</key>
    <string>bolt://localhost:7687</string>
    <key>NEO4J_USER</key>
    <string>neo4j</string>
    <key>NEO4J_PASSWORD</key>
    <string>${NEO4J_PASSWORD}</string>
    <key>GRAPHITI_TELEMETRY_ENABLED</key>
    <string>false</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.local/bin:${HOME}/.cargo/bin</string>
  </dict>

  <key>StandardOutPath</key>
  <string>${LOG_DIR}/mcp-server.log</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/mcp-server.err</string>

  <!-- Restart on crash, start at login -->
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>RunAtLoad</key>
  <true/>

  <key>ThrottleInterval</key>
  <integer>10</integer>
</dict>
</plist>
PLIST

success "launchd plist written → ${PLIST_PATH}"

# ── Load and start the agent ───────────────────────────────────────────────────
info "Loading Graphiti MCP launchd agent…"
launchctl load "$PLIST_PATH" ||
  die "launchctl load failed. Check that ${PLIST_PATH} is valid XML."

# =============================================================================
#  HEALTH CHECK
# =============================================================================
section "Health Check"

info "Waiting for MCP server at ${MCP_ENDPOINT}…"
if wait_for_http "$MCP_ENDPOINT" 40 5; then
  echo ""
  success "Graphiti MCP server is UP!"
else
  echo ""
  warn "MCP server did not respond within the timeout."
  warn "It may still be starting — Neo4j can take 30-60 s on first boot."
  echo ""
  warn "Check logs with:"
  echo "  tail -f ${LOG_DIR}/mcp-server.log"
  echo "  tail -f ${LOG_DIR}/mcp-server.err"
  echo ""
  warn "Check Neo4j status with:  brew services info neo4j"
fi

# =============================================================================
#  FINAL SUMMARY
# =============================================================================
section "Setup Complete"

echo -e "${GREEN}${BOLD}"
echo "  ┌────────────────────────────────────────────────────────────────┐"
echo "  │              Graphiti MCP Server is ready!                     │"
echo "  ├────────────────────────────────────────────────────────────────┤"
printf "  │  MCP endpoint   :  %-45s│\n" "${MCP_ENDPOINT}"
printf "  │  Neo4j Bolt     :  %-45s│\n" "bolt://localhost:7687"
printf "  │  Neo4j Browser  :  %-45s│\n" "http://localhost:7474"
printf "  │  Install dir    :  %-45s│\n" "${GRAPHITI_DIR}"
echo "  ├────────────────────────────────────────────────────────────────┤"
echo "  │  Useful commands:                                              │"
echo "  │    MCP logs   : tail -f ~/Library/Logs/graphiti/mcp-server.log│"
echo "  │    Stop MCP   : launchctl unload ${PLIST_PATH}     │"
echo "  │    Stop Neo4j : brew services stop neo4j                      │"
echo "  │    Restart MCP: launchctl kickstart -k gui/\$(id -u)/com.graphiti.mcp │"
echo "  └────────────────────────────────────────────────────────────────┘"
echo -e "${RESET}"

echo -e "${CYAN}TypeScript MCP client config:${RESET}"
echo ""
cat <<JSON
  {
    "mcpServers": {
      "graphiti": {
        "url": "${MCP_ENDPOINT}"
      }
    }
  }
JSON
echo ""

emit_summary "success" "Graphiti MCP server running at ${MCP_ENDPOINT} (Neo4j backend, no Docker)"
exit 0
