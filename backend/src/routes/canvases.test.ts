// Export endpoint only — CRUD happy path is already covered by store.test.ts.
import { describe, expect, test } from "bun:test";
import { createApp } from "../server.ts";

const app = createApp("secret");
const auth = { Authorization: "Bearer secret" } as Record<string, string>;

describe("GET /api/canvases/:id/export", () => {
	const doc = {
		id: "export-canvas",
		name: "My Export Canvas!",
		createdAt: 1,
		updatedAt: 1,
		nodes: [{ id: "n1", type: "text", position: { x: 0, y: 0 }, data: { text: "hello" } }],
		edges: [],
	};

	test("format=md returns Markdown with the right headers", async () => {
		await app.request(`/api/canvases/${doc.id}`, {
			method: "PUT",
			headers: { ...auth, "Content-Type": "application/json" },
			body: JSON.stringify(doc),
		});
		const res = await app.request(`/api/canvases/${doc.id}/export?format=md`, { headers: auth });
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/markdown");
		expect(res.headers.get("Content-Disposition")).toContain("my-export-canvas.md");
		expect(await res.text()).toContain("# My Export Canvas!");
	});

	test("format=canvas returns valid JSON Canvas with the right headers", async () => {
		const res = await app.request(`/api/canvases/${doc.id}/export?format=canvas`, {
			headers: auth,
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("application/json");
		expect(res.headers.get("Content-Disposition")).toContain(".canvas");
		const parsed = JSON.parse(await res.text());
		expect(parsed.nodes).toHaveLength(1);
	});

	test("unknown format → 400 BAD_REQUEST", async () => {
		const res = await app.request(`/api/canvases/${doc.id}/export?format=xml`, { headers: auth });
		expect(res.status).toBe(400);
		expect((await res.json()).code).toBe("BAD_REQUEST");
	});

	test("unknown canvas id → 404 NOT_FOUND", async () => {
		const res = await app.request("/api/canvases/nope/export?format=md", { headers: auth });
		expect(res.status).toBe(404);
		expect((await res.json()).code).toBe("NOT_FOUND");
	});
});
