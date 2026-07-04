import { describe, expect, it } from "vitest";
import { bboxOf, bloomLocalLayout, findFreeOffset, type Rect, type TreeNode } from "./mindmap-layout";

const tree: TreeNode[] = [
	{ id: "r", parent: null },
	{ id: "a", parent: "r" },
	{ id: "b", parent: "r" },
	{ id: "a1", parent: "a" },
	{ id: "a2", parent: "a" },
];

describe("bloomLocalLayout", () => {
	it("roots at the origin and places every node", () => {
		const local = bloomLocalLayout(tree);
		expect(local.size).toBe(tree.length);
		expect(local.get("r")).toEqual({ x: 0, y: 0 });
	});
	it("returns empty when there is no root", () => {
		expect(bloomLocalLayout([{ id: "x", parent: "y" }]).size).toBe(0);
	});
});

describe("findFreeOffset", () => {
	const box = bboxOf(bloomLocalLayout(tree).values(), 320, 150);

	it("keeps the preferred anchor when it is already clear", () => {
		expect(findFreeOffset(box, [], 5000, 5000)).toEqual({ x: 5000, y: 5000 });
	});

	it("moves the bloom off an overlapping node", () => {
		// A wall of rects right where the bloom wants to sit.
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
