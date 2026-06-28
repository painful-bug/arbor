// Knowledge-base routes: runtime control + per-canvas ingest/search/clear.
// Replaces /api/rag with /api/kb — same request/response shapes for file ingest.
import { Hono } from "hono";
import { restartGraphiti, graphitiReady } from "../kb/server-process.ts";
import { resetClient } from "../kb/mcp-client.ts";
import { addFile, search, clearCanvas, contentsOf } from "../kb/index.ts";

export const kbRoutes = new Hono();

kbRoutes.get("/status", (c) => c.json({ ready: graphitiReady() }));

// Re-read settings + restart FalkorDB/MCP. Returns once the server is healthy.
kbRoutes.post("/restart", async (c) => {
	resetClient();
	await restartGraphiti();
	return c.json({ ready: graphitiReady() });
});

// Index a file for a canvas. Body = raw bytes; X-Filename + Content-Type headers.
kbRoutes.post("/:canvas/files", async (c) => {
	const canvas = c.req.param("canvas");
	const bytes = new Uint8Array(await c.req.arrayBuffer());
	const mime = c.req.header("Content-Type") ?? "application/octet-stream";
	const filename = decodeURIComponent(c.req.header("X-Filename") ?? "file");
	try {
		const chunks = await addFile(canvas, filename, mime, bytes);
		return c.json({ chunks });
	} catch (err) {
		console.error(`[KB] addFile error [${filename}]:`, err);
		return c.json({ error: String((err as Error)?.message ?? err) }, 500);
	}
});

// Search the knowledge base for a canvas.
kbRoutes.get("/:canvas/search", async (c) => {
	const canvas = c.req.param("canvas");
	const q = c.req.query("q") ?? "";
	const k = Math.min(Number(c.req.query("k") ?? 6), 20);
	if (!q) return c.json({ results: [] });
	const results = await search(canvas, q, k);
	return c.json({ results });
});

// Clear all KB content for a canvas (Clear KB button / canvas delete).
kbRoutes.delete("/:canvas/files", async (c) => {
	await clearCanvas(c.req.param("canvas"));
	// Graphiti ingests episodes from an in-memory background queue, so any chunks
	// queued before this clear would be written to the graph *after* it — making the
	// KB look like clearing re-ingests data. Restarting the server drains that queue
	// (unprocessed episodes live only in memory; the cleared graph is already
	// persisted to FalkorDB). resetClient() drops the now-stale MCP connection.
	resetClient();
	await restartGraphiti();
	return c.json({ ok: true });
});

// Sample KB contents for a canvas — nodes and facts as text strings.
kbRoutes.get("/:canvas/contents", async (c) => {
	const canvas = c.req.param("canvas");
	const contents = await contentsOf(canvas);
	return c.json(contents);
});
