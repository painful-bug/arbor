import { describe, expect, it } from "vitest";
import { nextZ, prevZ } from "./zorder";

const node = (id: string, zIndex?: number) =>
	({ id, position: { x: 0, y: 0 }, data: {}, zIndex }) as import("@xyflow/svelte").Node;

describe("nextZ / prevZ", () => {
	it("defaults to 1 / -1 when no node has a zIndex", () => {
		const nodes = [node("a"), node("b")];
		expect(nextZ(nodes)).toBe(1);
		expect(prevZ(nodes)).toBe(-1);
	});

	it("goes one above the current max / one below the current min", () => {
		const nodes = [node("a", 3), node("b", 7), node("c", -2)];
		expect(nextZ(nodes)).toBe(8);
		expect(prevZ(nodes)).toBe(-3);
	});

	it("handles an empty node list", () => {
		expect(nextZ([])).toBe(1);
		expect(prevZ([])).toBe(-1);
	});
});
