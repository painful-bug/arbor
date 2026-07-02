import { describe, expect, it } from "vitest";
import { buildCardNode, childEdge, cycleBlock, nextBlock } from "./cards";

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
