import { describe, it, expect } from "bun:test";
import { reconstructAbstract, mergePapers, formatPapers, knowledgeBaseSearchTool, type Paper } from "./tools.ts";

describe("knowledgeBaseSearchTool", () => {
	it("calls search and joins chunks", async () => {
		let asked = "";
		const tool = knowledgeBaseSearchTool(async (q) => {
			asked = q;
			return ["[a.pdf] alpha", "[b.pdf] beta"];
		});
		const res = await tool.execute("id", { query: "3nf" });
		expect(asked).toBe("3nf");
		expect(res.details.chunks).toHaveLength(2);
		const text = res.content[0].text;
		expect(text).toContain("[a.pdf] alpha");
		expect(text).toContain("[b.pdf] beta");
	});
	it("reports when nothing is indexed instead of inventing a path", async () => {
		const tool = knowledgeBaseSearchTool(async () => []);
		const res = await tool.execute("id", { query: "missing" });
		expect(res.content[0].text).toContain("No results for");
		expect(res.details.chunks).toEqual([]);
	});
});

describe("reconstructAbstract", () => {
	it("rebuilds text from an inverted index", () => {
		expect(reconstructAbstract({ Deep: [0], learning: [1], works: [2] })).toBe("Deep learning works");
		expect(reconstructAbstract(undefined)).toBeUndefined();
	});
});

describe("mergePapers", () => {
	const p = (title: string, citations?: number): Paper => ({ title, authors: [], citations, url: "u" });
	it("dedupes by title and sorts by citations desc", () => {
		const out = mergePapers([p("A", 5), p("B", 10)], [p("a", 99), p("C")], 10);
		expect(out.map((x) => x.title)).toEqual(["B", "A", "C"]);
	});
});

describe("formatPapers", () => {
	it("numbers papers and includes the URL", () => {
		const out = formatPapers("q", [{ title: "T", authors: ["X"], year: 2020, url: "https://doi.org/1", citations: 3 }]);
		expect(out).toContain("[1] T");
		expect(out).toContain("https://doi.org/1");
		expect(out).toContain("cited 3");
	});
	it("handles no results", () => {
		expect(formatPapers("q", [])).toContain("No scholarly results");
	});
});
