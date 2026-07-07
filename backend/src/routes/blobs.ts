// Dropped-file blobs. Bytes live on disk in ~/.arbor/blobs/<id>; mime/name in a row.
// Lets files survive restart without re-dropping. Raw bytes in/out (no base64).

import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { BLOBS_DIR } from "../paths.ts";
import { db } from "../store/db.ts";
import { blobMeta } from "../store/schema.ts";

// ids come from the webview — keep them to a single path segment.
function safeId(id: string): boolean {
	return !!id && !id.includes("/") && !id.includes("\\") && !id.includes("..");
}

/** Shared PUT body: write bytes to disk + upsert the metadata row. Used directly
 *  by server-side importers (e.g. Drive) that never see an HTTP PUT request. */
export async function writeBlob(
	id: string,
	bytes: Uint8Array,
	mime: string,
	name: string,
): Promise<void> {
	await Bun.write(join(BLOBS_DIR, id), bytes);
	db.insert(blobMeta)
		.values({ id, mime, name })
		.onConflictDoUpdate({ target: blobMeta.id, set: { mime, name } })
		.run();
}

export const blobRoutes = new Hono();

// Store bytes + metadata. Filename in X-Filename, mime in Content-Type.
blobRoutes.put("/:id", async (c) => {
	const id = c.req.param("id");
	if (!safeId(id)) return c.json({ error: "bad id" }, 400);
	const bytes = new Uint8Array(await c.req.arrayBuffer());
	const mime = c.req.header("Content-Type") ?? "application/octet-stream";
	const name = decodeURIComponent(c.req.header("X-Filename") ?? id);
	await writeBlob(id, bytes, mime, name);
	return c.json({ ok: true });
});

// Delete bytes + metadata when a file node is removed from a canvas.
blobRoutes.delete("/:id", async (c) => {
	const id = c.req.param("id");
	if (!safeId(id)) return c.json({ error: "bad id" }, 400);
	await unlink(join(BLOBS_DIR, id)).catch(() => {});
	db.delete(blobMeta).where(eq(blobMeta.id, id)).run();
	return c.json({ ok: true });
});

// Return bytes with mime + filename so the UI can reconstruct the blob.
blobRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	if (!safeId(id)) return c.json({ error: "bad id" }, 400);
	const row = db.select().from(blobMeta).where(eq(blobMeta.id, id)).get();
	const path = join(BLOBS_DIR, id);
	if (!row || !existsSync(path)) return c.json({ error: "not found" }, 404);
	const bytes = await Bun.file(path).arrayBuffer();
	return new Response(bytes, {
		headers: { "Content-Type": row.mime, "X-Filename": encodeURIComponent(row.name) },
	});
});
