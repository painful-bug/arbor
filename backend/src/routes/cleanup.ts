import { Hono } from "hono";
import { embed } from "../kb/embeddings.ts";
import { arrange, type ArrangeEdge } from "../cleanup/arrange.ts";

export const cleanupRoutes = new Hono();

interface ArrangeReqNode {
	id: string;
	text: string;
	w: number;
	h: number;
	x: number;
	y: number;
}

// POST /api/cleanup/:canvas/arrange — semantic force-clustering. Embeds each node's
// text on the fly, blends embedding similarity with the canvas edges, and returns a
// spacing-independent layout (cluster grid + per-card offsets). The frontend turns it
// into pixel positions via place(layout, gap), so the spacing slider needs no re-embed.
// Best-effort: always 200, returns {layout:null} on any failure (frontend no-ops).
cleanupRoutes.post("/:canvas/arrange", async (c) => {
	try {
		const body = await c.req.json<{ nodes: ArrangeReqNode[]; edges: ArrangeEdge[] }>();
		const nodes = body.nodes ?? [];
		const edges = body.edges ?? [];
		if (nodes.length < 2) return c.json({ layout: null });

		// Empty-text nodes get a zero vector → no similarity links (float free, pulled
		// only by any edges + collision). One batched embed call (BGE-small, normalized).
		const dim = 384;
		const nonEmpty = nodes.filter((n) => n.text.trim());
		const vectors = nonEmpty.length ? await embed(nonEmpty.map((n) => n.text.slice(0, 512))) : [];
		const vecById = new Map<string, number[]>();
		nonEmpty.forEach((n, i) => vecById.set(n.id, vectors[i]));

		const layout = arrange(
			nodes.map((n) => ({
				id: n.id,
				vec: vecById.get(n.id) ?? new Array(dim).fill(0),
				w: n.w,
				h: n.h,
				x: n.x,
				y: n.y,
			})),
			edges,
		);
		return c.json({ layout });
	} catch {
		return c.json({ layout: null });
	}
});
