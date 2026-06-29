import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const TOKEN = "test-cleanup-token";

describe("POST /api/cleanup/:canvas", () => {
	it("returns empty labels when no API key is saved", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				provider: "anthropic",
				model: "claude-sonnet-4-5",
				items: [
					{ id: "n1", group: "PDFs", title: "lecture.pdf", snippet: "intro to calculus" },
					{ id: "n2", group: "PDFs", title: "exam.pdf", snippet: "final exam questions" },
				],
			}),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { labels: Record<string, string> };
		expect(body).toHaveProperty("labels");
		expect(typeof body.labels).toBe("object");
	});

	it("returns empty labels for empty items array", async () => {
		const { api } = makeTestApp(TOKEN);
		const res = await api("/api/cleanup/default", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: "anthropic", model: "claude-sonnet-4-5", items: [] }),
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { labels: Record<string, string> };
		expect(body.labels).toEqual({});
	});
});
