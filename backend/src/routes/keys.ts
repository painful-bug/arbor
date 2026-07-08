// API keys, held in the OS keychain via Bun.secrets (built in — no native dep;
// resolves to macOS Keychain, Windows Credential Manager, or libsecret per-platform).
// The webview never reads a key back: GET reports presence only; the agent (later
// phase) injects keys server-side. Service name matches the old Rust keyring so
// previously-saved keys are found.
import { Hono } from "hono";
import { buildReq, SMALL_MODELS } from "../agent/complete.ts";
import { completeText } from "../agent/llm.ts";
import { log } from "../log.ts";

const SERVICE = "app.arbor.canvas";

// Providers that need no key (local).
const keyless = (provider: string) => provider === "ollama";

const get = (provider: string) => Bun.secrets.get({ service: SERVICE, name: provider });

export const keyRoutes = new Hono();

// Save a key. Trimmed defensively — a pasted key with a trailing newline/space
// (common from clipboard copies) would otherwise save "successfully" but fail
// every real call, which looks indistinguishable from the keystore itself being broken.
keyRoutes.put("/keys/:provider", async (c) => {
	const provider = c.req.param("provider");
	const { key } = (await c.req.json()) as { key: string };
	const trimmed = key?.trim();
	if (!trimmed) return c.json({ error: "empty key" }, 400);
	await Bun.secrets.set({ service: SERVICE, name: provider, value: trimmed });
	return c.json({ ok: true });
});

// Presence only — never returns the key itself.
keyRoutes.get("/keys/:provider", async (c) => {
	const exists = (await get(c.req.param("provider"))) != null;
	return c.json({ exists });
});

// Real check for known providers: fires a minimal live completion so a bad,
// expired, or malformed key is caught here instead of surfacing later mid-chat.
// Falls back to a presence-only check for providers with no known request shape
// (e.g. the throwaway ids used in tests) so this stays test-safe / network-free there.
keyRoutes.post("/providers/:provider/test", async (c) => {
	const provider = c.req.param("provider");
	if (keyless(provider)) return c.json({ ok: true });

	const apiKey = await get(provider);
	if (apiKey == null) return c.json({ error: `no API key saved for '${provider}'` }, 400);

	const model = SMALL_MODELS[provider];
	const req = model ? buildReq(provider, model, apiKey, "hi", 5) : null;
	if (!req) return c.json({ ok: true }); // unknown provider shape — presence is all we can check

	try {
		await completeText(req);
		return c.json({ ok: true });
	} catch (err) {
		const message = (err as Error)?.message ?? "connection test failed";
		log.warn("keys", `provider test failed for '${provider}'`, { message });
		return c.json({ error: message }, 400);
	}
});
