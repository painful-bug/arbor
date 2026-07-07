// Route-level tests inject a fake OAuthDeps (in-memory secret store + fake
// fetch) via createGoogleRoutes — never the real OS keychain. Hitting the real
// keychain is both unsafe (a first write can pop a GUI prompt) and, on a
// machine that already has a real Google account connected, actively wrong:
// these tests would silently make real Drive API calls with real user tokens.
// Token-exchange/refresh/logout logic itself is covered in ../google/oauth.test.ts.

import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../errors.ts";
import type { OAuthDeps } from "../google/oauth.ts";
import { createGoogleRoutes } from "./google.ts";

const TOKEN = "test-google-token";

function fakeDeps(overrides: Partial<OAuthDeps> = {}): OAuthDeps {
	const store = new Map<string, string>();
	return {
		fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
		secretGet: async (name) => store.get(name) ?? null,
		secretSet: async (name, value) => {
			store.set(name, value);
		},
		secretDelete: async (name) => {
			store.delete(name);
		},
		now: () => Date.now(),
		loopbackTimeoutMs: 5000,
		...overrides,
	};
}

// Mirrors server.ts's error boundary + bearer-token gate — just enough to
// exercise createGoogleRoutes() the way the real app mounts it, without
// pulling in the full createApp() (which wires the production, real-deps
// googleRoutes singleton).
function makeTestApp(deps: OAuthDeps) {
	const app = new Hono();
	app.onError((err, c) => {
		const e =
			err instanceof AppError ? err : new AppError((err as Error).message ?? "internal error");
		return c.json({ error: e.message, code: e.code }, e.status as ContentfulStatusCode);
	});
	app.use("/api/*", async (c, next) => {
		if (c.req.header("Authorization") !== `Bearer ${TOKEN}`)
			return c.json({ error: "unauthorized" }, 401);
		await next();
	});
	app.route("/api/google", createGoogleRoutes(deps));
	const api = (path: string, init?: RequestInit) =>
		app.fetch(
			new Request(`http://localhost${path}`, {
				...init,
				headers: { Authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
			}),
		);
	return { app, api };
}

describe("google routes", () => {
	it("GET /api/google/auth/status reports disconnected with nothing stored", async () => {
		const { api } = makeTestApp(fakeDeps());
		const res = await api("/api/google/auth/status");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ connected: false });
	});

	it("PUT /api/google/client rejects a missing clientId", async () => {
		const { api } = makeTestApp(fakeDeps());
		const res = await api("/api/google/client", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("requires the bearer token", async () => {
		const { app } = makeTestApp(fakeDeps());
		const res = await app.fetch(new Request("http://localhost/api/google/auth/status"));
		expect(res.status).toBe(401);
	});

	it("POST /api/google/drive/resolve rejects a non-Drive URL", async () => {
		const { api } = makeTestApp(fakeDeps());
		const res = await api("/api/google/drive/resolve", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com/whatever" }),
		});
		expect(res.status).toBe(400);
	});

	it("POST /api/google/drive/resolve on a valid link fails gracefully with no Google connection", async () => {
		const { api } = makeTestApp(fakeDeps());
		const res = await api("/api/google/drive/resolve", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://drive.google.com/file/d/abc123/view" }),
		});
		expect(res.status).toBe(401);
		expect((await res.json()).code).toBe("GOOGLE_AUTH");
	});

	it("POST /api/google/drive/import streams a per-item error (not a crash) with no Google connection", async () => {
		const { api } = makeTestApp(fakeDeps());
		const res = await api("/api/google/drive/import", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				canvas: "c1",
				items: [{ driveId: "abc", blobKey: "c1:n1", filename: "doc.txt" }],
			}),
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");
		const text = await res.text();
		const events = text
			.split("\n\n")
			.map((l) => l.replace(/^data: /, "").trim())
			.filter(Boolean)
			.map((l) => JSON.parse(l));
		expect(events[0]).toEqual({ type: "start", driveId: "abc" });
		expect(events[1]).toMatchObject({ type: "error", driveId: "abc" });
		expect(events.at(-1)).toEqual({ type: "complete" });
	});
});
