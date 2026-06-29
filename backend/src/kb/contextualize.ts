import { eq } from "drizzle-orm";
import { db } from "../store/db.ts";
import { settings } from "../store/schema.ts";

const SERVICE = "app.arbor.canvas";
const getKey = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

interface SettingsJson {
	provider?: string;
	models?: Record<string, string>;
}

function getSettings(): SettingsJson | null {
	const row = db.select().from(settings).where(eq(settings.id, 1)).get();
	if (!row) return null;
	return JSON.parse(row.json) as SettingsJson;
}

async function chatComplete(prompt: string): Promise<string> {
	const s = getSettings();
	if (!s?.provider) return "";
	const provider = s.provider;
	const model = s.models?.[provider] ?? "";
	const apiKey = await getKey(provider);
	if (!apiKey && provider !== "ollama") return "";

	if (provider === "anthropic") {
		const res = await fetch("https://api.anthropic.com/v1/messages", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-api-key": apiKey!,
				"anthropic-version": "2023-06-01",
			},
			body: JSON.stringify({
				model: model || "claude-haiku-4-5-20251001",
				max_tokens: 200,
				messages: [{ role: "user", content: prompt }],
			}),
		});
		if (!res.ok) return "";
		const data = (await res.json()) as { content: { type: string; text: string }[] };
		return data.content.find((c) => c.type === "text")?.text ?? "";
	}

	if (provider === "google") {
		const m = model || "gemini-2.0-flash";
		const res = await fetch(
			`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
			},
		);
		if (!res.ok) return "";
		const data = (await res.json()) as {
			candidates: { content: { parts: { text?: string }[] } }[];
		};
		return data.candidates[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
	}

	// OpenAI-compatible: openai, groq, openrouter, nim, ollama
	const baseUrls: Record<string, string> = {
		openai: "https://api.openai.com/v1",
		groq: "https://api.groq.com/openai/v1",
		openrouter: "https://openrouter.ai/api/v1",
		nim: "https://integrate.api.nvidia.com/v1",
		ollama: "http://localhost:11434/v1",
	};
	const base = baseUrls[provider];
	if (!base) return "";

	const headers: Record<string, string> = { "content-type": "application/json" };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;

	const res = await fetch(`${base}/chat/completions`, {
		method: "POST",
		headers,
		body: JSON.stringify({
			model: model || "gpt-4o-mini",
			max_tokens: 200,
			messages: [{ role: "user", content: prompt }],
		}),
	});
	if (!res.ok) return "";
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? "";
}

const CONTEXT_PROMPT = (source: string, chunk: string) =>
	`You are processing a document titled "${source}". Here is a chunk from it:\n\n<chunk>\n${chunk}\n</chunk>\n\nWrite ONE short sentence (under 25 words) that situates this chunk within the document — what topic or section it belongs to. Output ONLY the sentence, nothing else.`;

export async function contextualize(
	source: string,
	chunks: string[],
): Promise<string[]> {
	const headers: string[] = new Array(chunks.length).fill("");

	const BATCH = 5;
	for (let i = 0; i < chunks.length; i += BATCH) {
		const batch = chunks.slice(i, i + BATCH);
		const results = await Promise.all(
			batch.map((chunk) =>
				chatComplete(CONTEXT_PROMPT(source, chunk.slice(0, 1500))).catch(() => ""),
			),
		);
		for (let j = 0; j < results.length; j++) {
			headers[i + j] = results[j].trim();
		}
	}

	return headers;
}
