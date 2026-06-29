// Open the SQLite database and expose a Drizzle handle. Tables are created
// idempotently at boot — for four trivial tables that's simpler than carrying a
// drizzle-kit migration folder, and bun:sqlite is built in (no native module to
// bundle later). ponytail: CREATE TABLE IF NOT EXISTS, add migrations only if the
// schema ever needs versioned changes.
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { DB_PATH, ARBOR_DIR, BLOBS_DIR } from "../paths.ts";
import * as schema from "./schema.ts";

mkdirSync(ARBOR_DIR, { recursive: true });
mkdirSync(BLOBS_DIR, { recursive: true });

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;"); // concurrent reads while writing

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS canvases (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		doc TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS settings (
		id INTEGER PRIMARY KEY,
		json TEXT NOT NULL
	);
	CREATE TABLE IF NOT EXISTS blob_meta (
		id TEXT PRIMARY KEY,
		mime TEXT NOT NULL,
		name TEXT NOT NULL
	);
`);

export const db = drizzle(sqlite, { schema });

// Small kv helpers over the meta table for "current" + "order".
export function metaGet(key: string): string | null {
	const row = sqlite.query("SELECT value FROM meta WHERE key = ?").get(key) as
		| { value: string }
		| null;
	return row?.value ?? null;
}

export function metaSet(key: string, value: string): void {
	sqlite.run(
		"INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		[key, value],
	);
}
