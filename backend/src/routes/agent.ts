// Agent SSE endpoint. POST /api/agent/prompt streams AgentEvent objects as
// server-sent events until `done` or `error`. Cancel via POST /api/agent/:cardId/cancel.
import { Hono } from "hono";
import { handlePrompt, type PromptRequest, runs } from "../agent/run.ts";
import { HEARTBEAT_MS } from "../config.ts";

export const agentRoutes = new Hono();

agentRoutes.post("/prompt", async (c) => {
	const req = (await c.req.json()) as PromptRequest;

	const { readable, writable } = new TransformStream<Uint8Array>();
	const writer = writable.getWriter();
	const enc = new TextEncoder();

	const emit = (ev: object) => {
		// Fire-and-forget writes; errors close the stream anyway.
		writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});
	};

	// Heartbeat: SSE comment every 25s so idle timeouts don't kill a long run.
	const hb = setInterval(() => {
		// justified: a failed ping means the stream is closing; finally clears us.
		writer.write(enc.encode(": ping\n\n")).catch(() => {});
	}, HEARTBEAT_MS);

	// Run agent concurrently; close the SSE stream when it finishes.
	handlePrompt(req, emit).finally(() => {
		clearInterval(hb);
		writer.close().catch(() => {});
	});

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
});

agentRoutes.post("/:cardId/cancel", (c) => {
	const agent = runs.get(c.req.param("cardId"));
	if (agent) agent.abort();
	return c.json({ ok: true });
});
