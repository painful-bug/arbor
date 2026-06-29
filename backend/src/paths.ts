import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

// Data root. Defaults to ~/.arbor; ARBOR_DIR overrides (tests use a temp dir).
// Falls back to ~/.loom if it exists and ~/.arbor doesn't, so existing installs
// keep working after the rebrand.
function resolveDataDir(): string {
	if (process.env.ARBOR_DIR) return process.env.ARBOR_DIR;
	const arbor = join(homedir(), ".arbor");
	const loom = join(homedir(), ".loom");
	if (!existsSync(arbor) && existsSync(loom)) return loom;
	return arbor;
}

export const ARBOR_DIR = resolveDataDir();
export const DB_PATH = join(ARBOR_DIR, "arbor.db");
export const BLOBS_DIR = join(ARBOR_DIR, "blobs");
export const LANCEDB_DIR = join(ARBOR_DIR, "lancedb");
export const MODELS_DIR = process.env.ARBOR_MODELS_DIR || join(homedir(), ".arbor", "models");
export const BACKEND_HANDSHAKE_FILE = join(ARBOR_DIR, "backend.json");

// Legacy JSON layout the importer reads once (left in place as backup).
export const LEGACY_INDEX = join(ARBOR_DIR, "canvases", "index.json");
export const legacyDoc = (id: string) => join(ARBOR_DIR, "canvases", `${id}.json`);
export const LEGACY_SETTINGS = join(ARBOR_DIR, "settings.json");
