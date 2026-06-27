// App settings: one JSON blob (provider, models, workflow, toggles). Single row.
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../store/db.ts";
import { settings } from "../store/schema.ts";

export const settingsRoutes = new Hono();

// Returns the stored settings object, or null if none saved yet (UI keeps defaults).
settingsRoutes.get("/", (c) => {
	const row = db.select().from(settings).where(eq(settings.id, 1)).get();
	return c.json(row ? (JSON.parse(row.json) as unknown) : null);
});

settingsRoutes.put("/", async (c) => {
	const json = JSON.stringify(await c.req.json());
	db.insert(settings)
		.values({ id: 1, json })
		.onConflictDoUpdate({ target: settings.id, set: { json } })
		.run();
	return c.json({ ok: true });
});
