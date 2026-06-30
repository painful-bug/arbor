#!/usr/bin/env node
import {
  extract,
  toMarkdown
} from "./chunk-QYDVQ2LU.js";

// src/cli.ts
import { readFileSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : void 0;
}
async function main() {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error("usage: mosaic <file> [--pages 1-10] [--out md|json]");
    process.exit(1);
  }
  const out = arg("--out") ?? "md";
  const doc = await extract(new Uint8Array(readFileSync(file)), {
    filename: basename(file),
    pages: arg("--pages"),
    modelDir: arg("--models") ?? join(homedir(), ".arbor", "models"),
    onProgress: (p) => process.stderr.write(`\rpage ${p.page}/${p.total}`)
  });
  process.stderr.write("\n");
  process.stdout.write(out === "json" ? JSON.stringify(doc, null, 2) : toMarkdown(doc));
  process.stdout.write("\n");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
