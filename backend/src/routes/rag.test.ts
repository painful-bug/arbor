// RAG route integration test. Loads a small text and verifies search recalls it.
// Embedding model downloads on first run (~45 MB) — subsequent runs use MODELS_DIR cache.
import { describe, it, expect } from "bun:test";
import { createApp } from "../server.ts";

const TOKEN = "test-rag-token";
const app = createApp(TOKEN);

function api(path: string, init?: RequestInit) {
	return app.fetch(
		new Request(`http://localhost${path}`, {
			...init,
			headers: { Authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
		}),
	);
}

const NOTES = `
# Third Normal Form

A relation is in 3NF if it is in 2NF and no non-prime attribute is transitively
dependent on any key. This eliminates transitive dependencies in a relational schema.

# Cooking basics

To make pasta: boil salted water, cook pasta al dente, reserve some pasta water,
combine with sauce. Season to taste.
`.trim();

describe("RAG routes", () => {
	// First run downloads the BGE model (~45 MB); allow 120 s. Cached on subsequent runs.
	it("indexes text and returns relevant chunk on search", async () => {
		const bytes = new TextEncoder().encode(NOTES);

		// Index the document
		const put = await api("/api/rag/test-canvas/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("notes.txt") },
			body: bytes,
		});
		expect(put.status).toBe(200);
		const { chunks } = (await put.json()) as { chunks: number };
		expect(chunks).toBeGreaterThan(0);

		// Search — 3NF chunk should surface on top
		const res = await api("/api/rag/test-canvas/search?q=third+normal+form&k=2");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].toLowerCase()).toContain("3nf");
	}, 120_000);

	it("returns empty results for empty canvas", async () => {
		const res = await api("/api/rag/empty-canvas/search?q=anything&k=4");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(results).toEqual([]);
	});

	it("clears canvas index", async () => {
		// Index something first
		await api("/api/rag/clear-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": "x.txt" },
			body: new TextEncoder().encode("banana pancakes"),
		});
		// Delete
		const del = await api("/api/rag/clear-test/files", { method: "DELETE" });
		expect(del.status).toBe(200);
		// Search now returns nothing
		const res = await api("/api/rag/clear-test/search?q=banana&k=4");
		const { results } = (await res.json()) as { results: string[] };
		expect(results).toEqual([]);
	});
});
