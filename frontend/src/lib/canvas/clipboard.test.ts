import type { Edge, Node } from "@xyflow/svelte";
import { describe, expect, it } from "vitest";
import { ARBOR_CLIP_MARKER, materialize, serializeSelection } from "./clipboard";

const card = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): Node => ({
	id,
	type: "card",
	position: { x, y },
	data: { title: `card ${id}`, turns: [], streaming: false, block: "lime", ...extra },
});

describe("serializeSelection", () => {
	it("positions nodes relative to the selection bounding box", () => {
		const a = card("a", 100, 200);
		const b = card("b", 300, 250);
		const payload = serializeSelection([a, b], [a, b], [], "canvas-1");
		expect(payload.marker).toBe(ARBOR_CLIP_MARKER);
		const na = payload.nodes.find((n) => n.srcId === "a")!;
		const nb = payload.nodes.find((n) => n.srcId === "b")!;
		expect(na).toMatchObject({ dx: 0, dy: 0 });
		expect(nb).toMatchObject({ dx: 200, dy: 50 });
	});

	it("drops edges that cross outside the selection", () => {
		const a = card("a", 0, 0);
		const b = card("b", 100, 0);
		const c = card("c", 200, 0); // not selected
		const edges: Edge[] = [
			{ id: "e1", source: "a", target: "b", type: "bezier" },
			{ id: "e2", source: "b", target: "c", type: "bezier" },
		];
		const payload = serializeSelection([a, b], [a, b, c], edges, "canvas-1");
		expect(payload.edges).toHaveLength(1);
		expect(payload.edges[0]).toMatchObject({ source: "a", target: "b" });
	});

	it("forces streaming:false on copied cards", () => {
		const a = card("a", 0, 0, { streaming: true });
		const payload = serializeSelection([a], [a], [], "canvas-1");
		expect(payload.nodes[0].data.streaming).toBe(false);
	});

	it("flattens a group's children to absolute positions and drops the parent link", () => {
		const group: Node = { id: "g1", type: "group", position: { x: 50, y: 50 }, data: {} };
		const child: Node = {
			id: "c1",
			type: "card",
			position: { x: 10, y: 10 },
			parentId: "g1",
			data: {},
		};
		const payload = serializeSelection([group], [group, child], [], "canvas-1");
		expect(payload.nodes).toHaveLength(2);
		const flatChild = payload.nodes.find((n) => n.srcId === "c1")!;
		// absolute position = group(50,50) + child(10,10) = (60,60); bbox min is (50,50) → dx/dy = (10,10)
		expect(flatChild.dx).toBe(10);
		expect(flatChild.dy).toBe(10);
	});

	it("filters a tag's anchor to only ids being copied", () => {
		const tag: Node = {
			id: "t1",
			type: "tag",
			position: { x: 0, y: 0 },
			data: { text: "cluster", anchor: ["a", "b", "z"] },
		};
		const a = card("a", 0, 0);
		const payload = serializeSelection([tag, a], [tag, a], [], "canvas-1");
		const tagOut = payload.nodes.find((n) => n.srcId === "t1")!;
		expect(tagOut.data.anchor).toEqual(["a"]);
	});
});

describe("materialize", () => {
	it("assigns fresh ids and places nodes at the paste origin", () => {
		const a = card("a", 100, 200);
		const b = card("b", 300, 250);
		const payload = serializeSelection([a, b], [a, b], [], "canvas-1");
		let n = 0;
		const { nodes, idMap } = materialize(payload, { x: 10, y: 20 }, () => `new${++n}`);
		expect(nodes).toHaveLength(2);
		expect(idMap.a).toBe("new1");
		expect(idMap.b).toBe("new2");
		const pa = nodes.find((nd) => nd.id === "new1")!;
		const pb = nodes.find((nd) => nd.id === "new2")!;
		expect(pa.position).toEqual({ x: 10, y: 20 });
		expect(pb.position).toEqual({ x: 210, y: 70 });
	});

	it("remaps internal edges to the new ids and drops nothing", () => {
		const a = card("a", 0, 0);
		const b = card("b", 100, 0);
		const edges: Edge[] = [{ id: "e1", source: "a", target: "b", type: "bezier" }];
		const payload = serializeSelection([a, b], [a, b], edges, "canvas-1");
		let n = 0;
		const { edges: newEdges, idMap } = materialize(payload, { x: 0, y: 0 }, () => `new${++n}`);
		expect(newEdges).toHaveLength(1);
		expect(newEdges[0].source).toBe(idMap.a);
		expect(newEdges[0].target).toBe(idMap.b);
	});

	it("remaps a tag's anchor ids through the id map", () => {
		const tag: Node = {
			id: "t1",
			type: "tag",
			position: { x: 0, y: 0 },
			data: { text: "cluster", anchor: ["a"] },
		};
		const a = card("a", 0, 0);
		const payload = serializeSelection([tag, a], [tag, a], [], "canvas-1");
		let n = 0;
		const { nodes, idMap } = materialize(payload, { x: 0, y: 0 }, () => `new${++n}`);
		const tagOut = nodes.find((nd) => nd.id === idMap.t1)!;
		expect(tagOut.data.anchor).toEqual([idMap.a]);
	});
});
