#!/usr/bin/env pwsh
# Build Arbor for Windows — produces NSIS installer + MSI
# Prerequisites: Rust toolchain, Node.js, Bun, NSIS (via winget or choco)
#
# Usage: pwsh scripts/build-windows.ps1
#        or from cmd: powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$TauriDir = Join-Path $RepoRoot "frontend" "src-tauri"
$ResourcesDir = Join-Path $TauriDir "resources"
$BinariesDir = Join-Path $TauriDir "binaries"

$Arch = if ([Environment]::Is64BitOperatingSystem) { "x86_64" } else { "i686" }
$TargetTriple = "$Arch-pc-windows-msvc"

Write-Host "=== Arbor Windows build ($TargetTriple) ==="

# --- 1. Stage backend into tauri resources ---
Write-Host "--- Staging backend ---"
$BackendDest = Join-Path $ResourcesDir "backend"
if (Test-Path $BackendDest) { Remove-Item -Recurse -Force $BackendDest }
New-Item -ItemType Directory -Path $BackendDest -Force | Out-Null

$BackendSrc = Join-Path $RepoRoot "backend"
Copy-Item -Recurse (Join-Path $BackendSrc "src") (Join-Path $BackendDest "src")
Copy-Item (Join-Path $BackendSrc "package.json") $BackendDest
if (Test-Path (Join-Path $BackendSrc "bun.lock")) {
    Copy-Item (Join-Path $BackendSrc "bun.lock") $BackendDest
}
if (Test-Path (Join-Path $BackendSrc "native")) {
    Copy-Item -Recurse (Join-Path $BackendSrc "native") (Join-Path $BackendDest "native")
}

Write-Host "Installing production deps..."
Push-Location $BackendDest
try {
    & bun install --frozen-lockfile 2>$null
    if ($LASTEXITCODE -ne 0) { & bun install }
} finally { Pop-Location }

# Prune non-Windows native binaries
Write-Host "Pruning non-Windows binaries..."
$NM = Join-Path $BackendDest "node_modules"
if (Test-Path $NM) {
    # Remove linux/darwin platform dirs from native packages
    Get-ChildItem -Path $NM -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -in @("linux", "darwin", "macos") } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

    # Remove non-matching arch dirs
    if ($Arch -eq "x86_64") {
        Get-ChildItem -Path $NM -Recurse -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -eq "arm64" } |
            Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }

    # Remove .d.ts, README, CHANGELOG (not needed at runtime)
    Get-ChildItem -Path $NM -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match '\.(d\.ts|d\.mts|d\.cts)$' -or $_.Name -match '^(README|CHANGELOG|LICENSE)' } |
        Remove-Item -Force -ErrorAction SilentlyContinue

    Get-ChildItem -Path $NM -Recurse -Directory -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -eq "docs" } |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
}

$BackendSize = "{0:N1} MB" -f ((Get-ChildItem -Recurse $BackendDest | Measure-Object -Property Length -Sum).Sum / 1MB)
Write-Host "Backend staged: $BackendSize"

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
