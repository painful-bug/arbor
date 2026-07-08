#!/usr/bin/env bun
// Single source of truth for staging the backend into the Tauri resources dir
// and pruning its node_modules for shipping. Run by BOTH CI jobs
// (.github/workflows/build.yml) and BOTH local build scripts
// (scripts/build-windows.ps1, scripts/build-macos.sh) so the macOS and Windows
// packaging paths can never drift.
//
// Why this exists: the prune logic used to be copy-pasted as bash (macOS) and
// PowerShell (Windows). PowerShell's `-match`/`-in` are case-INSENSITIVE by
// default, so `^(README|CHANGELOG|LICENSE)` also deleted the real lowercase
// source file @mariozechner/pi-coding-agent/dist/utils/changelog.js on Windows
// only — crashing the backend before its handshake and blank-screen-crashing
// the app. JS string comparison here (startsWith/endsWith/===, no /i regex) is
// case-SENSITIVE on every OS, exactly like bash's `find -name`, so that whole
// bug class is structurally impossible.
//
// REGRESSION CANARY: pi-coding-agent/dist/utils/changelog.js MUST survive
// pruning (it's a lowercase .js source, statically imported). Nothing below
// removes .js files — only fixed extensions (.map/.d.ts/.md/...) and exact-case
// name prefixes (README/CHANGELOG/LICENSE) that a lowercase name can't match.
//
// The prune helpers are exported and top-level execution is guarded by
// `import.meta.main`, so scripts/stage-backend.test.ts can exercise them.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..");
const RESOURCES_DIR = join(REPO_ROOT, "frontend", "src-tauri", "resources");
const BACKEND_DEST = join(RESOURCES_DIR, "backend");
const BACKEND_SRC = join(REPO_ROOT, "backend");
const PACKAGES_SRC = join(REPO_ROOT, "packages");
const NM = join(BACKEND_DEST, "node_modules");

const rmrf = (p: string) => rmSync(p, { recursive: true, force: true });

// Other-arch native-binary substring (e.g. remove foo.x64.node on an arm64 host).
const OTHER_ARCH_TOKEN = process.arch === "arm64" ? "x64" : "arm64";
const NATIVE_EXTS = [".node", ".dylib", ".so", ".dll"];

// Directory basenames to delete anywhere in the tree: other-OS native dirs,
// other-arch dirs, and dev-only dirs. Case-SENSITIVE, matching bash `find -name`.
export function removeDirNames(platform = process.platform, arch = process.arch): Set<string> {
	// Other-OS native dirs — keep only the host platform's.
	const otherOs: Record<string, string[]> = {
		darwin: ["linux", "win32", "win"],
		win32: ["linux", "darwin", "macos"],
		linux: ["win32", "win", "darwin", "macos"],
	};
	// Other-arch dirs — keep only the host arch's (npm/napi conventionally lowercase).
	const otherArch = arch === "arm64" ? ["x64"] : ["arm64"];
	return new Set([
		...(otherOs[platform] ?? []),
		...otherArch,
		"test",
		"tests",
		"__tests__",
		"example",
		"examples",
		"benchmark",
		"benchmarks",
		"docs",
		".github",
	]);
}

const DIR_NAMES = removeDirNames();

export function shouldRemoveFile(name: string): boolean {
	// Docs / typedefs / source maps — fixed extensions, never .js.
	if (
		name.endsWith(".map") ||
		name.endsWith(".d.ts") ||
		name.endsWith(".d.mts") ||
		name.endsWith(".d.cts") ||
		name.endsWith(".md")
	) {
		return true;
	}
	// Case-sensitive prefixes — lowercase `changelog.js` cannot match.
	if (name.startsWith("README") || name.startsWith("CHANGELOG") || name.startsWith("LICENSE")) {
		return true;
	}
	// Other-arch native binaries.
	if (name.includes(OTHER_ARCH_TOKEN) && NATIVE_EXTS.some((e) => name.endsWith(e))) {
		return true;
	}
	return false;
}

