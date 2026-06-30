import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";
import { addFile, addChat, search, searchGraded } from "../kb/index.ts";

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

	it("GET /search?detail=1 → results carry source + numeric score", async () => {
		const canvas = "detail-canvas";
		await api(`/api/kb/${canvas}/files`, {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": "notes.txt" },
			body: new TextEncoder().encode(NOTES)
		});
		const res = await api(`/api/kb/${canvas}/search?q=third+normal+form&k=4&detail=1`);
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: { text: string; source: string; score: number }[] };
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].source).toBe("notes.txt");
		expect(typeof results[0].score).toBe("number");
	}, 120_000);

	it("excludes other cards' chat history from topic search (no cross-card contamination)", async () => {
		const canvas = "no-chat-leak-canvas";
		// Card A's exchange happens to be lexically close to the query below —
		// this is the exact shape of the bug: a different card's raw transcript
		// must never come back as a "knowledge_base_search" hit for card B.
		await addChat(
			canvas,
			"card-a",
			"explain Roberts operator edge detection",
			"The Roberts operator uses two 2x2 kernels to compute gradient magnitude for edge detection."
		);
		await addFile(
			canvas,
			"notes.txt",
			"text/plain",
			new TextEncoder().encode(
				"Distance measures in image processing include Euclidean, City-block (Manhattan), and Chessboard distance between pixels."
			)
		);

		const results = await search(canvas, "distance measures in image processing", 6);
		expect(results.some((r) => r.includes("User:") || r.includes("Roberts operator"))).toBe(false);
		expect(results.join(" ").toLowerCase()).toMatch(/distance|euclidean|manhattan/);
	}, 60_000);

	it("reranks the most relevant chunk to the top and grades it strong", async () => {
		const canvas = "rerank-canvas";
		await addFile(
			canvas,
			"mixed.txt",
			"text/plain",
			new TextEncoder().encode(
				[
					"Sampling converts a continuous signal into discrete pixels at regular intervals.",
					"Quantization maps sampled values to a finite set of levels, e.g. 256 for 8-bit images.",
					"Distance measures in image processing include Euclidean, City-block (Manhattan), and Chessboard distance between pixels.",
					"Histogram equalization spreads pixel intensities to improve contrast.",
				].join("\n\n")
			)
		);

		const { chunks, verdict } = await searchGraded(canvas, "Manhattan and Chessboard distance between pixels", 3);
		expect(chunks.length).toBeGreaterThan(0);
		expect(chunks[0].text.toLowerCase()).toMatch(/distance|manhattan|chessboard/);
		expect(chunks[0].score).toBeGreaterThan(0.5);
		expect(verdict).toBe("strong");
	}, 120_000);

	it("POST /relate ranks the semantically related source first and excludes self", async () => {
		const canvas = "relate-canvas";
		const enc = (s: string) => new TextEncoder().encode(s);
		await addFile(canvas, "photosynthesis.txt", "text/plain", enc(
			"Photosynthesis converts sunlight, water and carbon dioxide into glucose and oxygen inside plant chloroplasts."
		));
		await addFile(canvas, "chlorophyll.txt", "text/plain", enc(
			"Chlorophyll is the green pigment in chloroplasts that absorbs light to drive photosynthesis in plants."
		));
		await addFile(canvas, "taxes.txt", "text/plain", enc(
			"Quarterly estimated tax payments are due to the IRS in April, June, September and January."
		));

		const res = await api(`/api/kb/${canvas}/relate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: "how plants use sunlight to make glucose in chloroplasts",
				exclude: "photosynthesis.txt",
				k: 3,
				minScore: 0.3,
			}),
		});
		expect(res.status).toBe(200);
		const { neighbors } = (await res.json()) as { neighbors: { source: string; score: number }[] };
		const sources = neighbors.map((n) => n.source);
		expect(sources).not.toContain("photosynthesis.txt"); // self excluded
		expect(neighbors[0]?.source).toBe("chlorophyll.txt"); // most related ranks first
	}, 120_000);

	it("grades verdict 'none' when the KB has no relevant content", async () => {
		const empty = await searchGraded("graded-empty-canvas", "anything at all", 6);
		expect(empty.chunks.length).toBe(0);
		expect(empty.verdict).toBe("none");

		const canvas = "graded-offtopic-canvas";
		await addFile(
			canvas,
			"cooking.txt",
			"text/plain",
			new TextEncoder().encode("To bake sourdough, mix flour and water, ferment the starter, then proof and bake.")
		);
		const off = await searchGraded(canvas, "quantum chromodynamics gluon confinement", 6);
		expect(off.verdict).toBe("none");
	}, 120_000);
});
