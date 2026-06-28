import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-kb-token");

const NOTES = `
# Third Normal Form

A relation is in 3NF if it is in 2NF and no non-prime attribute is transitively
dependent on any key. This eliminates transitive dependencies in a relational schema.
`.trim();

describe("KB routes", () => {
	it("POST /api/kb/:canvas/files → 200, chunks > 0 for plain text", async () => {
		const res = await api("/api/kb/test-canvas/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("notes.txt") },
			body: new TextEncoder().encode(NOTES)
		});
		expect(res.status).toBe(200);
		const { chunks, error } = (await res.json()) as { chunks?: number; error?: string };
		expect(error).toBeUndefined();
		expect(chunks).toBeGreaterThan(0);
	});

	it("GET /api/kb/:canvas/search → 200, results array", async () => {
		const res = await api("/api/kb/empty-canvas/search?q=anything&k=4");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(Array.isArray(results)).toBe(true);
	});

	it("DELETE /api/kb/:canvas/files → 200", async () => {
		const del = await api("/api/kb/clear-test/files", { method: "DELETE" });
		expect(del.status).toBe(200);
		const { ok } = (await del.json()) as { ok: boolean };
		expect(ok).toBe(true);
	});

	it("POST /api/kb/:canvas/files → 200 for CSV", async () => {
		const csv = "topic,description\nFourier Transform,converts signal from time to frequency domain";
		const res = await api("/api/kb/csv-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/csv", "X-Filename": encodeURIComponent("topics.csv") },
			body: new TextEncoder().encode(csv)
		});
		expect(res.status).toBe(200);
		const { error } = (await res.json()) as { error?: string };
		expect(error).toBeUndefined();
	}, 60_000);

	it("POST /api/kb/:canvas/files → 200 for HTML", async () => {
		const html = "<html><body><h1>Nyquist</h1><p>Sample at twice the highest frequency.</p></body></html>";
		const res = await api("/api/kb/html-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/html", "X-Filename": encodeURIComponent("page.html") },
			body: new TextEncoder().encode(html)
		});
		expect(res.status).toBe(200);
		const { chunks } = (await res.json()) as { chunks?: number };
		expect(chunks).toBeGreaterThan(0);
	});

	it("GET /api/kb/:canvas/contents → sources + chunks", async () => {
		// Ingest first
		await api("/api/kb/contents-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("doc.txt") },
			body: new TextEncoder().encode(NOTES)
		});
		const res = await api("/api/kb/contents-test/contents");
		expect(res.status).toBe(200);
		const data = (await res.json()) as { sources: string[]; chunks: number };
		expect(data.sources).toContain("doc.txt");
		expect(data.chunks).toBeGreaterThan(0);
	});

	it("indexes and retrieves content via hybrid search", async () => {
		await api("/api/kb/it-canvas/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": "notes.txt" },
			body: new TextEncoder().encode(NOTES)
		});

		const search = await api("/api/kb/it-canvas/search?q=third+normal+form&k=4");
		const { results } = (await search.json()) as { results: string[] };
		expect(results.length).toBeGreaterThan(0);
		expect(results.join(" ").toLowerCase()).toMatch(/3nf|normal form/);
	}, 120_000);
});
