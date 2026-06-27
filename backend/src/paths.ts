// All app data lives under ~/.loom (unchanged from the old Rust shell, so existing
// users' canvases/blobs are found and migrated). One place resolves these paths.
import { homedir } from "node:os";
import { join } from "node:path";

// Data root. Defaults to ~/.loom; LOOM_DIR overrides it (tests use a temp dir).
export const LOOM_DIR = process.env.LOOM_DIR || join(homedir(), ".loom");
export const DB_PATH = join(LOOM_DIR, "loom.db");
export const BLOBS_DIR = join(LOOM_DIR, "blobs");

// Graphiti knowledge base. Install dir is global (~/.graphiti, created by
// setup_graphiti.sh); the FalkorDB graph data lives under LOOM_DIR so tests
// get an isolated store.
export const GRAPHITI_DIR = process.env.GRAPHITI_INSTALL_DIR || join(homedir(), ".graphiti");
export const GRAPHITI_MCP_DIR = join(GRAPHITI_DIR, "mcp_server");
export const GRAPHITI_LAUNCHER = join(GRAPHITI_DIR, "falkor_launcher.py");
export const GRAPHITI_DATA_DIR = join(LOOM_DIR, "graphiti");

// Written at startup so the sidecar bridge can discover port+token without Rust IPC.
export const BACKEND_HANDSHAKE_FILE = join(LOOM_DIR, "backend.json");

// Legacy JSON layout the importer reads once (left in place as backup).
export const LEGACY_INDEX = join(LOOM_DIR, "canvases", "index.json");
export const legacyDoc = (id: string) => join(LOOM_DIR, "canvases", `${id}.json`);
export const LEGACY_SETTINGS = join(LOOM_DIR, "settings.json");
