// Phase 1 routes: canvases, settings, blobs, keys. Runs against a temp ARBOR_DIR
// set by bunfig.toml preload (test-setup.ts) so the real ~/.arbor is never touched.
import { afterAll, describe, expect, test } from "bun:test";
import { createApp } from "../server.ts";

const app = createApp("secret");
const auth = { Authorization: "Bearer secret" } as Record<string, string>;
const jsonReq = (path: string, method: string, body: unknown) =>
	app.request(path, { method, headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("canvases", () => {
	test("upsert → list → get → reorder → delete", async () => {
		const a = { id: "ca", name: "A", createdAt: 1, updatedAt: 1, nodes: [{ id: "n1" }], edges: [] };
		const b = { id: "cb", name: "B", createdAt: 2, updatedAt: 2, nodes: [], edges: [] };
		expect((await jsonReq("/api/canvases/ca", "PUT", a)).status).toBe(200);
		expect((await jsonReq("/api/canvases/cb", "PUT", b)).status).toBe(200);

		// Order + current pointer (the old index.json write).
		await jsonReq("/api/canvases", "PUT", {
			current: "cb",
			list: [{ id: "cb" }, { id: "ca" }],
		});

		const list = await (await app.request("/api/canvases", { headers: auth })).json();
		expect(list.current).toBe("cb");
		expect(list.list.map((m: { id: string }) => m.id)).toEqual(["cb", "ca"]);
		expect(list.list[0]).not.toHaveProperty("doc"); // metas only, no doc payload

		const doc = await (await app.request("/api/canvases/ca", { headers: auth })).json();
		expect(doc).toEqual({ id: "ca", name: "A", createdAt: 1, updatedAt: 1, nodes: [{ id: "n1" }], edges: [], session: [] });

		expect((await app.request("/api/canvases/ca", { method: "DELETE", headers: auth })).status).toBe(200);
		expect((await app.request("/api/canvases/ca", { headers: auth })).status).toBe(404);
		const after = await (await app.request("/api/canvases", { headers: auth })).json();
		expect(after.list.map((m: { id: string }) => m.id)).toEqual(["cb"]);
	});
});

describe("settings", () => {
	test("null until set, then roundtrips", async () => {
		// Fresh DB: no settings row yet.
		expect(await (await app.request("/api/settings", { headers: auth })).json()).toBeNull();
		const s = { provider: "nim", bashEnabled: true };
		await jsonReq("/api/settings", "PUT", s);
		expect(await (await app.request("/api/settings", { headers: auth })).json()).toEqual(s);
	});
});

describe("blobs", () => {
	test("put bytes → get bytes + mime + name", async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const put = await app.request("/api/blobs/blob1", {
			method: "PUT",
			headers: { ...auth, "Content-Type": "image/png", "X-Filename": "pic.png" },
			body: bytes,
		});
		expect(put.status).toBe(200);

		const got = await app.request("/api/blobs/blob1", { headers: auth });
		expect(got.headers.get("Content-Type")).toBe("image/png");
		expect(decodeURIComponent(got.headers.get("X-Filename")!)).toBe("pic.png");
		expect(new Uint8Array(await got.arrayBuffer())).toEqual(bytes);

		expect((await app.request("/api/blobs/missing", { headers: auth })).status).toBe(404);
		expect((await app.request("/api/blobs/..%2Fetc", { headers: auth })).status).toBe(400);
	});
});

describe("keys (real OS keychain, throwaway provider)", () => {
	const provider = `__arbortest_${Math.random().toString(36).slice(2)}`;
	afterAll(() => Bun.secrets.delete({ service: "app.arbor.canvas", name: provider }));

	test("absent → set → present → test ok", async () => {
		expect(await (await app.request(`/api/keys/${provider}`, { headers: auth })).json()).toEqual({ exists: false });
		expect((await jsonReq(`/api/providers/${provider}/test`, "POST", {})).status).toBe(400);

		await jsonReq(`/api/keys/${provider}`, "PUT", { key: "sk-test-123" });
		expect(await (await app.request(`/api/keys/${provider}`, { headers: auth })).json()).toEqual({ exists: true });
		expect((await jsonReq(`/api/providers/${provider}/test`, "POST", {})).status).toBe(200);
	});

	test("ollama is keyless", async () => {
		expect((await jsonReq("/api/providers/ollama/test", "POST", {})).status).toBe(200);
	});
});