// Recursively prune: delete matching dirs (don't descend), delete matching files.
export function pruneTree(dir: string, dirNames: Set<string> = DIR_NAMES): void {
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isSymbolicLink()) continue; // handled by removeBrokenSymlinks
		if (entry.isDirectory()) {
			if (dirNames.has(entry.name)) {
				rmrf(full);
			} else {
				pruneTree(full, dirNames);
			}
		} else if (entry.isFile() && shouldRemoveFile(entry.name)) {
			try {
				rmSync(full, { force: true });
			} catch {}
		}
	}
}

// Delete symlinks whose target no longer exists (broken after pruning).
function removeBrokenSymlinks(dir: string): void {
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			if (!existsSync(full)) {
				try {
					rmSync(full, { force: true });
				} catch {}
			}
		} else if (entry.isDirectory()) {
			removeBrokenSymlinks(full);
		}
	}
}

function dirSize(dir: string): number {
	let total = 0;
	let entries: ReturnType<typeof readdirSync>;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		try {
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) total += dirSize(full);
			else if (entry.isFile()) total += statSync(full).size;
		} catch {}
	}
	return total;
}

function stageBackend(): void {
	// ── 1. Stage backend source ─────────────────────────────────────────────────
	console.log("--- Staging backend ---");
	rmrf(BACKEND_DEST);
	rmrf(join(RESOURCES_DIR, "packages"));
	mkdirSync(BACKEND_DEST, { recursive: true });

	cpSync(join(BACKEND_SRC, "src"), join(BACKEND_DEST, "src"), { recursive: true });
	cpSync(join(BACKEND_SRC, "package.json"), join(BACKEND_DEST, "package.json"));
	if (existsSync(join(BACKEND_SRC, "bun.lock"))) {
		cpSync(join(BACKEND_SRC, "bun.lock"), join(BACKEND_DEST, "bun.lock"));
	}
	if (existsSync(join(BACKEND_SRC, "native"))) {
		cpSync(join(BACKEND_SRC, "native"), join(BACKEND_DEST, "native"), { recursive: true });
	}

	// Copy local workspace packages so the backend's file:../packages/* deps
	// resolve from their new staged location. Nested node_modules are excluded
	// from the copy (bun reinstalls them for the staged backend, and their
	// symlinks/junctions break a plain recursive copy on Windows → EPERM).
	if (existsSync(PACKAGES_SRC)) {
		cpSync(PACKAGES_SRC, join(RESOURCES_DIR, "packages"), {
			recursive: true,
			filter: (src) => !/[\\/]node_modules([\\/]|$)/.test(src),
		});
	}

	// ── 2. Install production deps ───────────────────────────────────────────────
	// --production drops top-level dev-only deps (typescript, @types/*) that are
	// never imported at runtime (Bun transpiles .ts natively) — real, zero-risk
	// size cut. Transitive deps of runtime packages are unaffected.
	console.log("--- Installing production deps ---");
	const install = (frozen: boolean) =>
		Bun.spawnSync(["bun", "install", "--production", ...(frozen ? ["--frozen-lockfile"] : [])], {
			cwd: BACKEND_DEST,
			stdout: "inherit",
			stderr: "inherit",
			windowsHide: true,
		});
	let res = install(true);
	if (res.exitCode !== 0) {
		console.warn("Frozen install failed; retrying without --frozen-lockfile");
		res = install(false);
	}
	if (res.exitCode !== 0) {
		console.error("bun install failed");
		process.exit(1);
	}

	// ── 3. Prune node_modules ────────────────────────────────────────────────────
	console.log("--- Pruning node_modules ---");
	if (existsSync(NM)) {
		// bun resolves modules directly; broken .bin symlinks crash the Tauri bundler.
		rmrf(join(NM, ".bin"));

		// Packages not needed at runtime. NOTE: onnxruntime-web / onnx-proto MUST
		// stay — @xenova/transformers' onnx.js does an unconditional
		// `import * as ONNX_WEB from 'onnxruntime-web'` at module load even on Bun.
		rmrf(join(NM, "playwright-core"));
		rmrf(join(NM, "pdfjs-dist", "legacy"));

		pruneTree(NM);
		removeBrokenSymlinks(NM);
	}

	const sizeMB = (dirSize(BACKEND_DEST) / (1024 * 1024)).toFixed(1);
	console.log(`Backend staged: ${sizeMB} MB`);
}

if (import.meta.main) stageBackend();
