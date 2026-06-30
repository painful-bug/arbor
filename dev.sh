#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/frontend"

# Tauri dev mode: starts Vite (beforeDevCommand) then opens the native window.
# Swift runtime rpath is baked into the binary via src-tauri/.cargo/config.toml.
if [[ "$1" == "--web" ]]; then
  # Browser-only mode (no Tauri shell) — faster iteration on UI.
  npm run dev
else
  # cargo's build script requires the externalBin resource to exist on disk
  # even in debug builds (where it's unused at runtime — see backend.rs
  # bun_path()). Mirrors .github/workflows/build.yml's "Copy Bun sidecar" step.
  ARCH=$(uname -m)
  case "$ARCH" in
    arm64) TRIPLE="aarch64-apple-darwin" ;;
    x86_64) TRIPLE="x86_64-apple-darwin" ;;
    *) TRIPLE="" ;;
  esac
  SIDECAR="src-tauri/binaries/bun-$TRIPLE"
  if [[ -n "$TRIPLE" && ! -f "$SIDECAR" ]]; then
    mkdir -p src-tauri/binaries
    BUN_REAL=$(python3 -c "import os; print(os.path.realpath('$(which bun)'))")
    cp "$BUN_REAL" "$SIDECAR"
    chmod +x "$SIDECAR"
  fi

  # Same deal for the bundled-resources dir: cargo's build script checks it
  # exists even though debug builds spawn the backend straight from
  # ../../backend (entry_path() in backend.rs), not from this resource dir.
  if [[ ! -d "src-tauri/resources/backend" ]]; then
    mkdir -p src-tauri/resources/backend
    touch src-tauri/resources/backend/.gitkeep
  fi

  npx tauri dev
fi
