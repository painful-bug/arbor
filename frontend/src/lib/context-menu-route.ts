// Pure right-click routing decision, extracted from +layout.svelte so it's
// testable without a DOM. `TargetLike` is a structural subset of Element that
// both real DOM nodes and plain-object test stubs satisfy.

export interface TargetLike {
	closest(selector: string): TargetLike | null;
	className: string;
	dataset: Record<string, string | undefined>;
}

export type MenuRoute =
	| { kind: "native" }
	| { kind: "node"; nodeId: string; nodeType: string; branchId?: string }
	| { kind: "pane" }
	| { kind: "suppress" };

const NODE_TYPE_RE = /(?:^|\s)svelte-flow__node-(\S+)/;

function nodeTypeOf(el: TargetLike): string {
	const m = NODE_TYPE_RE.exec(el.className);
	return m ? m[1] : "";
}

export function routeContextMenu(target: TargetLike | null): MenuRoute {
	if (target?.closest('input, textarea, [contenteditable="true"]')) return { kind: "native" };

	const node = target?.closest(".svelte-flow__node");
	if (node) {
		const nodeType = nodeTypeOf(node);
		const branchId = target?.closest("[data-branch-id]")?.dataset.branchId;
		return { kind: "node", nodeId: node.dataset.id ?? "", nodeType, branchId };
	}

	if (target?.closest(".svelte-flow__pane")) return { kind: "pane" };

	return { kind: "suppress" };
}
