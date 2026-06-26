#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

# Tauri dev mode: starts Vite (beforeDevCommand) then opens the native window.
# Swift runtime rpath is baked into the binary via src-tauri/.cargo/config.toml.
if [[ "$1" == "--web" ]]; then
  # Browser-only mode (no Tauri shell) — faster iteration on UI.
  npm run dev
else
  npx tauri dev
fi
