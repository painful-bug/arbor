// Pure geometry for placing a mindmap node in open canvas space: a spiral
// free-space finder. Kept free of Svelte runes/store so it's unit-testable.

export interface XY {
	x: number;
	y: number;
}
export interface Rect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}
export interface Box {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

const TAU = Math.PI * 2;

// Translate the bloom so its box (+margin) clears every occupied rect. Starts at
// the preferred anchor, then spirals outward in fixed steps.
// ponytail: spiral scan, cheap for the handful of nodes a canvas holds; a real
// packing solver is overkill. Falls back to the preferred anchor if nothing clears.
export function findFreeOffset(
	box: Box,
	occupied: Rect[],
	prefX: number,
	prefY: number,
	opts: { margin?: number; step?: number; rings?: number } = {},
): XY {
	const margin = opts.margin ?? 100;
	const step = opts.step ?? 320;
	const rings = opts.rings ?? 60;
	const overlaps = (tx: number, ty: number): boolean => {
		const rx1 = box.minX + tx - margin;
		const ry1 = box.minY + ty - margin;
		const rx2 = box.maxX + tx + margin;
		const ry2 = box.maxY + ty + margin;
		return occupied.some((o) => rx1 < o.x2 && rx2 > o.x1 && ry1 < o.y2 && ry2 > o.y1);
	};
	if (!overlaps(prefX, prefY)) return { x: prefX, y: prefY };
	for (let r = 1; r <= rings; r++) {
		const samples = r * 6;
		for (let k = 0; k < samples; k++) {
			const a = (k / samples) * TAU;
			const cx = prefX + r * step * Math.cos(a);
			const cy = prefY + r * step * Math.sin(a);
			if (!overlaps(cx, cy)) return { x: cx, y: cy };
		}
	}
	return { x: prefX, y: prefY };
}

// ── Mind-map graph layout ────────────────────────────────────────────────────
// A left-to-right tidy tree over only the *visible* nodes (NotebookLM style):
// root on the left, children fan out to the right, a node's children shown only
// when `isExpanded(id)` is true — including the root, so clicking it collapses the
// whole tree. Pure + runes-free so it's unit-testable and cheap to recompute.

export interface TreeItem {
	id: string;
	parent: string | null;
}

export interface TreeLayout {
	pos: Map<string, XY>; // top-left of each visible node
	width: number;
	height: number;
}

export function layoutTree(
	nodes: TreeItem[],
	rootId: string,
	isExpanded: (id: string) => boolean,
	opts: { nodeW?: number; nodeH?: number; dx?: number; dy?: number } = {},
): TreeLayout {
	const nodeW = opts.nodeW ?? 156;
	const nodeH = opts.nodeH ?? 40;
	const colW = nodeW + (opts.dx ?? 64); // column pitch (node + edge gap)
	const rowH = nodeH + (opts.dy ?? 14); // row pitch (node + vertical gap)

	const kids = new Map<string, TreeItem[]>();
	for (const n of nodes) {
		if (n.parent === null) continue;
		(kids.get(n.parent) ?? kids.set(n.parent, []).get(n.parent)!).push(n);
	}

	const pos = new Map<string, XY>();
	let cursor = 0; // running top edge for the next leaf row
	let maxX = 0;

	// Returns the node's vertical center; positions it + its visible subtree.
	const walk = (id: string, depth: number): number => {
		const x = depth * colW;
		maxX = Math.max(maxX, x + nodeW);
		const children = isExpanded(id) ? (kids.get(id) ?? []) : [];
		if (children.length === 0) {
			const y = cursor;
			cursor += rowH;
			pos.set(id, { x, y });
			return y + nodeH / 2;
		}
		const centers = children.map((c) => walk(c.id, depth + 1));
		const cy = (centers[0] + centers[centers.length - 1]) / 2;
		pos.set(id, { x, y: cy - nodeH / 2 });
		return cy;
	};
	if (nodes.some((n) => n.id === rootId)) walk(rootId, 0);

	// Height = last leaf's bottom (cursor advanced one rowH past it).
	const height = Math.max(0, cursor - (rowH - nodeH));
	return { pos, width: maxX, height };
}
