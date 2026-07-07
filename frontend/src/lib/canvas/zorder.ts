// Pure z-index arithmetic for Bring to Front / Send to Back, split out of
// store.svelte.ts so it's testable without the module's $state (node vitest env).
import type { Node } from "@xyflow/svelte";

/** One above the current highest zIndex (0 if no node has one set). */
export function nextZ(nodes: Node[]): number {
	return Math.max(0, ...nodes.map((n) => n.zIndex ?? 0)) + 1;
}

/** One below the current lowest zIndex (0 if no node has one set). */
export function prevZ(nodes: Node[]): number {
	return Math.min(0, ...nodes.map((n) => n.zIndex ?? 0)) - 1;
}
