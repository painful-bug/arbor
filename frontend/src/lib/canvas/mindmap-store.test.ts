import type { Node } from "@xyflow/svelte";
import { beforeEach, describe, expect, it } from "vitest";
import type { MindmapData, MindNode } from "./cards";
import { layoutTree } from "./mindmap-layout";
import {
	flow,
	pinMindmapBranch,
	renameMindmap,
	setMindmapExpandAll,
	toggleMindmapBranch,
} from "./store.svelte";

// n0 ─┬ n1 (Branch A) ─ n4 (Leaf A1) ─ n5 (Deep A1a)   ← 3 levels deep
//     ├ n2 (Branch B)
//     └ n3 (Branch C)
const tree: MindNode[] = [
	{ id: "n0", title: "Root", summary: "", parent: null },
	{ id: "n1", title: "Branch A", summary: "sa", parent: "n0" },
	{ id: "n2", title: "Branch B", summary: "sb", parent: "n0" },
	{ id: "n3", title: "Branch C", summary: "", parent: "n0" },
	{ id: "n4", title: "Leaf A1", summary: "la1", parent: "n1" },
	{ id: "n5", title: "Deep A1a", summary: "da", parent: "n4" },
];

const mm = (): Node => ({
	id: "mm",
	type: "mindmap",
	position: { x: 0, y: 0 },
	width: 460,
	data: {
		fileId: "f",
		source: "doc.pdf",
		nodes: tree,
		expanded: {},
		block: "mint",
	} satisfies MindmapData,
});

beforeEach(() => {
	flow.nodes = [mm()];
	flow.edges = [];
	flow.selected = null;
});

const data = () => flow.nodes.find((n) => n.id === "mm")!.data as MindmapData;

describe("setMindmapExpandAll", () => {
	it("expands every internal node (parents), not leaves", () => {
		setMindmapExpandAll("mm", true);
		const e = data().expanded;
		// n0 (root), n1, n4 are parents → expanded; n5/n2/n3 are leaves → absent.
		expect(e.n0).toBe(true);
		expect(e.n1).toBe(true);
		expect(e.n4).toBe(true);
		expect(e.n5).toBeUndefined();
		expect(e.n2).toBeUndefined();
	});

	it("collapse clears all expansion", () => {
		setMindmapExpandAll("mm", true);
		setMindmapExpandAll("mm", false);
		expect(data().expanded).toEqual({});
	});
});

describe("toggleMindmapBranch", () => {
	it("toggles a single node's children at any depth", () => {
		toggleMindmapBranch("mm", "n4");
		expect(data().expanded.n4).toBe(true);
		toggleMindmapBranch("mm", "n4");
		expect(data().expanded.n4).toBe(false);
	});

	it("collapses the whole tree to just the root when the root is toggled off", () => {
		// Root open by default (as addMindmap seeds it) → first level visible.
		flow.nodes = [{ ...mm(), data: { ...(mm().data as MindmapData), expanded: { n0: true } } }];
		const asLayout = () => layoutTree(data().nodes, "n0", (id) => !!data().expanded[id]);
		expect([...asLayout().pos.keys()].sort()).toEqual(["n0", "n1", "n2", "n3"]);
		toggleMindmapBranch("mm", "n0"); // click the root
		expect([...asLayout().pos.keys()]).toEqual(["n0"]); // whole tree collapsed
	});
});

describe("renameMindmap", () => {
	it("edits the root topic title (the card name), leaving other nodes untouched", () => {
		renameMindmap("mm", "Aerobic Respiration");
		const nodes = data().nodes;
		expect(nodes.find((n) => n.parent === null)!.title).toBe("Aerobic Respiration");
		expect(nodes.find((n) => n.id === "n1")!.title).toBe("Branch A"); // unchanged
	});
});

describe("pinMindmapBranch", () => {
	it("lifts a node + its full subtree (arbitrary depth) into a text card", () => {
		const id = pinMindmapBranch("mm", "n1");
		expect(id).not.toBeNull();
		const text = flow.nodes.find((n) => n.id === id)!.data.text as string;
		expect(text).toContain("**Branch A**");
		expect(text).toContain("sa"); // branch summary on its own line
		expect(text).toContain("- **Leaf A1** — la1"); // depth-1 child
		expect(text).toContain("- **Deep A1a** — da"); // depth-2 grandchild (recursion)
		// A new edge connects the mindmap node to the pinned card.
		expect(flow.edges.some((e) => e.source === "mm" && e.target === id)).toBe(true);
	});
});
