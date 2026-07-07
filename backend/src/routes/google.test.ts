// Route-level tests only exercise paths that are safe against the REAL OS
// keychain (no stored "google-oauth"/"google-client" secret in this env) —
// reading an absent secret is a harmless no-op, but writing a brand-new one
// can pop a GUI keychain prompt on macOS, which must never happen in an
// automated test run. Token-exchange/refresh/logout logic is covered with
// injected fakes in ../google/oauth.test.ts instead.
import { describe, expect, it } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { app, api } = makeTestApp("test-google-token");

describe("google routes", () => {
	it("GET /api/google/auth/status reports disconnected with nothing stored", async () => {
		const res = await api("/api/google/auth/status");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ connected: false });
	});

	it("PUT /api/google/client rejects a missing clientId", async () => {
		const res = await api("/api/google/client", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
		});
		expect(res.status).toBe(400);
	});

	it("requires the bearer token", async () => {
		const res = await app.fetch(new Request("http://localhost/api/google/auth/status"));
		expect(res.status).toBe(401);
	});

	it("POST /api/google/drive/resolve rejects a non-Drive URL", async () => {
		const res = await api("/api/google/drive/resolve", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://example.com/whatever" }),
		});
		expect(res.status).toBe(400);
	});

	it("POST /api/google/drive/resolve on a valid link fails gracefully with no Google connection", async () => {
		const res = await api("/api/google/drive/resolve", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ url: "https://drive.google.com/file/d/abc123/view" }),
		});
		expect(res.status).toBe(401);
		expect((await res.json()).code).toBe("GOOGLE_AUTH");
	});

	it("POST /api/google/drive/import streams a per-item error (not a crash) with no Google connection", async () => {
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
