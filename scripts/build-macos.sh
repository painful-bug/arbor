#!/bin/bash
# Local macOS build: stage backend, build a .dmg, install it to /Applications.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAURI_DIR="$REPO_ROOT/frontend/src-tauri"
RESOURCES_DIR="$TAURI_DIR/resources"
BINARIES_DIR="$TAURI_DIR/binaries"

# Load CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN / R2_BUCKET from .env if present
# (already-exported env vars still win, since `source` only sets what .env defines).
if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

# --- Git release flow: commit dev, merge to main, push (triggers CI) ---------
# Runs BEFORE the (slow) build so a merge conflict fails fast without wasting a
# build. Set SKIP_GIT=1 to bypass entirely (e.g. re-running just the build).
# Branch names override via DEV_BRANCH / MAIN_BRANCH; remote via GIT_REMOTE.
DEV_BRANCH="${DEV_BRANCH:-dev}"
MAIN_BRANCH="${MAIN_BRANCH:-main}"
GIT_REMOTE="${GIT_REMOTE:-origin}"

if [ "${SKIP_GIT:-0}" != "1" ] && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "=== Git release flow ($DEV_BRANCH -> $MAIN_BRANCH) ==="
  cd "$REPO_ROOT"

  # Fail early if a merge/rebase is already half-done (e.g. from a prior conflict).
  if [ -f "$(git rev-parse --git-dir)/MERGE_HEAD" ]; then
    echo "A merge is already in progress. Resolve it (git status), commit, then re-run." >&2
    echo "To skip the git flow entirely: SKIP_GIT=1 $0" >&2
    exit 1
  fi

  # Make sure the branches exist before touching anything.
  if ! git show-ref --verify --quiet "refs/heads/$DEV_BRANCH"; then
    echo "Branch '$DEV_BRANCH' not found. Set DEV_BRANCH or create it." >&2
    exit 1
  fi
  if ! git show-ref --verify --quiet "refs/heads/$MAIN_BRANCH"; then
    echo "Branch '$MAIN_BRANCH' not found. Set MAIN_BRANCH or create it." >&2
    exit 1
  fi

  # Get onto dev (switching with a dirty tree fails loudly, which is correct).
  CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$CURRENT_BRANCH" != "$DEV_BRANCH" ]; then
    echo "--- Switching to $DEV_BRANCH ---"
    git checkout "$DEV_BRANCH"
  fi

  # Stage + commit any working-tree changes on dev. --porcelain is empty == clean.
  if [ -n "$(git status --porcelain)" ]; then
    echo "--- Uncommitted changes on $DEV_BRANCH ---"
    git add -A
    COMMIT_MSG=""
    while [ -z "$COMMIT_MSG" ]; do
      printf "Commit message for %s: " "$DEV_BRANCH"
      IFS= read -r COMMIT_MSG || { echo "No input; aborting." >&2; exit 1; }
      [ -z "$COMMIT_MSG" ] && echo "Message can't be empty."
    done
    git commit -m "$COMMIT_MSG"
  else
    echo "No uncommitted changes on $DEV_BRANCH."
  fi

  # Merge dev into main. On conflict, git leaves the tree in the normal conflicted
  # state — resolve with the usual `git add` + `git commit`, then re-run this script.
  echo "--- Merging $DEV_BRANCH into $MAIN_BRANCH ---"
  git checkout "$MAIN_BRANCH"
  if ! git merge --no-edit "$DEV_BRANCH"; then
    echo "" >&2
    echo "Merge conflict merging $DEV_BRANCH into $MAIN_BRANCH." >&2
    echo "Resolve the conflicts, then:  git add <files> && git commit" >&2
    echo "Then re-run this script (it will continue: push + build)." >&2
    echo "To abort the merge instead:   git merge --abort" >&2
    exit 1
  fi

  # Push main to trigger the GitHub Actions build.
  echo "--- Pushing $MAIN_BRANCH to $GIT_REMOTE ---"
  git push "$GIT_REMOTE" "$MAIN_BRANCH"

  # Return to dev so the working state matches where the user was developing.
  git checkout "$DEV_BRANCH"
  echo "=== Git release flow done (back on $DEV_BRANCH) ==="
elif [ "${SKIP_GIT:-0}" = "1" ]; then
  echo "SKIP_GIT=1 set — skipping git release flow."
