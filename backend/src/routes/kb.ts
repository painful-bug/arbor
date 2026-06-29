import { Hono } from "hono";
import { addFile, search, clearCanvas, contentsOf, removeFile } from "../kb/index.ts";

export const kbRoutes = new Hono();

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

kbRoutes.get("/:canvas/search", async (c) => {
	const canvas = c.req.param("canvas");
	const q = c.req.query("q") ?? "";
	const k = Math.min(Number(c.req.query("k") ?? 6), 20);
	if (!q) return c.json({ results: [] });
	const results = await search(canvas, q, k);
	return c.json({ results });
});

kbRoutes.delete("/:canvas/files/:filename", async (c) => {
	const filename = decodeURIComponent(c.req.param("filename"));
	await removeFile(c.req.param("canvas"), filename);
	return c.json({ ok: true });
});

kbRoutes.delete("/:canvas/files", async (c) => {
	await clearCanvas(c.req.param("canvas"));
	return c.json({ ok: true });
});

kbRoutes.get("/:canvas/contents", async (c) => {
	const canvas = c.req.param("canvas");
	const contents = await contentsOf(canvas);
	return c.json(contents);
});
