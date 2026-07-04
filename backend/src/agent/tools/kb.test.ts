import { describe, expect, it } from "bun:test";
import { knowledgeBaseSearchTool } from "./kb.ts";

describe("knowledgeBaseSearchTool", () => {
	it("calls search, joins chunks, and surfaces the verdict", async () => {
		let asked = "";
		const tool = knowledgeBaseSearchTool(async (q) => {
			asked = q;
			return {
				chunks: [
					{ text: "[a.pdf] alpha", score: 0.9, source: "a.pdf" },
					{ text: "[b.pdf] beta", score: 0.7, source: "b.pdf" },
				],
				verdict: "strong" as const,
			};
		});
		const res = await tool.execute("id", { query: "3nf" });
		expect(asked).toBe("3nf");
		expect(res.details.chunks).toHaveLength(2);
		expect(res.details.verdict).toBe("strong");
		const text = (res.content[0] as { text: string }).text;
		expect(text).toContain("Relevance verdict: strong");
		expect(text).toContain("[a.pdf] alpha");
		expect(text).toContain("[b.pdf] beta");
	});
	it("reports verdict none instead of inventing a path when nothing relevant", async () => {
		const tool = knowledgeBaseSearchTool(async () => ({ chunks: [], verdict: "none" }));
		const res = await tool.execute("id", { query: "missing" });
		expect((res.content[0] as { text: string }).text).toContain("verdict: none");
		expect(res.details.verdict).toBe("none");
		expect(res.details.chunks).toEqual([]);
	});
});