fi

ARCH=$(uname -m)
case "$ARCH" in
  arm64) TRIPLE="aarch64-apple-darwin" ;;
  x86_64) TRIPLE="x86_64-apple-darwin" ;;
  *) echo "Unsupported arch: $ARCH"; exit 1 ;;
esac

echo "=== Arbor macOS build ($TRIPLE) ==="

# --- Install deps where missing (skip if already present) ---
[ -d "$REPO_ROOT/node_modules" ] || (cd "$REPO_ROOT" && npm install --legacy-peer-deps)
[ -d "$REPO_ROOT/frontend/node_modules" ] || (cd "$REPO_ROOT/frontend" && npm install)
[ -d "$REPO_ROOT/backend/node_modules" ] || (cd "$REPO_ROOT/backend" && bun install)

# --- Build local workspace packages (backend depends on file:../packages/*) ---
if [ -d "$REPO_ROOT/packages/mosaic" ]; then
  echo "--- Building @arbor/mosaic ---"
  (cd "$REPO_ROOT/packages/mosaic" && bun install && bun run build)
fi

# --- Stage backend into tauri resources ---
echo "--- Staging backend ---"
rm -rf "$RESOURCES_DIR/backend" "$RESOURCES_DIR/packages"
mkdir -p "$RESOURCES_DIR/backend"
cp -r "$REPO_ROOT/backend/src" "$RESOURCES_DIR/backend/src"
cp "$REPO_ROOT/backend/package.json" "$RESOURCES_DIR/backend/"
cp "$REPO_ROOT/backend/bun.lock" "$RESOURCES_DIR/backend/" 2>/dev/null || true
[ -d "$REPO_ROOT/backend/native" ] && cp -r "$REPO_ROOT/backend/native" "$RESOURCES_DIR/backend/native"

if [ -d "$REPO_ROOT/packages" ]; then
  cp -r "$REPO_ROOT/packages" "$RESOURCES_DIR/packages"
  find "$RESOURCES_DIR/packages" -name node_modules -type d -exec rm -rf {} + 2>/dev/null || true
fi

(cd "$RESOURCES_DIR/backend" && bun install --frozen-lockfile)

echo "--- Pruning non-darwin / wrong-arch native binaries ---"
NM="$RESOURCES_DIR/backend/node_modules"
OTHER_ARCH=$([ "$ARCH" = "arm64" ] && echo x64 || echo arm64)
find "$NM" -type d \( -name linux -o -name win32 -o -name win -o -name "$OTHER_ARCH" \) -exec rm -rf {} + 2>/dev/null || true
find "$NM" -type f -name "*$OTHER_ARCH*" \( -name "*.node" -o -name "*.dylib" -o -name "*.so" \) -delete 2>/dev/null || true
find "$NM" -type f \( -name "*.d.ts" -o -name "*.d.mts" -o -name "*.d.cts" -o -name "*.map" -o -name "README*" -o -name "CHANGELOG*" -o -name "LICENSE*" \) -delete 2>/dev/null || true
echo "Backend staged: $(du -sh "$RESOURCES_DIR/backend" | cut -f1)"

# --- Bun sidecar ---
echo "--- Copying bun sidecar ---"
mkdir -p "$BINARIES_DIR"
cp "$(python3 -c "import os,shutil; print(os.path.realpath(shutil.which('bun')))")" "$BINARIES_DIR/bun-$TRIPLE"
chmod +x "$BINARIES_DIR/bun-$TRIPLE"

# --- Build the .app (skip updater-artifact signing, local build only) ---
echo "--- Building Tauri app ---"
(cd "$REPO_ROOT/frontend" && npx tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}')

APP_BUNDLE=$(find "$TAURI_DIR/target/release/bundle/macos" -name "*.app" -maxdepth 1 | head -1)

# --- Build the dmg ourselves: hdiutil create -srcfolder needs no mount/unmount,
# so it sidesteps Tauri's flaky create-dmg AppleScript/hdiutil eject race. ---
DMG=""
if [ -n "$APP_BUNDLE" ]; then
  echo "--- Building .dmg ---"
  DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
  STAGING=$(mktemp -d)
  cp -R "$APP_BUNDLE" "$STAGING/"
  ln -s /Applications "$STAGING/Applications"
  mkdir -p "$DMG_DIR"
  DMG="$DMG_DIR/Arbor.dmg"
  rm -f "$DMG"
  hdiutil create -volname Arbor -srcfolder "$STAGING" -ov -format UDZO "$DMG"
  rm -rf "$STAGING"
