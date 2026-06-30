import { describe, it, expect } from "bun:test";
import { arrange, place, type ArrangeNode } from "./arrange.ts";

const GAP = 8;
// Run the layout and resolve it to pixel positions at the default gap.
const run = (nodes: ArrangeNode[], edges: { source: string; target: string }[] = []) =>
	place(arrange(nodes, edges), GAP);

const dist = (p: Record<string, { x: number; y: number }>, a: string, b: string) =>
	Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y);

// Two semantically tight groups (A near [1,0], B near [0,1]) + sizes for collision.
function makeNodes(): ArrangeNode[] {
	const A = ["a1", "a2", "a3"].map((id, i) => ({
		id,
		vec: [1, 0.02 * i],
		w: 300,
		h: 200,
		x: 0,
		y: i * 5,
	}));
	const B = ["b1", "b2", "b3"].map((id, i) => ({
		id,
		vec: [0.02 * i, 1],
		w: 300,
		h: 200,
		x: 50,
		y: i * 5,
	}));
	return [...A, ...B];
}

describe("arrange()", () => {
	it("places semantically similar nodes closer than dissimilar ones", () => {
		const p = run(makeNodes());
		const withinA = dist(p, "a1", "a2");
		const withinB = dist(p, "b1", "b2");
		const across = dist(p, "a1", "b1");
		expect(withinA).toBeLessThan(across);
		expect(withinB).toBeLessThan(across);
	});

	it("pulls an edge-linked cross-group pair closer than a non-linked cross pair", () => {
		const p = run(makeNodes(), [{ source: "a1", target: "b1" }]);
		expect(dist(p, "a1", "b1")).toBeLessThan(dist(p, "a2", "b2"));
	});

	it("never overlaps two cards (collision)", () => {
		const nodes = makeNodes();
		const p = run(nodes);
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i].id, b = nodes[j].id;
				const ra = Math.hypot(nodes[i].w, nodes[i].h) / 2 + 24;
				const rb = Math.hypot(nodes[j].w, nodes[j].h) / 2 + 24;
				expect(dist(p, a, b)).toBeGreaterThan((ra + rb) * 0.85);
			}
		}
	});

	// Hard guarantee: rendered rectangles never overlap — at any gap, any sizes.
	it("guarantees no two rectangles overlap (AABB, every gap)", () => {
		// Dense mixed-size scope: one big cluster of 8 + a few outliers, varied w/h.
		const nodes: ArrangeNode[] = [];
		for (let i = 0; i < 8; i++)
			nodes.push({ id: `c${i}`, vec: [1, 0.01 * i], w: 200 + i * 30, h: 140 + i * 20, x: i, y: i });
		for (let i = 0; i < 4; i++)
			nodes.push({ id: `o${i}`, vec: [0.01 * i, 1], w: 360, h: 90, x: -i, y: i });
		const layout = arrange(nodes, []);
		const wh = new Map(nodes.map((n) => [n.id, { w: n.w, h: n.h }]));
		for (const gap of [0, 8, 40]) {
			const p = place(layout, gap);
			for (let i = 0; i < nodes.length; i++) {
				for (let j = i + 1; j < nodes.length; j++) {
					const a = nodes[i].id, b = nodes[j].id;
					const sa = wh.get(a)!, sb = wh.get(b)!;
					const overlapX = Math.abs(p[a].x - p[b].x) < (sa.w + sb.w) / 2;
					const overlapY = Math.abs(p[a].y - p[b].y) < (sa.h + sb.h) / 2;
					expect(overlapX && overlapY).toBe(false);
				}
			}
		}
	});

	it("is deterministic — same input gives same output", () => {
		const p1 = run(makeNodes(), [{ source: "a1", target: "b1" }]);
		const p2 = run(makeNodes(), [{ source: "a1", target: "b1" }]);
		expect(p1).toEqual(p2);
	});

	it("widens cluster spacing as the gap grows (slider control)", () => {
		const layout = arrange(makeNodes(), []);
		const near = place(layout, 2);
		const far = place(layout, 40);
		// Clusters A and B sit in different grid cells, so a bigger gap pushes them
		// further apart…
		expect(dist(far, "a1", "b1")).toBeGreaterThan(dist(near, "a1", "b1") + 500);
		// …while members of the same cluster keep their relative arrangement.
		expect(dist(far, "a1", "a2")).toBeCloseTo(dist(near, "a1", "a2"), 0);
	});

	it("handles trivial scopes", () => {
		expect(place(arrange([], []), GAP)).toEqual({});
		const one: ArrangeNode = { id: "x", vec: [1], w: 10, h: 10, x: 7, y: 9 };
		expect(place(arrange([one], []), GAP)).toEqual({ x: { x: 7, y: 9 } });
	});
});
