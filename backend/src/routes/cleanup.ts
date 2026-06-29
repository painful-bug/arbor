import { Hono } from "hono";
import { streamSimple } from "@mariozechner/pi-ai";
import { buildModel } from "../agent/providers.ts";

const SERVICE = "app.arbor.canvas";
const key = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

export const cleanupRoutes = new Hono();

interface CleanupItem {
	id: string;
	group: string;
	title: string;
	snippet: string;
}

// POST /api/cleanup/:canvas — LLM-based semantic refinement of deterministic clusters.
// Best-effort: always 200, returns {labels:{}} on any failure.
cleanupRoutes.post("/:canvas", async (c) => {
	const body = await c.req.json<{ provider: string; model: string; items: CleanupItem[] }>();
	const { provider, model, items } = body;
	if (!items?.length) return c.json({ labels: {} });

	const apiKey = await key(provider);
	if (!apiKey && provider !== "ollama") return c.json({ labels: {} });
	const effectiveKey = apiKey ?? "ollama";

	try {
		const m = buildModel(provider, model);
		const itemList = items.map((i) => `- id:${i.id} group:"${i.group}" title:"${i.title}" snippet:"${i.snippet.slice(0, 200)}"`).join("\n");

		const messages = [
			{
				role: "user" as const,
				content: `Classify these canvas items into short Title-Case categories (2-3 words).\nPrefer reusing the given group; only split when items clearly differ in kind (e.g. lecture notes vs Q&A vs research papers).\nReturn ONLY a JSON object mapping id to label, nothing else.\n\n${itemList}`,
				timestamp: Date.now(),
			},
		];

		const result = await streamSimple({
			apiKey: effectiveKey,
			model: m,
			system: "You are a classifier. Output valid JSON only. No markdown fences.",
			messages,
		});

		let text = "";
		for await (const ev of result) {
			if (ev.type === "text_delta" && ev.delta) text += ev.delta;
		}

		// Strip markdown fences if present
		text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
		const labels = JSON.parse(text) as Record<string, string>;

		// Validate shape: all keys must be known ids
		const validIds = new Set(items.map((i) => i.id));
		const validated: Record<string, string> = {};
		for (const [k, v] of Object.entries(labels)) {
			if (validIds.has(k) && typeof v === "string") validated[k] = v;
		}
		return c.json({ labels: validated });
	} catch {
		return c.json({ labels: {} });
	}
});
