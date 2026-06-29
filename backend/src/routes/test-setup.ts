// Preloaded before all test files. Sets ARBOR_DIR to a temp dir so db.ts
// never opens ~/.arbor/arbor.db during test runs.
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

if (!process.env.ARBOR_DIR) {
	process.env.ARBOR_DIR = mkdtempSync(tmpdir() + "/arbor-test-");
}
