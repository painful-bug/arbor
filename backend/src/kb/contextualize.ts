// Contextual chunk headers: ask the user's configured LLM for a one-sentence
// "where does this chunk sit in the document" header per chunk. Optional —
// returns empty headers when no provider/key is configured or calls fail.
import { eq } from "drizzle-orm";
import { type CompleteReq, completeText } from "../agent/llm.ts";
import { CONTEXTUALIZE_BATCH } from "../config.ts";
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

// OpenAI-compatible providers and their API bases.
const OPENAI_COMPAT_BASES: Record<string, string> = {
	openai: "https://api.openai.com/v1",
	groq: "https://api.groq.com/openai/v1",
	openrouter: "https://openrouter.ai/api/v1",
	nim: "https://integrate.api.nvidia.com/v1",
	ollama: "http://localhost:11434/v1",
};

// Build a CompleteReq from settings, or null when no usable provider/key.
async function completionReq(prompt: string): Promise<CompleteReq | null> {
	const s = getSettings();
	if (!s?.provider) return null;
	const provider = s.provider;
	const model = s.models?.[provider] ?? "";
	const apiKey = await getKey(provider);
	if (!apiKey && provider !== "ollama") return null;

	if (provider === "anthropic") {
		return {
			provider: "anthropic",
			model: model || "claude-haiku-4-5-20251001",
			apiKey: apiKey ?? "",
			prompt,
			maxTokens: 200,
		};
	}
	if (provider === "google") {
		return {
			provider: "google",
			model: model || "gemini-2.0-flash",
			apiKey: apiKey ?? "",
			prompt,
			maxTokens: 200,
		};
	}
	const baseUrl = OPENAI_COMPAT_BASES[provider];
	if (!baseUrl) return null;
	return {
		provider: "openai-compat",
		baseUrl,
		model: model || "gpt-4o-mini",
		apiKey: apiKey ?? "",
		prompt,
		maxTokens: 200,
	};
}

async function chatComplete(prompt: string): Promise<string> {
	const req = await completionReq(prompt);
	if (!req) return "";
	return completeText(req);
}

const CONTEXT_PROMPT = (source: string, chunk: string) =>
	`You are processing a document titled "${source}". Here is a chunk from it:\n\n<chunk>\n${chunk}\n</chunk>\n\nWrite ONE short sentence (under 25 words) that situates this chunk within the document — what topic or section it belongs to. Output ONLY the sentence, nothing else.`;

/** One situating header per chunk ("" where generation failed or is disabled). */
export async function contextualize(source: string, chunks: string[]): Promise<string[]> {
	const headers: string[] = new Array(chunks.length).fill("");

	for (let i = 0; i < chunks.length; i += CONTEXTUALIZE_BATCH) {
		const batch = chunks.slice(i, i + CONTEXTUALIZE_BATCH);
		const results = await Promise.all(
			batch.map((chunk) =>
				// justified: headers are best-effort — a failed call degrades to no header.
				chatComplete(CONTEXT_PROMPT(source, chunk.slice(0, 1500))).catch(() => ""),
			),
		);
		for (let j = 0; j < results.length; j++) {
			headers[i + j] = results[j].trim();
		}
	}

	return headers;
}
