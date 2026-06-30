import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const TOKEN = "test-cleanup-token";

interface Layout {
	cellBase: number;
	unit: number;
	cols: number;
	nodes: Record<string, { col: number; row: number; lx: number; ly: number }>;
}

describe("POST /api/cleanup/:canvas/arrange", () => {
	it("returns a layout entry for every input node", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default/arrange", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				nodes: [
					{ id: "n1", text: "spatial filtering convolution kernels", w: 300, h: 200, x: 0, y: 0 },
					{ id: "n2", text: "histogram equalization contrast", w: 300, h: 200, x: 40, y: 0 },
				],
				edges: [],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { layout: Layout };
		expect(Object.keys(body.layout.nodes).sort()).toEqual(["n1", "n2"]);
		expect(typeof body.layout.cellBase).toBe("number");
		expect(typeof body.layout.nodes.n1.col).toBe("number");
	});

	it("returns null layout for fewer than 2 nodes", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default/arrange", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ nodes: [{ id: "n1", text: "x", w: 1, h: 1, x: 0, y: 0 }], edges: [] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { layout: unknown };
		expect(body.layout).toBeNull();
	});

	it("returns null layout on malformed body (best-effort)", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default/arrange", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "not json",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { layout: unknown };
		expect(body.layout).toBeNull();
	});
});
