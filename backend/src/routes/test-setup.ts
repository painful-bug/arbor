// Preloaded before all test files. Sets LOOM_DIR to a temp dir so db.ts
// never opens ~/.loom/loom.db during test runs.
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

if (!process.env.LOOM_DIR) {
	process.env.LOOM_DIR = mkdtempSync(tmpdir() + "/loom-test-");
}
