// Shared one-shot completion helper: resolves the user's configured provider +
// key (from settings + Bun.secrets) into a CompleteReq, so callers (chunk
// contextualization, studio generation) don't each re-implement the provider
// ladder. Returns null when no usable provider/key is configured.
import { eq } from "drizzle-orm";
import { log } from "../log.ts";
import { db } from "../store/db.ts";
import { settings } from "../store/schema.ts";
import { type CompleteReq, completeText } from "./llm.ts";

const SERVICE = "app.arbor.canvas";
const getKey = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

interface SettingsJson {
	providerLadder?: string[];
	provider?: string; // legacy single-provider settings
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

// Two-tier model routing: "small" = cheap hardcoded model for background
// helper tasks (cluster naming, chunk contextualization, studio generation);
// "user" = whatever the user picked in settings for that provider. Agent runs
// never go through this file — they use the frontend-supplied ladder directly.
export type Tier = "small" | "user";

export const SMALL_MODELS: Record<string, string> = {
	anthropic: "claude-haiku-4-5",
	google: "gemini-2.0-flash",
	openai: "gpt-4o-mini",
	groq: "openai/gpt-oss-20b",
	openrouter: "meta-llama/llama-3.3-70b-instruct:free",
	nim: "nvidia/nvidia-nemotron-nano-9b-v2",
	ollama: "llama3.2",
};

export function pickModel(provider: string, userModel: string | undefined, tier: Tier): string {
	if (tier === "user" && userModel) return userModel;
	return SMALL_MODELS[provider] ?? userModel ?? "";
}

function buildReq(
	provider: string,
	model: string,
	apiKey: string,
	prompt: string,
	maxTokens: number,
	system?: string,
	json?: boolean,
): CompleteReq | null {
	if (provider === "anthropic") {
		return { provider: "anthropic", model, apiKey, prompt, system, maxTokens, json };
	}
	if (provider === "google") {
		return { provider: "google", model, apiKey, prompt, system, maxTokens, json };
	}
	const baseUrl = OPENAI_COMPAT_BASES[provider];
	if (!baseUrl) return null;
	return { provider: "openai-compat", baseUrl, model, apiKey, prompt, system, maxTokens, json };
}

/**
 * Build a CompleteReq from the user's settings, or null when none is usable.
 * Walks the model ladder (same one the cards use) and takes the first provider
 * that has a usable key. Falls back to the legacy single-provider field.
 */
export async function resolveCompletion(
	prompt: string,
	maxTokens = 1024,
	system?: string,
	json?: boolean,
	tier: Tier = "small",
): Promise<CompleteReq | null> {
	const s = getSettings();
	if (!s) {
		log.warn("llm", "resolveCompletion: no settings row");
		return null;
	}
	const ladder = s.providerLadder?.length ? s.providerLadder : s.provider ? [s.provider] : [];
	if (ladder.length === 0) {
		log.warn("llm", "resolveCompletion: empty provider ladder", {
			settings: { provider: s.provider },
		});
		return null;
	}

	for (const provider of ladder) {
		const apiKey = await getKey(provider);
		if (!apiKey && provider !== "ollama") {
			log.info("llm", `resolveCompletion: skip ${provider} (no key)`);
			continue; // no key → try next rung
		}
		const model = pickModel(provider, s.models?.[provider], tier);
		const req = buildReq(provider, model, apiKey ?? "", prompt, maxTokens, system, json);
		if (req) {
			log.info("llm", "resolveCompletion: using", { provider, model: req.model });
			return req;
		}
		log.warn("llm", `resolveCompletion: ${provider} not an openai-compat provider, skipping`);
	}
	log.warn("llm", "resolveCompletion: no usable rung in ladder", { ladder });
	return null;
}

/** Resolve + run a completion in one step; "" when no provider or on empty output.
 *  Pass `json: true` to constrain the model to valid JSON (structured output). */
export async function chatComplete(
	prompt: string,
	maxTokens = 1024,
	system?: string,
	opts: { json?: boolean; tier?: Tier } = {},
): Promise<string> {
	const req = await resolveCompletion(prompt, maxTokens, system, opts.json, opts.tier ?? "small");
	if (!req) return "";
	return completeText(req);
}
