import { describe, expect, it } from "vitest";
import { routeContextMenu, type TargetLike } from "./context-menu-route";

// Minimal DOM-free stub: a linked list of ancestors, each carrying className/dataset.
function stub(opts: {
	className?: string;
	dataset?: Record<string, string>;
	parent?: TargetLike | null;
	matches?: string[]; // selectors this exact node satisfies for `closest`
}): TargetLike {
	const { className = "", dataset = {}, parent = null, matches = [] } = opts;
	const self: TargetLike = {
		className,
		dataset,
		closest(selector: string) {
			if (matches.includes(selector)) return self;
			// naive support for the specific selectors routeContextMenu uses
			if (selector === 'input, textarea, [contenteditable="true"]') {
				if (["input", "textarea", "contenteditable"].some((s) => matches.includes(s))) return self;
				return parent?.closest(selector) ?? null;
			}
			if (selector === ".svelte-flow__node") {
				if (/(?:^|\s)svelte-flow__node-\S+/.test(className)) return self;
				return parent?.closest(selector) ?? null;
			}
			if (selector === "[data-branch-id]") {
				if (dataset.branchId) return self;
				return parent?.closest(selector) ?? null;
			}
			if (selector === ".svelte-flow__pane") {
				if (className.includes("svelte-flow__pane")) return self;
				return parent?.closest(selector) ?? null;
			}
			return parent?.closest(selector) ?? null;
		},
	};
	return self;
}

describe("routeContextMenu", () => {
	it("keeps native menu inside an input", () => {
		const el = stub({ matches: ["input"] });
		expect(routeContextMenu(el)).toEqual({ kind: "native" });
	});

	it("keeps native menu inside contenteditable", () => {
		const el = stub({ matches: ["contenteditable"] });
		expect(routeContextMenu(el)).toEqual({ kind: "native" });
	});

	it("routes a file node to kind:node with type", () => {
		const node = stub({
			className: "svelte-flow__node svelte-flow__node-file",
			dataset: { id: "n1" },
		});
		const child = stub({ parent: node });
		expect(routeContextMenu(child)).toEqual({
			kind: "node",
			nodeId: "n1",
			nodeType: "file",
			branchId: undefined,
		});
	});

	it("picks up a branch id from a nested element", () => {
		const node = stub({
			className: "svelte-flow__node svelte-flow__node-mindmap",
			dataset: { id: "n2" },
		});
		const branchRow = stub({ dataset: { branchId: "b1" }, parent: node });
		const inner = stub({ parent: branchRow });
		expect(routeContextMenu(inner)).toEqual({
			kind: "node",
			nodeId: "n2",
			nodeType: "mindmap",
			branchId: "b1",
		});
	});

	it("routes empty pane clicks", () => {
		const pane = stub({ className: "svelte-flow__pane" });
		expect(routeContextMenu(pane)).toEqual({ kind: "pane" });
	});

	it("suppresses everything else (e.g. toolbar)", () => {
		const toolbar = stub({ className: "topbar" });
		expect(routeContextMenu(toolbar)).toEqual({ kind: "suppress" });
	});

	it("suppresses a null target", () => {
		expect(routeContextMenu(null)).toEqual({ kind: "suppress" });
	});
});
