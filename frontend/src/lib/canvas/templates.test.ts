import type { Node } from "@xyflow/svelte";
import { describe, expect, it } from "vitest";
import { CANVAS_TEMPLATES } from "./templates";

const DEFAULT_W = 320;
const DEFAULT_H = 200;

function overlaps(a: Node, b: Node): boolean {
	const aw = a.width ?? DEFAULT_W;
	const ah = a.height ?? DEFAULT_H;
	const bw = b.width ?? DEFAULT_W;
	const bh = b.height ?? DEFAULT_H;
	const noOverlapX = a.position.x + aw <= b.position.x || b.position.x + bw <= a.position.x;
	const noOverlapY = a.position.y + ah <= b.position.y || b.position.y + bh <= a.position.y;
	return !(noOverlapX || noOverlapY);
}

describe("CANVAS_TEMPLATES", () => {
	it("has exactly 3 templates", () => {
		expect(CANVAS_TEMPLATES).toHaveLength(3);
	});

	for (const t of CANVAS_TEMPLATES) {
		describe(t.id, () => {
			it("has unique node ids", () => {
				const ids = t.seed.nodes.map((n) => n.id);
				expect(new Set(ids).size).toBe(ids.length);
			});

			it("every edge references existing nodes", () => {
				const ids = new Set(t.seed.nodes.map((n) => n.id));
				for (const e of t.seed.edges) {
					expect(ids.has(e.source)).toBe(true);
					expect(ids.has(e.target)).toBe(true);
				}
			});

			it("no two nodes overlap (AABB, default 320×200 when unsized)", () => {
				const nodes = t.seed.nodes;
				for (let i = 0; i < nodes.length; i++) {
					for (let j = i + 1; j < nodes.length; j++) {
						expect(overlaps(nodes[i], nodes[j]), `${nodes[i].id} vs ${nodes[j].id}`).toBe(false);
					}
				}
			});
		});
	}
});
