// Agent SSE endpoint. POST /api/agent/prompt streams AgentEvent objects as
// server-sent events until `done` or `error`. Cancel via POST /api/agent/:cardId/cancel.
import { Hono } from "hono";
import { handlePrompt, runs, type PromptRequest } from "../agent/run.ts";

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

	// Run agent concurrently; close the SSE stream when it finishes.
	handlePrompt(req, emit).finally(() => writer.close());

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive"
		}
	});
});

agentRoutes.post("/:cardId/cancel", (c) => {
	const agent = runs.get(c.req.param("cardId"));
	if (agent) agent.abort();
	return c.json({ ok: true });
});
