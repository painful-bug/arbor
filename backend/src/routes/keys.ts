// API keys, held in the OS keychain via Bun.secrets (built in — no native dep).
// The webview never reads a key back: GET reports presence only; the agent (later
// phase) injects keys server-side. Service name matches the old Rust keyring so
// previously-saved keys are found.
import { Hono } from "hono";

const SERVICE = "app.arbor.canvas";

// Providers that need no key (local).
const keyless = (provider: string) => provider === "ollama";

const get = (provider: string) => Bun.secrets.get({ service: SERVICE, name: provider });

export const keyRoutes = new Hono();

// Save a key.
keyRoutes.put("/keys/:provider", async (c) => {
	const provider = c.req.param("provider");
	const { key } = (await c.req.json()) as { key: string };
	if (!key) return c.json({ error: "empty key" }, 400);
	await Bun.secrets.set({ service: SERVICE, name: provider, value: key });
	return c.json({ ok: true });
});

// Presence only — never returns the key itself.
keyRoutes.get("/keys/:provider", async (c) => {
	const exists = (await get(c.req.param("provider"))) != null;
	return c.json({ exists });
});

// Lightweight check: key present (or provider keyless). Mirrors the old provider_test.
keyRoutes.post("/providers/:provider/test", async (c) => {
	const provider = c.req.param("provider");
	if (keyless(provider)) return c.json({ ok: true });
	if ((await get(provider)) != null) return c.json({ ok: true });
	return c.json({ error: `no API key saved for '${provider}'` }, 400);
});
