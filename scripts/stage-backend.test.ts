// Verifies the prune logic that ships the backend node_modules — specifically
// the case-sensitivity guarantee that once failed (a case-insensitive match
// deleted the real lowercase changelog.js and blank-screen-crashed the app).
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneTree, removeDirNames, shouldRemoveFile } from "./stage-backend.ts";

test("shouldRemoveFile keeps lowercase source, removes docs/typedefs", () => {
	// The regression canary: lowercase changelog.js must survive.
	expect(shouldRemoveFile("changelog.js")).toBe(false);
	expect(shouldRemoveFile("index.js")).toBe(false);
	expect(shouldRemoveFile("readme.js")).toBe(false);
	expect(shouldRemoveFile("license.ts")).toBe(false);

	// Docs / typedefs / maps — removed.
	expect(shouldRemoveFile("CHANGELOG.md")).toBe(true);
	expect(shouldRemoveFile("README.md")).toBe(true);
	expect(shouldRemoveFile("README")).toBe(true);
	expect(shouldRemoveFile("LICENSE")).toBe(true);
	expect(shouldRemoveFile("notes.md")).toBe(true);
	expect(shouldRemoveFile("index.d.ts")).toBe(true);
	expect(shouldRemoveFile("index.d.mts")).toBe(true);
	expect(shouldRemoveFile("bundle.js.map")).toBe(true);
});

test("removeDirNames is host-specific and case-sensitive", () => {
	const win = removeDirNames("win32", "x64");
	expect(win.has("darwin")).toBe(true);
	expect(win.has("linux")).toBe(true);
	expect(win.has("arm64")).toBe(true);
	expect(win.has("docs")).toBe(true);
	expect(win.has("win32")).toBe(false); // keep the host platform's dirs
	expect(win.has("win")).toBe(false);
	expect(win.has("x64")).toBe(false);
	expect(win.has("Docs")).toBe(false); // exact case only

	const mac = removeDirNames("darwin", "arm64");
	expect(mac.has("win32")).toBe(true);
	expect(mac.has("win")).toBe(true);
	expect(mac.has("linux")).toBe(true);
	expect(mac.has("x64")).toBe(true);
	expect(mac.has("darwin")).toBe(false);
	expect(mac.has("macos")).toBe(false);
	expect(mac.has("arm64")).toBe(false);
});

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "prune-"));
});
afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

test("pruneTree removes docs/typedefs/dev-dirs but keeps source", () => {
	const pkg = join(dir, "pi-coding-agent", "dist", "utils");
	mkdirSync(pkg, { recursive: true });
	writeFileSync(join(pkg, "changelog.js"), "// real source"); // canary
	writeFileSync(join(pkg, "index.js"), "// real source");
	writeFileSync(join(pkg, "index.d.ts"), "// typedef");
	writeFileSync(join(pkg, "CHANGELOG.md"), "# docs");
	writeFileSync(join(pkg, "README.md"), "# docs");

	const testsDir = join(dir, "somepkg", "test");
	mkdirSync(testsDir, { recursive: true });
	writeFileSync(join(testsDir, "a.js"), "// test file");

	const winDir = join(dir, "native", "win32");
	mkdirSync(winDir, { recursive: true });
	writeFileSync(join(winDir, "b.node"), "binary");

	// Prune as if on a macOS/arm64 host so win32 + x64 dirs go.
	pruneTree(dir, removeDirNames("darwin", "arm64"));

	// Kept — real source.
	expect(existsSync(join(pkg, "changelog.js"))).toBe(true);
	expect(existsSync(join(pkg, "index.js"))).toBe(true);
	// Removed — docs / typedefs.
	expect(existsSync(join(pkg, "index.d.ts"))).toBe(false);
	expect(existsSync(join(pkg, "CHANGELOG.md"))).toBe(false);
	expect(existsSync(join(pkg, "README.md"))).toBe(false);
	// Removed — dev dir + other-OS native dir.
	expect(existsSync(testsDir)).toBe(false);
	expect(existsSync(winDir)).toBe(false);
});
