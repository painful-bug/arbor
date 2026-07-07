import { describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../store/db.ts";
import { settings } from "../store/schema.ts";
import { buildNamingPrompt, parseNames, typeSummary } from "./cleanup.ts";
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

describe("buildNamingPrompt", () => {
	it("includes every cluster id and the JSON shape line", () => {
		const prompt = buildNamingPrompt([
			{ id: "a", text: "notes about cats" },
			{ id: "b", text: "notes about dogs" },
		]);
		expect(prompt).toContain('cluster id="a"');
		expect(prompt).toContain('cluster id="b"');
		expect(prompt).toContain("notes about cats");
		expect(prompt).toContain('{"names":{"<cluster id>":"<label>", ...}}');
	});
});

describe("typeSummary", () => {
	it("counts kinds, most common first", () => {
		const s = typeSummary([
			{ id: "1", kind: "PDF" },
			{ id: "2", kind: "PDF" },
			{ id: "3", kind: "note" },
		]);
		expect(s).toBe("2 PDF, 1 note");
	});
	it("ignores members with no kind", () => {
		expect(typeSummary([{ id: "1" }, { id: "2", kind: "PDF" }])).toBe("1 PDF");
	});
});

describe("parseNames", () => {
	it("keeps only known ids with string values, trimmed and capped", () => {
		const out = parseNames({ names: { a: "  Neural Networks  ", b: 42, zz: "unknown id" } }, [
			"a",
			"b",
		]);
		expect(out).toEqual({ a: "Neural Networks" });
	});

	it("caps labels at 48 chars", () => {
		const long = "x".repeat(80);
		const out = parseNames({ names: { a: long } }, ["a"]);
		expect(out.a.length).toBe(48);
	});

	it("returns {} for malformed input", () => {
		expect(parseNames(null, ["a"])).toEqual({});
		expect(parseNames({}, ["a"])).toEqual({});
	});
});

describe("POST /api/cleanup/:canvas/name", () => {
	it("returns {names:{}} for an empty body", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default/name", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ names: {} });
	});

	it("returns {names:{}} when no provider is configured (graceful degradation)", async () => {
		// Other test files may have written a real settings row to the shared test
		// db — clear it so this assertion doesn't depend on file execution order.
		db.delete(settings).where(eq(settings.id, 1)).run();
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default/name", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				clusters: [{ id: "c1", members: [{ id: "n1", text: "some note text" }] }],
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ names: {} });
	});
});
