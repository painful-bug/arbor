import { describe, it, expect } from "bun:test";
import { chunkPages } from "./chunk.ts";

describe("chunkPages", () => {
	it("tags every chunk with its source page and never straddles pages", async () => {
		const pages = [
			{ page: 1, text: "Alpha content on page one. ".repeat(60) },
			{ page: 2, text: "Beta content on page two. ".repeat(60) },
		];
		const chunks = await chunkPages(pages, "doc.pdf");

		expect(chunks.length).toBeGreaterThan(1);
		expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2]));
		// A page-1 chunk holds only page-1 text and vice versa.
		for (const c of chunks) {
			if (c.page === 1) expect(c.text).not.toContain("Beta");
			if (c.page === 2) expect(c.text).not.toContain("Alpha");
		}
	});
});
