// Diagnostic harness for the "KB search returns gibberish" bug. Ingests real file
// text into an ISOLATED Graphiti instance (own ports + temp LOOM_DIR) and dumps the
// raw entities/facts the LLM extracted, so we can see whether extraction tracks the
// source text. Run:
//   cd backend && LOOM_DIR=$(mktemp -d) GRAPHITI_FALKOR_PORT=6399 GRAPHITI_MCP_PORT=8766 \
//     bun run src/kb/diag.ts "/path/to/file.pdf" [maxChunks]
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { startGraphiti, stopGraphiti, graphitiReady } from "./server-process.ts";
import { addMemory, searchNodes, searchFacts, status, rawCall } from "./mcp-client.ts";
import { loadText } from "./loaders.ts";

const path = process.argv[2];
const maxChunks = Number(process.argv[3] ?? 2);
if (!path) { console.error("usage: bun run src/kb/diag.ts <file> [maxChunks]"); process.exit(1); }

const GROUP = `diag_${Date.now()}`;
const bytes = new Uint8Array(readFileSync(path));
const mime = path.endsWith(".pdf") ? "application/pdf" : "text/plain";

console.log(`[diag] extracting text from ${basename(path)}…`);
const text = await loadText(basename(path), mime, bytes);
console.log(`[diag] ${text.length} chars extracted. First 300: ${text.slice(0, 300).replace(/\s+/g, " ")}`);

// Same chunker the real pipeline uses, inlined so we can size each chunk.
function splitText(t: string, size = 2000, overlap = 200): string[] {
	const paras = t.split(/\n\n+/);
	const chunks: string[] = [];
	let buf = "";
	for (const p of paras) {
		if (buf.length + p.length + 2 > size && buf) { chunks.push(buf.trim()); buf = buf.slice(Math.max(0, buf.length - overlap)); }
		buf += (buf ? "\n\n" : "") + p;
	}
	if (buf.trim()) chunks.push(buf.trim());
	return chunks;
}
const chunks = splitText(text).slice(0, maxChunks);
console.log(`[diag] using ${chunks.length} chunk(s); sizes(chars)=${chunks.map((c) => c.length).join(",")} (~tokens=${chunks.map((c) => Math.round(c.length / 4)).join(",")})`);

console.log("[diag] starting isolated Graphiti…");
await startGraphiti();
if (!graphitiReady()) { console.error("[diag] FAIL: MCP not healthy"); await stopGraphiti(); process.exit(1); }
console.log("[diag] status:", await status());

console.log("[diag] ingesting chunks…");
const t0 = Date.now();
for (let i = 0; i < chunks.length; i++) await addMemory(GROUP, `${basename(path)}#${i}`, chunks[i], "text", basename(path));

// Poll until the background queue produces entities (or give up).
let nodes: string[] = [];
for (let i = 0; i < 80; i++) {
	await Bun.sleep(3000);
	nodes = await searchNodes(GROUP, "network protocol layer", 20);
	process.stdout.write(nodes.length ? `[${nodes.length}]` : ".");
	if (nodes.length >= 3) break;
}
console.log(`\n[diag] extraction wall time ~${Math.round((Date.now() - t0) / 1000)}s`);

// Dump what the graph actually holds, against several real networking queries.
for (const q of ["OSI model layers", "TCP IP protocol", "router switch network", "definition"]) {
	const ns = await searchNodes(GROUP, q, 8);
	const fs = await searchFacts(GROUP, q, 8);
	console.log(`\n=== query: "${q}" ===`);
	console.log("NODES:", ns);
	console.log("FACTS:", fs);
}

console.log("\n[diag] RAW search_nodes payload for inspection:");
console.log(JSON.stringify(await rawCall("search_nodes", { query: "network", group_ids: [GROUP], max_nodes: 5 }), null, 2).slice(0, 2000));

await stopGraphiti();
process.exit(0);
