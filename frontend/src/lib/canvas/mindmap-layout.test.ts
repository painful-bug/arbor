import { describe, expect, it } from "vitest";
import { type Box, findFreeOffset, layoutTree, type Rect, type TreeItem } from "./mindmap-layout";

const box: Box = { minX: 0, minY: 0, maxX: 320, maxY: 260 };

describe("findFreeOffset", () => {
	it("keeps the preferred anchor when it is already clear", () => {
		expect(findFreeOffset(box, [], 5000, 5000)).toEqual({ x: 5000, y: 5000 });
	});

	it("moves the bloom off an overlapping node", () => {
		// A wall of rects right where the box wants to sit.
		const wall: Rect[] = [{ x1: 0, y1: -2000, x2: 6000, y2: 2000 }];
		const t = findFreeOffset(box, wall, 100, 0);
		const clear =
			box.minX + t.x - 100 >= wall[0].x2 ||
			box.maxX + t.x + 100 <= wall[0].x1 ||
			box.minY + t.y - 100 >= wall[0].y2 ||
			box.maxY + t.y + 100 <= wall[0].y1;
		expect(clear).toBe(true);
	});
});

// n0 ─┬ n1 ─┬ n3
//     │     └ n4
//     └ n2
const tree: TreeItem[] = [
	{ id: "n0", parent: null },
	{ id: "n1", parent: "n0" },
	{ id: "n2", parent: "n0" },
	{ id: "n3", parent: "n1" },
	{ id: "n4", parent: "n1" },
];
const opts = { nodeW: 100, nodeH: 20, dx: 50, dy: 10 }; // colW 150, rowH 30

describe("layoutTree", () => {
	it("collapses the whole tree to just the root when the root is not expanded", () => {
		const { pos, width, height } = layoutTree(tree, "n0", () => false, opts);
		expect([...pos.keys()]).toEqual(["n0"]);
		expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
		expect(width).toBe(100); // just the root box
		expect(height).toBe(20);
	});

	it("shows the first level when the root is expanded, hides deeper until their parent is", () => {
		const expanded = new Set(["n0"]);
		const { pos, width, height } = layoutTree(tree, "n0", (id) => expanded.has(id), opts);
		expect([...pos.keys()].sort()).toEqual(["n0", "n1", "n2"]);
		expect(pos.has("n3")).toBe(false);
		expect(pos.get("n0")!.x).toBe(0);
		expect(pos.get("n1")!.x).toBe(150); // depth 1 = one column over
		expect(width).toBe(250); // 150 + nodeW
		expect(height).toBe(50); // two leaf rows: 30 + 20
	});

	it("reveals grandchildren when their parent is expanded", () => {
		const expanded = new Set(["n0", "n1"]);
		const { pos } = layoutTree(tree, "n0", (id) => expanded.has(id), opts);
		expect([...pos.keys()].sort()).toEqual(["n0", "n1", "n2", "n3", "n4"]);
		expect(pos.get("n3")!.x).toBe(300); // depth 2
		// Parent sits vertically centered between its two children.
		const c3 = pos.get("n3")!.y + opts.nodeH / 2;
		const c4 = pos.get("n4")!.y + opts.nodeH / 2;
		expect(pos.get("n1")!.y + opts.nodeH / 2).toBe((c3 + c4) / 2);
	});

	it("handles a lone root with no children", () => {
		const { pos, width, height } = layoutTree([{ id: "n0", parent: null }], "n0", () => true, opts);
		expect([...pos.keys()]).toEqual(["n0"]);
		expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
		expect(width).toBe(100);
		expect(height).toBe(20);
	});
});
