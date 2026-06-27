// Agent route tests. These don't hit a real LLM — they verify the SSE plumbing
// and graceful-degradation path (no key saved → error event, not a 500).
import { describe, it, expect } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-agent-token");

// Read all SSE events from a response body.
async function collectEvents(res: Response): Promise<{ type: string; [k: string]: unknown }[]> {
	const reader = res.body!.getReader();
	const dec = new TextDecoder();
	let buf = "";
	const events: { type: string; [k: string]: unknown }[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += dec.decode(value, { stream: true });
		const parts = buf.split("\n\n");
		buf = parts.pop()!;
		for (const part of parts) {
			const line = part.replace(/^data: /, "").trim();
			if (line) events.push(JSON.parse(line));
		}
	}
	return events;
}

describe("agent routes", () => {
	it("POST /api/agent/prompt returns SSE stream", async () => {
		const res = await api("/api/agent/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cardId: "c1",
				messages: [{ role: "user", content: "hello" }],
				provider: "anthropic",
				model: "claude-haiku-4-5-20251001"
			})
		});
		expect(res.status).toBe(200);
		expect(res.headers.get("Content-Type")).toContain("text/event-stream");

		// No API key is saved in test env, so we expect an error event (not a crash).
		const events = await collectEvents(res);
		expect(events.length).toBeGreaterThan(0);
		const last = events.at(-1)!;
		expect(last.type === "error" || last.type === "done").toBe(true);
		expect(last.id).toBe("c1");
	}, 10_000);

	it("POST /api/agent/:cardId/cancel returns ok even for unknown card", async () => {
		const res = await api("/api/agent/no-such-card/cancel", { method: "POST" });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { ok: boolean };
		expect(body.ok).toBe(true);
	});
});
