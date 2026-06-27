import { describe, expect, test } from "bun:test";
import { createApp, serveOnFreePort } from "./server.ts";

describe("auth", () => {
	const app = createApp("secret");

	test("health is open", async () => {
		const res = await app.request("/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("/api rejects missing token", async () => {
		const res = await app.request("/api/ping");
		expect(res.status).toBe(401);
	});

	test("/api accepts correct token", async () => {
		const res = await app.request("/api/ping", {
			headers: { Authorization: "Bearer secret" },
		});
		expect(res.status).toBe(200);
	});

	test("/api rejects wrong token", async () => {
		const res = await app.request("/api/ping", {
			headers: { Authorization: "Bearer nope" },
		});
		expect(res.status).toBe(401);
	});

	test("cross-origin preflight is allowed without a token", async () => {
		const res = await app.request("/api/ping", {
			method: "OPTIONS",
			headers: {
				Origin: "http://localhost:5173",
				"Access-Control-Request-Method": "GET",
				"Access-Control-Request-Headers": "authorization",
			},
		});
		expect(res.status).toBe(204);
		expect(res.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
	});
});

test("serveOnFreePort steps past a busy port", () => {
	const noop = () => new Response("ok");
	const a = serveOnFreePort(noop, 8765);
	const b = serveOnFreePort(noop, 8765); // 8765 now busy → next port
	try {
		expect(b.port).toBeGreaterThan(a.port);
	} finally {
		a.server.stop(true);
		b.server.stop(true);
	}
});
