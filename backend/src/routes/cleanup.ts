import { Hono } from "hono";
import { type ArrangeEdge, type ArrangeReqNode, arrangeCanvas } from "../cleanup/arrange.ts";

export const cleanupRoutes = new Hono();

// POST /api/cleanup/:canvas/arrange — semantic force-clustering (see
// cleanup/arrange.ts). Best-effort: always 200, returns {layout:null} on any
// failure (frontend no-ops).
cleanupRoutes.post("/:canvas/arrange", async (c) => {
	try {
		const body = await c.req.json<{ nodes: ArrangeReqNode[]; edges: ArrangeEdge[] }>();
		const layout = await arrangeCanvas(body.nodes ?? [], body.edges ?? []);
		return c.json({ layout });
	} catch {
		// justified: best-effort domain fallback — frontend treats null as "no change".
		return c.json({ layout: null });
	}
});
