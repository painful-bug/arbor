// RAG route integration tests. Tests text extraction + vector search pipeline.
// PDF/image OCR tests are skipped if no vision key is present in keychain.
import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-rag-token");

const NOTES = `
# Third Normal Form

A relation is in 3NF if it is in 2NF and no non-prime attribute is transitively
dependent on any key. This eliminates transitive dependencies in a relational schema.

# Cooking basics

To make pasta: boil salted water, cook pasta al dente, reserve some pasta water,
combine with sauce. Season to taste.
`.trim();

describe("RAG routes", () => {
	// First run downloads the BGE model (~45 MB); allow 120 s.
	it("indexes plain text and retrieves relevant chunk", async () => {
		const bytes = new TextEncoder().encode(NOTES);
		const put = await api("/api/rag/test-canvas/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("notes.txt") },
			body: bytes
		});
		expect(put.status).toBe(200);
		const { chunks } = (await put.json()) as { chunks: number };
		expect(chunks).toBeGreaterThan(0);

		const res = await api("/api/rag/test-canvas/search?q=third+normal+form&k=2");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(results.length).toBeGreaterThan(0);
		expect(results[0].toLowerCase()).toContain("3nf");
	}, 120_000);

	it("returns empty results for unknown canvas", async () => {
		const res = await api("/api/rag/empty-canvas/search?q=anything&k=4");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(results).toEqual([]);
	});

	it("clears canvas index", async () => {
		await api("/api/rag/clear-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/plain", "X-Filename": "x.txt" },
			body: new TextEncoder().encode("banana pancakes")
		});
		const del = await api("/api/rag/clear-test/files", { method: "DELETE" });
		expect(del.status).toBe(200);
		const res = await api("/api/rag/clear-test/search?q=banana&k=4");
		const { results } = (await res.json()) as { results: string[] };
		expect(results).toEqual([]);
	});

	it("indexes CSV and retrieves rows", async () => {
		const csv = "topic,description\nFourier Transform,converts signal from time to frequency domain\nEdge Detection,finds boundaries in images using gradient operators";
		const put = await api("/api/rag/csv-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/csv", "X-Filename": encodeURIComponent("topics.csv") },
			body: new TextEncoder().encode(csv)
		});
		expect(put.status).toBe(200);
		const { chunks, error } = (await put.json()) as { chunks?: number; error?: string };
		expect(error).toBeUndefined();
		expect(chunks).toBeGreaterThan(0);

		const res = await api("/api/rag/csv-test/search?q=fourier+frequency&k=2");
		expect(res.status).toBe(200);
		const { results } = (await res.json()) as { results: string[] };
		expect(results.length).toBeGreaterThan(0);
		expect(results.join(" ").toLowerCase()).toContain("fourier");
	}, 120_000);

	it("indexes markdown and retrieves content", async () => {
		const md = "# Image Processing\n\n## Convolution\nConvolution is a mathematical operation applied to images using a kernel/filter.\n\n## Histogram Equalization\nEnhances contrast by redistributing pixel intensity values.";
		const put = await api("/api/rag/md-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/markdown", "X-Filename": encodeURIComponent("notes.md") },
			body: new TextEncoder().encode(md)
		});
		expect(put.status).toBe(200);
		const { chunks } = (await put.json()) as { chunks: number };
		expect(chunks).toBeGreaterThan(0);

		const res = await api("/api/rag/md-test/search?q=convolution+kernel&k=2");
		const { results } = (await res.json()) as { results: string[] };
		expect(results.join(" ").toLowerCase()).toContain("convolution");
	}, 120_000);

	it("PDF with embedded text: extracts text and indexes it", async () => {
		// This is the smoke-test for the LangChain PDF loader.
		// We use a valid minimal PDF — even if text extraction returns 0 chunks
		// (empty page), the route must return 200 with no error field.
		// A real text-PDF would return chunks > 0; this minimal one returns 0.
		const pdfStr =
			"%PDF-1.4\n1 0 obj\n<</Type /Catalog /Pages 2 0 R>>\nendobj\n" +
			"2 0 obj\n<</Type /Pages /Kids [3 0 R] /Count 1>>\nendobj\n" +
			"3 0 obj\n<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]>>\nendobj\n" +
			"xref\n0 4\n0000000000 65535 f \ntrailer\n<</Size 4 /Root 1 0 R>>\nstartxref\n9\n%%EOF";
		const put = await api("/api/rag/pdf-text-test/files", {
			method: "POST",
			headers: { "Content-Type": "application/pdf", "X-Filename": encodeURIComponent("empty.pdf") },
			body: new TextEncoder().encode(pdfStr)
		});
		// 200 = loader ran without crashing (the pdf-parse v2 import fix is working)
		expect(put.status).toBe(200);
		const body = (await put.json()) as { chunks?: number; error?: string };
		expect(body.error).toBeUndefined();
	}, 120_000);

	it("HTML: strips tags and indexes text", async () => {
		const html = "<html><body><h1>Sampling Theorem</h1><p>The Nyquist theorem states that a signal must be sampled at twice its highest frequency.</p></body></html>";
		const put = await api("/api/rag/html-test/files", {
			method: "POST",
			headers: { "Content-Type": "text/html", "X-Filename": encodeURIComponent("page.html") },
			body: new TextEncoder().encode(html)
		});
		expect(put.status).toBe(200);
		const { chunks } = (await put.json()) as { chunks: number };
		expect(chunks).toBeGreaterThan(0);

		const res = await api("/api/rag/html-test/search?q=nyquist+sampling&k=2");
		const { results } = (await res.json()) as { results: string[] };
		expect(results.join(" ").toLowerCase()).toContain("nyquist");
	}, 120_000);

	it("re-indexes file: old chunks replaced, not duplicated", async () => {
		const v1 = "Version one content: spatial filtering techniques.";
		const v2 = "Version two content: frequency domain methods.";
		const headers = { "Content-Type": "text/plain", "X-Filename": encodeURIComponent("doc.txt") };

		await api("/api/rag/reindex-test/files", { method: "POST", headers, body: new TextEncoder().encode(v1) });
		await api("/api/rag/reindex-test/files", { method: "POST", headers, body: new TextEncoder().encode(v2) });

		// Only v2 content should be present
		const res = await api("/api/rag/reindex-test/search?q=frequency+domain&k=4");
		const { results } = (await res.json()) as { results: string[] };
		expect(results.join(" ").toLowerCase()).toContain("frequency");
		// v1 content should be gone
		expect(results.join(" ").toLowerCase()).not.toContain("spatial filtering");
	}, 120_000);
});
