// Arbor backend. A local HTTP/SSE API that does all processing for the app.
// On startup it binds 127.0.0.1 on a free port, then prints one handshake line
// to stdout so the Tauri shell learns the {port, token} to reach it. The token
// gates /api/* so other local processes can't drive the backend.
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FIRST_PORT, HOST, SERVER_IDLE_TIMEOUT_S } from "./config.ts";
import { AppError } from "./errors.ts";
import { log } from "./log.ts";
import { ARBOR_DIR, BACKEND_HANDSHAKE_FILE } from "./paths.ts";
import { agentRoutes } from "./routes/agent.ts";
import { blobRoutes } from "./routes/blobs.ts";
import { canvasRoutes } from "./routes/canvases.ts";
import { cleanupRoutes } from "./routes/cleanup.ts";
import { fileRoutes } from "./routes/files.ts";
import { kbRoutes } from "./routes/kb.ts";
import { keyRoutes } from "./routes/keys.ts";
import { mcpRoutes } from "./routes/mcp.ts";
import { ollamaRoutes } from "./routes/ollama.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { studioRoutes } from "./routes/studio.ts";
import { importLegacyIfNeeded } from "./store/import-legacy.ts";

// Build the API. `token` is the shared secret the frontend echoes as a Bearer
// header. Routes are added here; everything under /api requires the token.
export function createApp(token: string) {
	const app = new Hono();

	// Central error boundary: AppError → its status/code, anything else → 500.
	// Response keeps the `error: string` key the frontend already reads.
	app.onError((err, c) => {
		const e = err instanceof AppError ? err : new AppError(err.message ?? "internal error");
		log.error("http", e.message);
		return c.json({ error: e.message, code: e.code }, e.status as ContentfulStatusCode);
	});

	// Liveness check — unauthenticated so the shell can probe readiness.
	app.get("/health", (c) => c.json({ ok: true }));

	// The webview origin (e.g. http://localhost:5173 or tauri://localhost) differs
	// from this backend's origin, so every /api call is cross-origin. Allow it —
	// access is already gated by the Bearer token, and we use no cookies. cors()
	// also answers the preflight OPTIONS before auth runs.
	app.use("/api/*", cors());

	app.use("/api/*", async (c, next) => {
		if (c.req.header("Authorization") !== `Bearer ${token}`) {
			return c.json({ error: "unauthorized" }, 401);
		}
		await next();
	});

	app.get("/api/ping", (c) => c.json({ ok: true }));

	app.route("/api/canvases", canvasRoutes);
	app.route("/api/settings", settingsRoutes);
	app.route("/api/blobs", blobRoutes);
	app.route("/api/kb", kbRoutes);
	app.route("/api/agent", agentRoutes);
	app.route("/api/files", fileRoutes);
	app.route("/api", keyRoutes); // /api/keys/* and /api/providers/*
	app.route("/api/ollama", ollamaRoutes);
	app.route("/api/cleanup", cleanupRoutes);
	app.route("/api/mcp", mcpRoutes);
	app.route("/api/studio", studioRoutes);

	return app;
}

// Bind the first free port at/after `first`. Bun.serve throws EADDRINUSE when a
// port is taken; we step to the next one. Throws if none free in the window.
export function serveOnFreePort(
	fetch: (req: Request) => Response | Promise<Response>,
	first = FIRST_PORT,
) {
	for (let port = first; port < first + 50; port++) {
		try {
			// Bounded idle timeout — safe for SSE: the agent stream sends 25s heartbeats
			// (routes/agent.ts) and ollama pull streams progress continuously, so an
			// active connection never goes 120s without traffic.
			const server = Bun.serve({
				hostname: HOST,
				port,
				fetch,
				idleTimeout: SERVER_IDLE_TIMEOUT_S,
			});
			return { server, port };
		} catch (e) {
			const code = (e as { code?: string }).code;
			if (code === "EADDRINUSE" || String(e).includes("EADDRINUSE")) continue;
			throw e;
		}
	}
	throw new Error(`no free port in ${first}..${first + 50}`);
}

if (import.meta.main) {
	const imported = importLegacyIfNeeded();
	if (imported) log.info("arbor", `legacy import: ${imported}`);

	const token = randomBytes(24).toString("hex");
	const app = createApp(token);
	const { port } = serveOnFreePort(app.fetch);

	// Write handshake to ~/.arbor/backend.json so the sidecar bridge can read it
	// without going through Tauri IPC (sidecar lives outside the Tauri webview).
	mkdirSync(ARBOR_DIR, { recursive: true });
	writeFileSync(BACKEND_HANDSHAKE_FILE, JSON.stringify({ port, token }));

	// Handshake line — the Tauri shell parses exactly this prefix.
	console.log(`ARBOR_BACKEND ${JSON.stringify({ port, token })}`);
}
