// Pure alignment/distribution geometry for the multi-select context menu.
// Node measurement (width/height fallbacks) stays in Canvas.svelte; this module
// only does the arithmetic so it's testable without SvelteFlow/DOM.

export interface Box {
	id: string;
	x: number;
	y: number;
	w: number;
	h: number;
}

export type AlignOp = "left" | "right" | "top" | "bottom" | "center-h" | "center-v";

/** New {x,y} per box id for the given alignment op. No-op (empty) below 2 boxes. */
export function align(boxes: Box[], op: AlignOp): Record<string, { x: number; y: number }> {
	const out: Record<string, { x: number; y: number }> = {};
	if (boxes.length < 2) return out;

	switch (op) {
		case "left": {
			const minX = Math.min(...boxes.map((b) => b.x));
			for (const b of boxes) out[b.id] = { x: minX, y: b.y };
			break;
		}
		case "right": {
			const maxRight = Math.max(...boxes.map((b) => b.x + b.w));
			for (const b of boxes) out[b.id] = { x: maxRight - b.w, y: b.y };
			break;
		}
		case "top": {
			const minY = Math.min(...boxes.map((b) => b.y));
			for (const b of boxes) out[b.id] = { x: b.x, y: minY };
			break;
		}
		case "bottom": {
			const maxBottom = Math.max(...boxes.map((b) => b.y + b.h));
			for (const b of boxes) out[b.id] = { x: b.x, y: maxBottom - b.h };
			break;
		}
		case "center-h": {
			const avgCx = boxes.reduce((s, b) => s + b.x + b.w / 2, 0) / boxes.length;
			for (const b of boxes) out[b.id] = { x: avgCx - b.w / 2, y: b.y };
			break;
		}
		case "center-v": {
			const avgCy = boxes.reduce((s, b) => s + b.y + b.h / 2, 0) / boxes.length;
			for (const b of boxes) out[b.id] = { x: b.x, y: avgCy - b.h / 2 };
			break;
		}
	}
	return out;
}

/**
 * Equal edge-to-edge gaps along an axis; the first and last box (by position)
 * anchor the span, the rest space out evenly between them. No-op below 3 boxes.
 */
export function distribute(
	boxes: Box[],
	axis: "h" | "v",
): Record<string, { x: number; y: number }> {
	const out: Record<string, { x: number; y: number }> = {};
	if (boxes.length < 3) return out;

	const posOf = axis === "h" ? (b: Box) => b.x : (b: Box) => b.y;
	const sizeOf = axis === "h" ? (b: Box) => b.w : (b: Box) => b.h;
	const sorted = [...boxes].sort((a, b) => posOf(a) - posOf(b));
	const first = sorted[0];
	const last = sorted[sorted.length - 1];
	const totalSpan = posOf(last) + sizeOf(last) - posOf(first);
	const totalSize = sorted.reduce((s, b) => s + sizeOf(b), 0);
	const gap = (totalSpan - totalSize) / (sorted.length - 1);

	let cursor = posOf(first);
	for (const b of sorted) {
		out[b.id] = axis === "h" ? { x: cursor, y: b.y } : { x: b.x, y: cursor };
		cursor += sizeOf(b) + gap;
	}
	return out;
}
