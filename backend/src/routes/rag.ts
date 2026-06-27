// RAG routes: index a file, vector search, clear canvas.
import { Hono } from "hono";
import { addFile, search, clearCanvas } from "../rag/index.ts";

export const ragRoutes = new Hono();

// Index a file for this canvas. Body = raw bytes; X-Filename + Content-Type headers.
ragRoutes.post("/:canvas/files", async (c) => {
	const canvas = c.req.param("canvas");
	const bytes = new Uint8Array(await c.req.arrayBuffer());
	const mime = c.req.header("Content-Type") ?? "application/octet-stream";
	const filename = decodeURIComponent(c.req.header("X-Filename") ?? "file");
	const chunks = await addFile(canvas, filename, mime, bytes);
	return c.json({ chunks });
});

// Vector search for a canvas.
ragRoutes.get("/:canvas/search", async (c) => {
	const canvas = c.req.param("canvas");
	const q = c.req.query("q") ?? "";
	const k = Math.min(Number(c.req.query("k") ?? 4), 20);
	if (!q) return c.json({ results: [] });
	const results = await search(canvas, q, k);
	return c.json({ results });
});

// Clear all indexed content for a canvas (e.g. canvas deleted).
ragRoutes.delete("/:canvas/files", async (c) => {
	await clearCanvas(c.req.param("canvas"));
	return c.json({ ok: true });
});