fi

if [ -n "$APP_BUNDLE" ]; then
  APP_NAME=$(basename "$APP_BUNDLE")
  echo "--- Installing $APP_NAME to /Applications ---"
  pkill -f "$APP_NAME/Contents/MacOS" 2>/dev/null || true
  sleep 1
  rm -rf "/Applications/$APP_NAME"
  cp -R "$APP_BUNDLE" "/Applications/$APP_NAME"
  echo "Installed: /Applications/$APP_NAME"
else
  echo "WARNING: no .app bundle found"
fi

# --- Upload DMG to Cloudflare R2 (skipped unless creds + DMG present) ---
# Uses R2's S3-compatible API via `aws s3 cp`, not `wrangler r2 object put` —
# wrangler caps object-put at 300 MiB and the Arbor.dmg is ~400 MiB, so it
# needs the multipart upload aws-cli does automatically.
# Auth: dedicated R2 API token (R2 -> Manage R2 API Tokens -> Object Read &
# Write), NOT the general CLOUDFLARE_API_TOKEN used elsewhere in this script.
# Bucket: R2_BUCKET (default arbor-downloads). Uploads a stable Arbor.dmg (what
# the website's Download button points at) plus a versioned copy for archives.
# ponytail: inline env auth, no wrangler.toml — add one only if this grows steps.
if [ -n "$DMG" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -n "${R2_SECRET_ACCESS_KEY:-}" ]; then
  R2_BUCKET="${R2_BUCKET:-arbor-downloads}"
  VERSION=$(grep -m1 '"version"' "$TAURI_DIR/tauri.conf.json" | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
  echo "--- Uploading DMG to R2 bucket: $R2_BUCKET (v$VERSION) ---"
  # Arbor.dmg is the "latest" key — no-cache forces the CDN to revalidate
  # with R2 on every request instead of trusting Cloudflare's default
  # max-age=14400, which previously served a stale DMG for up to 4h after
  # a new release. Arbor-$VERSION.dmg never changes once published, so it's
  # safe (and faster for repeat downloads) to cache it aggressively.
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp "$DMG" "s3://$R2_BUCKET/Arbor.dmg" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --content-type application/x-apple-diskimage --cache-control "no-cache"
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp "$DMG" "s3://$R2_BUCKET/Arbor-$VERSION.dmg" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --content-type application/x-apple-diskimage --cache-control "public, max-age=31536000, immutable"
  # version.json: the website fetches this client-side to show the latest
  # version without a rebuild. no-store so the CDN doesn't serve a stale one.
  printf '{"version":"%s","dmg_url":"https://dl.aishikb.dev/Arbor.dmg","released_at":"%s"}' \
    "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > /tmp/arbor-version.json
  AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    aws s3 cp /tmp/arbor-version.json "s3://$R2_BUCKET/version.json" \
    --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" \
    --content-type application/json --cache-control "no-store"
  rm -f /tmp/arbor-version.json
  echo "Uploaded: Arbor.dmg + Arbor-$VERSION.dmg + version.json"
  # Belt-and-suspenders: even with no-cache, an edge PoP can serve a
  # still-valid cached copy for a few seconds/minutes under load. Purge
  # explicitly so the new DMG is live everywhere immediately. Needs
  # CLOUDFLARE_API_TOKEN (Zone > Cache Purge) + CLOUDFLARE_ZONE_ID; skipped
  # silently if either is unset (no-cache alone still bounds staleness).
  if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ZONE_ID:-}" ]; then
    echo "--- Purging Cloudflare cache for dl.aishikb.dev ---"
    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$CLOUDFLARE_ZONE_ID/purge_cache" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data "{\"files\":[\"https://dl.aishikb.dev/Arbor.dmg\",\"https://dl.aishikb.dev/version.json\"]}"
    echo
  fi
else
  echo "Skipping R2 upload (need DMG + CLOUDFLARE_ACCOUNT_ID + R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY; optional R2_BUCKET)."
fi

echo "=== Build complete ==="
[ -n "$DMG" ] && echo "DMG: $DMG"
