// Local filesystem access for the desktop app (file drag-drop, open-in-editor).
// These endpoints read/write arbitrary user-chosen paths — access is gated by the
// Bearer token so only the app's own webview can call them.
import { Hono } from "hono";
import { readFile, writeFile } from "node:fs/promises";

export const fileRoutes = new Hono();

// GET /api/files/read?path=<absolute-path> → plain text
fileRoutes.get("/read", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing path" }, 400);
  try {
    const text = await readFile(path, "utf8");
    return c.text(text);
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// GET /api/files/read-bytes?path=<absolute-path> → base64 body
fileRoutes.get("/read-bytes", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing path" }, 400);
  try {
    const bytes = await readFile(path);
    return c.text(bytes.toString("base64"));
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});

// POST /api/files/write  body: {path, contents}
fileRoutes.post("/write", async (c) => {
  const { path, contents } = (await c.req.json()) as { path: string; contents: string };
  if (!path) return c.json({ error: "missing path" }, 400);
  try {
    await writeFile(path, contents, "utf8");
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: String(e) }, 500);
  }
});
