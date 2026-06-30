#!/usr/bin/env bash
# Periodic storage cleanup. Safe to re-run; rebuilds regenerate everything deleted here.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "before:"; du -sh . 2>/dev/null

echo "--- cargo clean (frontend/src-tauri/target)"
(cd frontend/src-tauri && cargo clean) 2>/dev/null || true

echo "--- npm/bun caches"
npm cache clean --force 2>/dev/null || true
command -v bun >/dev/null && bun pm cache rm 2>/dev/null || true

echo "--- vite/turbo/tauri build caches"
rm -rf frontend/.svelte-kit frontend/build frontend/dist frontend/src-tauri/target/release frontend/src-tauri/target/debug

echo "--- stale node_modules (will reinstall on next npm/bun install)"
rm -rf node_modules frontend/node_modules backend/node_modules

echo "--- git gc"
git gc --prune=now --quiet

echo "after:"; du -sh . 2>/dev/null
echo "done. run 'npm install' (root+frontend) and 'cd backend && bun install' before next dev."
