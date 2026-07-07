// Agent SSE endpoint. POST /api/agent/prompt streams AgentEvent objects as
// server-sent events until `done` or `error`. Cancel via POST /api/agent/:cardId/cancel.
import { Hono } from "hono";
import { chatComplete } from "../agent/complete.ts";
import { handlePrompt, type PromptRequest, runs } from "../agent/run.ts";
import { HEARTBEAT_MS } from "../config.ts";
import { badRequest } from "../errors.ts";

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

// One-shot in-place rewrite of a selected passage (no agent loop, no tools). Used by
// the selection popup's "Edit" action, e.g. to fix broken LaTeX. Returns the rewritten
// passage only; the frontend splices it back into the card's markdown.
agentRoutes.post("/edit-selection", async (c) => {
	const { text, instruction } = (await c.req.json()) as {
		text?: string;
		instruction?: string;
	};
	if (!text?.trim() || !instruction?.trim())
		throw badRequest("Both 'text' and 'instruction' are required.");

	const system =
		"You rewrite ONE passage of Markdown according to the user's instruction. Return ONLY the rewritten passage — no preamble, no explanation, no surrounding code fences. Preserve the surrounding Markdown/LaTeX conventions (keep $…$ and $$…$$ math, lists, and emphasis intact). When the instruction is about formatting or LaTeX, correct it without changing the meaning.";
	const prompt = `Instruction: ${instruction}\n\nPassage:\n${text}`;
	const edited = await chatComplete(prompt, 2048, system, { tier: "user" });
	if (!edited.trim()) throw badRequest("No provider is configured, or the model returned nothing.");
	return c.json({ edited: edited.trim() });
});
