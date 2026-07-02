import { afterAll, describe, expect, test } from "bun:test";
import { AppError } from "./errors.ts";
import { fetchJson, fetchText } from "./http.ts";

// Stub upstream: /json → 200 JSON, /text → 200 text, /fail → 503, /hang → stalls
// until released (so server.stop isn't blocked by a forever-pending handler).
let releaseHang = () => {};
const hangGate = new Promise<void>((r) => {
	releaseHang = r;
});
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(req) {
		const path = new URL(req.url).pathname;
		if (path === "/json") return Response.json({ ok: true, n: 42 });
		if (path === "/text") return new Response("plain body");
		if (path === "/fail") return new Response("nope", { status: 503 });
		await hangGate;
		return new Response("late");
	},
});
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
	releaseHang();
	server.stop(true);
});

describe("fetchJson", () => {
	test("parses JSON on 2xx", async () => {
		const data = await fetchJson<{ ok: boolean; n: number }>(`${base}/json`);
		expect(data).toEqual({ ok: true, n: 42 });
	});

	test("non-2xx throws AppError UPSTREAM", async () => {
		expect(fetchJson(`${base}/fail`)).rejects.toMatchObject({
			name: "AppError",
			status: 502,
			code: "UPSTREAM",
		});
	});

	test("timeout throws AppError UPSTREAM_TIMEOUT", async () => {
		expect(fetchJson(`${base}/hang`, undefined, 1)).rejects.toMatchObject({
			name: "AppError",
			status: 504,
			code: "UPSTREAM_TIMEOUT",
		});
	});

	test("network failure throws AppError UPSTREAM", async () => {
		// Port 1 on loopback: connection refused.
		expect(fetchJson("http://127.0.0.1:1/")).rejects.toBeInstanceOf(AppError);
	});
});

describe("fetchText", () => {
	test("returns body text on 2xx", async () => {
		expect(await fetchText(`${base}/text`)).toBe("plain body");
	});

	test("non-2xx throws AppError UPSTREAM", async () => {
		expect(fetchText(`${base}/fail`)).rejects.toMatchObject({ code: "UPSTREAM" });
	});
});
