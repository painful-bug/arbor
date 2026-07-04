// Pure geometry for the Studio mind-map bloom: radial layout in local coords +
// a spiral free-space finder. Kept free of Svelte runes/store so it's unit-testable.

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
export interface TreeNode {
	id: string;
	parent: string | null;
}

const R1 = 360; // root → main-branch radius
const R2 = 700; // root → leaf radius
const TAU = Math.PI * 2;

// Radial 2-level bloom with the root at the origin (local coords).
// Deeper levels reuse their parent's angle — fine for the 3-6 × 2-5 trees the
// generator produces.
export function bloomLocalLayout(nodes: TreeNode[]): Map<string, XY> {
	const local = new Map<string, XY>();
	const root = nodes.find((n) => n.parent === null);
	if (!root) return local;
	const childrenOf = (pid: string) => nodes.filter((n) => n.parent === pid);
	local.set(root.id, { x: 0, y: 0 });
	const mains = childrenOf(root.id);
	mains.forEach((m, i) => {
		const ang = (i / Math.max(mains.length, 1)) * TAU - Math.PI / 2;
		local.set(m.id, { x: R1 * Math.cos(ang), y: R1 * Math.sin(ang) });
		const subs = childrenOf(m.id);
		subs.forEach((s, j) => {
			const sa = ang + (j - (subs.length - 1) / 2) * 0.4;
			local.set(s.id, { x: R2 * Math.cos(sa), y: R2 * Math.sin(sa) });
		});
	});
	return local;
}

// Bounding box of the laid-out points, each extended by one card's footprint.
export function bboxOf(points: Iterable<XY>, cardW: number, cardH: number): Box {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		minY = Math.min(minY, p.y);
		maxX = Math.max(maxX, p.x + cardW);
		maxY = Math.max(maxY, p.y + cardH);
	}
	return { minX, minY, maxX, maxY };
}

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
