// One-time migration of the old ~/.arbor JSON layout into SQLite. Runs on boot when
// the canvases table is empty but a legacy index.json exists. Idempotent (the empty
// check guards re-runs) and non-destructive — original JSON files are left in place
// as a backup. Blob *bytes* already live in ~/.arbor/blobs and stay there; we only
// record their mime/name rows.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "./db.ts";
import { canvases, settings, blobMeta } from "./schema.ts";
import { setCurrentAndOrder } from "../routes/canvases.ts";
import { LEGACY_INDEX, legacyDoc, LEGACY_SETTINGS, BLOBS_DIR } from "../paths.ts";

interface LegacyMeta {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

function readJson<T>(path: string): T | null {
	try {
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

// Returns a one-line summary, or null if nothing was imported.
export function importLegacyIfNeeded(): string | null {
	const count = db.select({ n: sql<number>`count(*)` }).from(canvases).get();
	if ((count?.n ?? 0) > 0) return null; // already have data — never re-import
	if (!existsSync(LEGACY_INDEX)) return null;

	const index = readJson<{ current: string; list: LegacyMeta[] }>(LEGACY_INDEX);
	if (!index?.list?.length) return null;

	let canvasCount = 0;
	for (const m of index.list) {
		const doc = readJson<{ nodes?: unknown[]; edges?: unknown[] }>(legacyDoc(m.id));
		if (!doc) continue;
		db.insert(canvases)
			.values({
				id: m.id,
				name: m.name,
				createdAt: m.createdAt,
				updatedAt: m.updatedAt,
				doc: JSON.stringify({ nodes: doc.nodes ?? [], edges: doc.edges ?? [] }),
			})
			.run();
		canvasCount++;
	}
	setCurrentAndOrder(index.current, index.list.map((m) => m.id));

	// Settings.
	const legacySettings = readJson<unknown>(LEGACY_SETTINGS);
	if (legacySettings) {
		db.insert(settings)
			.values({ id: 1, json: JSON.stringify(legacySettings) })
			.onConflictDoUpdate({ target: settings.id, set: { json: JSON.stringify(legacySettings) } })
			.run();
	}

	// Blob metadata (bytes already on disk under ~/.arbor/blobs).
	let blobCount = 0;
	if (existsSync(BLOBS_DIR)) {
		for (const file of readdirSync(BLOBS_DIR)) {
			if (!file.endsWith(".meta.json")) continue;
			const id = file.slice(0, -".meta.json".length);
			const meta = readJson<{ mime: string; name: string }>(join(BLOBS_DIR, file));
			if (!meta) continue;
			db.insert(blobMeta)
				.values({ id, mime: meta.mime, name: meta.name })
				.onConflictDoNothing()
				.run();
			blobCount++;
		}
	}

	return `imported ${canvasCount} canvas(es), ${blobCount} blob(s)${legacySettings ? ", settings" : ""}`;
}
