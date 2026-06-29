// Blob route tests: store, fetch, and delete bytes by (canvas-namespaced) id.
import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-blob-token");

describe("Blob routes", () => {
	it("stores, returns, then deletes a blob", async () => {
		const id = "canvasA:n1"; // colon-namespaced key the frontend now uses
		const path = `/api/blobs/${encodeURIComponent(id)}`;
		const bytes = new TextEncoder().encode("hello blob");

		const put = await api(path, {
			method: "PUT",
			headers: { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("a.txt") },
			body: bytes
		});
		expect(put.status).toBe(200);

		const get = await api(path);
		expect(get.status).toBe(200);
		expect(await get.text()).toBe("hello blob");

		const del = await api(path, { method: "DELETE" });
		expect(del.status).toBe(200);

		const gone = await api(path);
		expect(gone.status).toBe(404);
	});

	it("rejects ids that escape the blobs dir", async () => {
		const res = await api(`/api/blobs/${encodeURIComponent("../escape")}`, { method: "DELETE" });
		expect(res.status).toBe(400);
	});
});
