// Phase-1 proof: start the Graphiti runtime, add an episode, and search it back
// over the MCP HTTP transport from TypeScript. Run:
//   cd backend && LOOM_DIR=$(mktemp -d) GRAPHITI_FALKOR_PORT=6399 GRAPHITI_MCP_PORT=8766 \
//     bun run src/kb/smoke.ts
import { startGraphiti, stopGraphiti, graphitiReady } from "./server-process.ts";
import { addMemory, searchFacts, searchNodes, clearGraph, status } from "./mcp-client.ts";

const GROUP = `smoke_${Date.now()}`;

console.log("[smoke] starting Graphiti…");
await startGraphiti();
if (!graphitiReady()) {
	console.error("[smoke] FAIL: MCP server not healthy");
	await stopGraphiti();
	process.exit(1);
}
console.log("[smoke] status:", await status());

console.log("[smoke] adding episode…");
await addMemory(
	GROUP,
	"ada-note",
	"Ada Lovelace wrote the first computer algorithm in 1843, intended for Charles Babbage's Analytical Engine.",
);

console.log("[smoke] polling for graph extraction (the configured LLM builds it in the background)…");
let facts: string[] = [];
let nodes: string[] = [];
for (let i = 0; i < 40; i++) {
	await Bun.sleep(3000);
	facts = await searchFacts(GROUP, "who wrote the first computer algorithm");
	nodes = await searchNodes(GROUP, "Ada Lovelace");
	if (facts.length || nodes.length) break;
	process.stdout.write(".");
}
console.log("\n[smoke] FACTS:", facts);
console.log("[smoke] NODES:", nodes);

const ok = facts.length > 0 || nodes.length > 0;
console.log(ok ? "[smoke] PASS ✔ — KB reachable from TS and producing output" : "[smoke] FAIL ✖ — no results");

await clearGraph(GROUP);
await stopGraphiti();
process.exit(ok ? 0 : 1);
