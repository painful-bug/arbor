import type { Node } from "@xyflow/svelte";
import { describe, expect, it } from "vitest";
import { buildCardNode, cardPlainText, cardTitle, childEdge, cycleBlock, nextBlock } from "./cards";

describe("buildCardNode", () => {
	it("applies per-kind frame defaults", () => {
		const pos = { x: 10, y: 20 };
		const card = buildCardNode({ kind: "card", id: "n1", position: pos, data: {} });
		expect(card).toMatchObject({ id: "n1", type: "card", position: pos, width: 400 });
		expect(card.height).toBeUndefined();

		const web = buildCardNode({ kind: "web", id: "n2", position: pos, data: {} });
		expect(web).toMatchObject({ type: "web", width: 480, height: 560 });

		const file = buildCardNode({ kind: "file", id: "n3", position: pos, data: {} });
		expect(file).toMatchObject({ type: "file", width: 220, height: 280 });

		const text = buildCardNode({ kind: "text", id: "n4", position: pos, data: {} });
		expect(text).toMatchObject({ type: "text", width: 320 });

		const tag = buildCardNode({ kind: "tag", id: "n5", position: pos, data: {} });
		expect(tag).toMatchObject({ type: "tag", width: 120 });

		const mindmap = buildCardNode({ kind: "mindmap", id: "n6", position: pos, data: {} });
		// No fixed frame — the mind-map node auto-sizes to its graph.
		expect(mindmap).toMatchObject({ type: "mindmap" });
		expect(mindmap.width).toBeUndefined();
		expect(mindmap.height).toBeUndefined();
	});

	it("passes data through untouched", () => {
		const data = { title: "t", block: "lime" };
		const n = buildCardNode({ kind: "card", id: "a", position: { x: 0, y: 0 }, data });
		expect(n.data).toBe(data);
	});
});

describe("childEdge", () => {
	it("builds a bezier edge, animated only when asked", () => {
		expect(childEdge("p", "c")).toEqual({ id: "e-p-c", source: "p", target: "c", type: "bezier" });
		expect(childEdge("p", "c", true).animated).toBe(true);
	});
});

describe("block palette", () => {
	it("nextBlock cycles through distinct pastel names", () => {
		const six = new Set([...Array(6)].map(() => nextBlock()));
		expect(six.size).toBe(6);
	});

	it("cycleBlock steps to the next color and wraps", () => {
		expect(cycleBlock("lime")).toBe("lilac");
		expect(cycleBlock("coral")).toBe("lime");
		expect(cycleBlock("not-a-block")).toBe("lime"); // indexOf -1 → first
	});
});

describe("cardTitle / cardPlainText", () => {
	const node = (type: string, data: Record<string, unknown>): Node =>
		({ id: "n", type, position: { x: 0, y: 0 }, data }) as Node;

	it("card: title from turns[0].prompt when no explicit title; text joins Q/A", () => {
		const n = node("card", { turns: [{ prompt: "What is X?", answer: "X is Y." }] });
		expect(cardTitle(n)).toBe("What is X?");
		expect(cardPlainText(n)).toBe("**You:** What is X?\n\n**AI:** X is Y.");
	});

	it("text: title truncates to 60 chars, falls back to 'Note' when empty", () => {
		expect(cardTitle(node("text", { text: "A short note." }))).toBe("A short note.");
		expect(cardTitle(node("text", { text: "" }))).toBe("Note");
		expect(cardPlainText(node("text", { text: "body" }))).toBe("body");
	});

	it("file: title is the filename; plain text is the extracted preview", () => {
		expect(cardTitle(node("file", { filename: "paper.pdf" }))).toBe("paper.pdf");
		expect(cardPlainText(node("file", { preview: "extracted text" }))).toBe("extracted text");
	});

	it("web: title prefers explicit title, falls back to url", () => {
		expect(cardTitle(node("web", { url: "https://x.com", title: "X" }))).toBe("X");
		expect(cardTitle(node("web", { url: "https://x.com" }))).toBe("https://x.com");
	});

	it("mindmap: title is the root topic; plain text is an indented outline", () => {
		const mindNodes = [
			{ id: "n0", title: "Photosynthesis", summary: "", parent: null },
			{ id: "n1", title: "Light Reactions", summary: "Happens in thylakoid.", parent: "n0" },
			{ id: "n2", title: "Chlorophyll", summary: "Absorbs light.", parent: "n1" },
		];
		const n = node("mindmap", { nodes: mindNodes });
		expect(cardTitle(n)).toBe("Photosynthesis");
		expect(cardPlainText(n)).toBe(
			"Photosynthesis\n  Light Reactions — Happens in thylakoid.\n    Chlorophyll — Absorbs light.",
		);
	});

	it("mindmap: falls back to 'Mind map' when there is no root", () => {
		expect(cardTitle(node("mindmap", { nodes: [] }))).toBe("Mind map");
		expect(cardPlainText(node("mindmap", { nodes: [] }))).toBe("");
	});
});
