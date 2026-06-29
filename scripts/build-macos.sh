#!/bin/bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$REPO_ROOT/frontend/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"
BINARIES_DIR="$TAURI_DIR/binaries"

ARCH=$(uname -m)
case "$ARCH" in
  arm64) TARGET_TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TARGET_TRIPLE="x86_64-apple-darwin" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

echo "=== Arbor macOS build ($TARGET_TRIPLE) ==="

# --- 1. Stage backend into tauri resources ---
echo "--- Staging backend ---"
rm -rf "$RESOURCES_DIR/backend"
mkdir -p "$RESOURCES_DIR/backend"

cp -r "$REPO_ROOT/backend/src" "$RESOURCES_DIR/backend/src"
cp "$REPO_ROOT/backend/package.json" "$RESOURCES_DIR/backend/"
cp "$REPO_ROOT/backend/bun.lock" "$RESOURCES_DIR/backend/" 2>/dev/null || true
cp -r "$REPO_ROOT/backend/native" "$RESOURCES_DIR/backend/native"

echo "Installing production deps..."
cd "$RESOURCES_DIR/backend"
bun install --frozen-lockfile 2>/dev/null || bun install
cd "$REPO_ROOT"

# Prune non-macOS native binaries to save ~400MB
echo "Pruning non-darwin binaries..."
NM="$RESOURCES_DIR/backend/node_modules"

prune_platform_dirs() {
  local pkg_dir="$1"
  [ -d "$pkg_dir" ] || return 0
  # Remove linux/win subdirs from native packages
  find "$pkg_dir" -type d \( -name "linux" -o -name "win32" -o -name "win" \) -exec rm -rf {} + 2>/dev/null || true
  # Remove non-matching arch .node files
  case "$ARCH" in
    arm64)
      find "$pkg_dir" -type f -name "*x64*" \( -name "*.node" -o -name "*.dylib" -o -name "*.so" \) -delete 2>/dev/null || true
      find "$pkg_dir" -type d -name "x64" -exec rm -rf {} + 2>/dev/null || true
      ;;
    x86_64)
      find "$pkg_dir" -type f -name "*arm64*" \( -name "*.node" -o -name "*.dylib" -o -name "*.so" \) -delete 2>/dev/null || true
      find "$pkg_dir" -type d -name "arm64" -exec rm -rf {} + 2>/dev/null || true
      ;;
  esac
}

# Prune known-heavy native packages
for pkg in onnxruntime-node koffi sharp canvas @napi-rs @lancedb; do
  prune_platform_dirs "$NM/$pkg"
done

# Remove .d.ts, README, CHANGELOG, .md docs (not needed at runtime)
find "$NM" -type f \( -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "README*" -o -name "CHANGELOG*" -o -name "LICENSE*" \) -delete 2>/dev/null || true
find "$NM" -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true

echo "Backend staged: $(du -sh "$RESOURCES_DIR/backend" | cut -f1)"

# --- 2. Copy bun as sidecar ---
echo "--- Copying bun sidecar ---"
mkdir -p "$BINARIES_DIR"
BUN_PATH=$(which bun)
# Resolve symlink to actual binary
BUN_REAL=$(python3 -c "import os; print(os.path.realpath('$BUN_PATH'))")
cp "$BUN_REAL" "$BINARIES_DIR/bun-$TARGET_TRIPLE"
chmod +x "$BINARIES_DIR/bun-$TARGET_TRIPLE"
echo "Bun sidecar: $(du -sh "$BINARIES_DIR/bun-$TARGET_TRIPLE" | cut -f1)"

# --- 3. Build the Tauri app ---
echo "--- Building Tauri app ---"
cd "$REPO_ROOT/frontend"
npx tauri build 2>&1

echo "=== Build complete ==="
# Output location
find "$TAURI_DIR/target/release/bundle" -name "*.dmg" -o -name "*.app" 2>/dev/null | head -5
