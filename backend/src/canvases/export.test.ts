import { describe, expect, it } from "bun:test";
import { type CanvasDoc, toMarkdown, toObsidianCanvas } from "./export.ts";

const fixture: CanvasDoc = {
	id: "c1",
	name: "Research Canvas",
	nodes: [
		{
			id: "n1",
			type: "card",
			position: { x: 0, y: 0 },
			data: { title: "Q&A", turns: [{ prompt: "What is X?", answer: "X is Y." }] },
		},
		{
			id: "n2",
			type: "text",
			position: { x: 400, y: 0 },
			data: { text: "A free-form note." },
		},
		{
			id: "n3",
			type: "web",
			position: { x: 0, y: 300 },
			data: { url: "https://example.com", title: "Example" },
		},
		{
			id: "n4",
			type: "file",
			position: { x: 400, y: 300 },
			width: 220,
			height: 280,
			data: { filename: "paper.pdf" },
		},
	],
	edges: [{ id: "e1", source: "n1", target: "n2" }],
};

describe("toMarkdown", () => {
	it("emits a section per node and a connections list", () => {
		const md = toMarkdown(fixture);
		expect(md).toContain("# Research Canvas");
		expect(md).toContain("## Q&A");
		expect(md).toContain("**You:** What is X?");
		expect(md).toContain("**AI:** X is Y.");
		expect(md).toContain("## A free-form note."); // text card title = its own content
		expect(md).toContain("[Example](https://example.com)");
		expect(md).toContain("![[paper.pdf]]");
		expect(md).toContain("## Connections");
		expect(md).toContain("Q&A → A free-form note.");
	});

	it("handles an empty canvas without throwing", () => {
		const md = toMarkdown({ id: "empty", name: "Empty", nodes: [], edges: [] });
		expect(md).toBe("# Empty\n\n");
		expect(md).not.toContain("## Connections");
	});
});

describe("toObsidianCanvas", () => {
	it("produces valid JSON Canvas 1.0 with required fields", () => {
		const parsed = JSON.parse(toObsidianCanvas(fixture)) as {
			nodes: { id: string; type: string; x: number; y: number; width: number; height: number }[];
			edges: { id: string; fromNode: string; toNode: string }[];
		};
		expect(parsed.nodes).toHaveLength(4);
		for (const n of parsed.nodes) {
			expect(n.id).toBeTruthy();
			expect(["text", "file", "link"]).toContain(n.type);
			expect(typeof n.x).toBe("number");
			expect(typeof n.y).toBe("number");
			expect(typeof n.width).toBe("number");
			expect(typeof n.height).toBe("number");
		}
		const nodeIds = new Set(parsed.nodes.map((n) => n.id));
		for (const e of parsed.edges) {
			expect(nodeIds.has(e.fromNode)).toBe(true);
			expect(nodeIds.has(e.toNode)).toBe(true);
		}
		// web card maps to link type with its url preserved
		const webNode = parsed.nodes.find((n) => n.id === "n3") as unknown as { url: string };
		expect(webNode.url).toBe("https://example.com");
	});

	it("handles an empty canvas without throwing", () => {
		const parsed = JSON.parse(
			toObsidianCanvas({ id: "empty", name: "Empty", nodes: [], edges: [] }),
		);
		expect(parsed).toEqual({ nodes: [], edges: [] });
	});
});
