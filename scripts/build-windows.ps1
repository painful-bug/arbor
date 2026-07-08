#!/usr/bin/env pwsh
# Build Arbor for Windows — produces NSIS installer + MSI
# Prerequisites: Rust toolchain, Node.js, Bun, NSIS (via winget or choco)
#
# Usage: pwsh scripts/build-windows.ps1
#        or from cmd: powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not $RepoRoot) { $RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..") }
$TauriDir = Join-Path $RepoRoot "frontend" "src-tauri"
$ResourcesDir = Join-Path $TauriDir "resources"
$BinariesDir = Join-Path $TauriDir "binaries"

$Arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "i686" }
$TargetTriple = "$Arch-pc-windows-msvc"

Write-Host "=== Arbor Windows build ($TargetTriple) ==="

# --- 1. Build local workspace packages (backend depends on file:../packages/*) ---
$PackagesSrc = Join-Path $RepoRoot "packages"
$MosaicSrc = Join-Path $PackagesSrc "mosaic"
if (Test-Path $MosaicSrc) {
    Write-Host "--- Building @arbor/mosaic ---"
    Push-Location $MosaicSrc
    try {
        & bun install
        & bun run build
    } finally { Pop-Location }
}

# --- 2. Stage + prune backend into tauri resources ---
# Single cross-platform script shared with the macOS build + CI, so the two OS
# paths can't drift. It stages backend/src + packages, runs `bun install
# --production`, and prunes node_modules with case-SENSITIVE matching (this used
# to be inline PowerShell whose case-insensitive -match deleted a real lowercase
# source file and crashed the app — see scripts/stage-backend.ts).
& bun (Join-Path $RepoRoot "scripts/stage-backend.ts")
if ($LASTEXITCODE -ne 0) { throw "stage-backend failed" }

# --- 2. Copy bun as sidecar ---
Write-Host "--- Copying bun sidecar ---"
if (-not (Test-Path $BinariesDir)) { New-Item -ItemType Directory -Path $BinariesDir | Out-Null }

$BunExe = (Get-Command bun -ErrorAction Stop).Source
$BunDest = Join-Path $BinariesDir "bun-$TargetTriple.exe"
Copy-Item $BunExe $BunDest -Force
Write-Host "Bun sidecar: $BunDest"

# --- 3. Build the Tauri app ---
Write-Host "--- Building Tauri app ---"
Push-Location (Join-Path $RepoRoot "frontend")
try {
    & npx tauri build 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Tauri build failed" }
} finally { Pop-Location }

Write-Host "=== Build complete ==="

# Show output artifacts
$BundleDir = Join-Path $TauriDir "target" "release" "bundle"
if (Test-Path $BundleDir) {
    Get-ChildItem -Recurse $BundleDir -Include "*.exe","*.msi" | ForEach-Object {
        Write-Host "  -> $($_.FullName) ($("{0:N1} MB" -f ($_.Length / 1MB)))"
    }
}
