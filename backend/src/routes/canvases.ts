// Canvas persistence. Mirrors the frontend's model: an ordered list of canvas
// metas + a "current" pointer (the old index.json), and one full doc per canvas.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db, metaGet, metaSet } from "../store/db.ts";
import { canvases } from "../store/schema.ts";
import { clearCanvas } from "../kb/index.ts";

// Set the current-canvas pointer and the canvas ordering. Shared with the importer.
export function setCurrentAndOrder(current: string, order: string[]): void {
	metaSet("current", current);
	metaSet("order", JSON.stringify(order));
}

function getOrder(): string[] {
	try {
		return JSON.parse(metaGet("order") ?? "[]") as string[];
	} catch {
		return [];
	}
}

export const canvasRoutes = new Hono();

// List metas (no docs) in stored order, plus the current pointer.
canvasRoutes.get("/", (c) => {
	const rows = db
		.select({
			id: canvases.id,
			name: canvases.name,
			createdAt: canvases.createdAt,
			updatedAt: canvases.updatedAt,
		})
		.from(canvases)
		.all();
	const byId = new Map(rows.map((r) => [r.id, r]));

	// Stored order first; append any rows missing from it (defensive).
	const order = getOrder();
	const list = order.map((id) => byId.get(id)).filter((r): r is (typeof rows)[number] => !!r);
	const seen = new Set(order);
	for (const r of rows) if (!seen.has(r.id)) list.push(r);

	const current = metaGet("current") ?? list[0]?.id ?? "";
	return c.json({ current, list });
});

// Update the ordering + current pointer (the old writeIndex).
canvasRoutes.put("/", async (c) => {
	const body = (await c.req.json()) as { current: string; list: { id: string }[] };
	setCurrentAndOrder(body.current, body.list.map((m) => m.id));
	return c.json({ ok: true });
});

// Full doc for one canvas.
canvasRoutes.get("/:id", (c) => {
	const row = db.select().from(canvases).where(eq(canvases.id, c.req.param("id"))).get();
	if (!row) return c.json({ error: "not found" }, 404);
	const doc = JSON.parse(row.doc) as { nodes: unknown[]; edges: unknown[]; session?: unknown[] };
	return c.json({
		id: row.id,
		name: row.name,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		nodes: doc.nodes,
		edges: doc.edges,
		session: doc.session ?? [],
	});
});

// Upsert a full doc (the old writeDoc).
canvasRoutes.put("/:id", async (c) => {
	const id = c.req.param("id");
	const b = (await c.req.json()) as {
		name: string;
		createdAt: number;
		updatedAt: number;
		nodes: unknown[];
		edges: unknown[];
		session?: unknown[];
	};
	const doc = JSON.stringify({ nodes: b.nodes ?? [], edges: b.edges ?? [], session: b.session ?? [] });
	db.insert(canvases)
		.values({ id, name: b.name, createdAt: b.createdAt, updatedAt: b.updatedAt, doc })
		.onConflictDoUpdate({
			target: canvases.id,
			set: { name: b.name, updatedAt: b.updatedAt, doc },
		})
		.run();
	return c.json({ ok: true });
});

canvasRoutes.delete("/:id", (c) => {
	const id = c.req.param("id");
	db.delete(canvases).where(eq(canvases.id, id)).run();
	metaSet("order", JSON.stringify(getOrder().filter((x) => x !== id)));
	void clearCanvas(id); // remove the canvas's KB group (fire-and-forget)
	return c.json({ ok: true });
});
