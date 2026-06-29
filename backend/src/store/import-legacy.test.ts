// The importer needs a pristine, empty DB to exercise its first-run path, so each
// case runs in a fresh subprocess with its own temp ARBOR_DIR holding a legacy
// ~/.arbor fixture. Asserts: data lands in SQLite, originals stay, second run no-ops.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Build a legacy ~/.arbor layout in a fresh temp dir.
function fixture(): string {
	const dir = mkdtempSync(join(tmpdir(), "arbor-import-"));
	mkdirSync(join(dir, "canvases"), { recursive: true });
	mkdirSync(join(dir, "blobs"), { recursive: true });
	writeFileSync(
		join(dir, "canvases", "index.json"),
		JSON.stringify({ current: "c2", list: [
			{ id: "c1", name: "First", createdAt: 10, updatedAt: 11 },
			{ id: "c2", name: "Second", createdAt: 20, updatedAt: 21 },
		] }),
	);
	writeFileSync(join(dir, "canvases", "c1.json"), JSON.stringify({ nodes: [{ id: "n1" }], edges: [] }));
	writeFileSync(join(dir, "canvases", "c2.json"), JSON.stringify({ nodes: [], edges: [] }));
	writeFileSync(join(dir, "settings.json"), JSON.stringify({ provider: "anthropic" }));
	writeFileSync(join(dir, "blobs", "b1"), "rawbytes");
	writeFileSync(join(dir, "blobs", "b1.meta.json"), JSON.stringify({ mime: "image/png", name: "p.png" }));
	return dir;
}

// Run a snippet in a subprocess rooted at `dir` (fresh DB singleton each time).
function run(dir: string, snippet: string): string {
	const p = Bun.spawnSync(["bun", "-e", snippet], {
		env: { ...process.env, ARBOR_DIR: dir },
		cwd: join(import.meta.dir, "..", ".."),
	});
	return p.stdout.toString().trim();
}

const doImport = "import('./src/store/import-legacy.ts').then(m => console.log(JSON.stringify(m.importLegacyIfNeeded())))";
const countCanvases =
	"Promise.all([import('./src/store/db.ts'), import('./src/store/schema.ts')]).then(([d, s]) => console.log(JSON.stringify(d.db.select().from(s.canvases).all().map(r => r.id))))";

describe("legacy importer", () => {
	test("imports canvases/settings/blobs, keeps originals, idempotent", () => {
		const dir = fixture();

		expect(run(dir, doImport)).toContain("imported 2 canvas(es), 1 blob(s), settings");
		expect(existsSync(join(dir, "arbor.db"))).toBe(true);
		expect(existsSync(join(dir, "canvases", "index.json"))).toBe(true); // originals untouched

		// Rows actually landed, in order.
		expect(run(dir, countCanvases)).toBe(JSON.stringify(["c1", "c2"]));

		// Second run is a no-op (table non-empty).
		expect(run(dir, doImport)).toBe("null");
	});

	test("no index.json → nothing to import", () => {
		const dir = mkdtempSync(join(tmpdir(), "arbor-empty-"));
		expect(run(dir, doImport)).toBe("null");
	});
});
