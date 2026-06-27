// Integration test for the Graphiti knowledge base. Spawns the real FalkorDB +
// MCP server, so it's slow and requires the stack installed (setup_graphiti.sh)
// plus Ollama running. Gated behind LOOM_KB_IT=1 so the normal `bun test` run
// (which has no Graphiti) stays fast and green.
//
//   LOOM_KB_IT=1 bun test src/kb/mcp-client.test.ts
import { describe, expect, test } from "bun:test";

const IT = process.env.LOOM_KB_IT === "1";

describe("knowledge base (integration)", () => {
	test.skipIf(!IT)(
		"adds an episode and searches it back, isolated per canvas",
		async () => {
			process.env.GRAPHITI_FALKOR_PORT ||= "6410";
			process.env.GRAPHITI_MCP_PORT ||= "8780";
			const sp = await import("./server-process.ts");
			const mc = await import("./mcp-client.ts");

			const A = `itA_${Date.now()}`;
			const B = `itB_${Date.now()}`;
			await sp.startGraphiti();
			expect(sp.graphitiReady()).toBe(true);

			await mc.addMemory(A, "ada", "Ada Lovelace wrote the first computer algorithm in 1843.");
			await mc.addMemory(B, "tesla", "Nikola Tesla designed the alternating-current induction motor in 1887.");

			let nA: string[] = [];
			let nB: string[] = [];
			for (let i = 0; i < 60; i++) {
				await Bun.sleep(3000);
				nA = await mc.searchNodes(A, "algorithm Ada Babbage analytical engine");
				nB = await mc.searchNodes(B, "Tesla alternating current motor");
				if (nA.length && nB.length) break;
			}

			// Each canvas produced graph nodes…
			expect(nA.length).toBeGreaterThan(0);
			expect(nB.length).toBeGreaterThan(0);

			// …and they are isolated: A's graph never contains B's entities.
			const crossA = (await mc.searchNodes(A, "Tesla motor")).join(" ").toLowerCase();
			const crossB = (await mc.searchNodes(B, "Ada Lovelace algorithm")).join(" ").toLowerCase();
			expect(crossA).not.toContain("tesla");
			expect(crossB).not.toContain("ada");

			await sp.stopGraphiti();
		},
		300_000,
	);
});
