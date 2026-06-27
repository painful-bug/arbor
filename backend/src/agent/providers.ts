// Provider catalog: maps a Loom provider id -> the pi-ai Model shape.
// pi-ai's `Model` is a plain object, so we build one for any model id the user
// types (pi's getModel() only accepts its built-in known ids). API key is passed
// per-call via StreamOptions.apiKey — never stored here.
import type { Api, Model } from "@mariozechner/pi-ai";

export interface ProviderDef {
	label: string;
	api: Api;
	baseUrl: string;
	defaultModel: string;
	// env var name pi-ai also recognizes, for reference/onboarding only
}

// ponytail: a flat map, not a plugin registry. Add a row to support a provider.
export const PROVIDERS: Record<string, ProviderDef> = {
	anthropic: {
		label: "Anthropic",
		api: "anthropic-messages",
		baseUrl: "https://api.anthropic.com",
		defaultModel: "claude-sonnet-4-5"
	},
	openai: {
		label: "OpenAI",
		api: "openai-completions",
		baseUrl: "https://api.openai.com/v1",
		defaultModel: "gpt-4o"
	},
	google: {
		label: "Google Gemini",
		api: "google-generative-ai",
		baseUrl: "https://generativelanguage.googleapis.com",
		defaultModel: "gemini-2.5-flash"
	},
	groq: {
		label: "Groq",
		api: "openai-completions",
		baseUrl: "https://api.groq.com/openai/v1",
		defaultModel: "openai/gpt-oss-20b"
	},
	openrouter: {
		label: "OpenRouter",
		api: "openai-completions",
		baseUrl: "https://openrouter.ai/api/v1",
		defaultModel: "meta-llama/llama-3.3-70b-instruct:free"
	},
	nim: {
		label: "NVIDIA NIM",
		api: "openai-completions",
		baseUrl: "https://integrate.api.nvidia.com/v1",
		defaultModel: "nvidia/nvidia-nemotron-nano-9b-v2"
	},
	ollama: {
		label: "Ollama (local)",
		api: "openai-completions",
		baseUrl: "http://localhost:11434/v1",
		defaultModel: "llama3.2"
	}
};

export function buildModel(provider: string, modelId: string): Model<Api> {
	const def = PROVIDERS[provider];
	if (!def) throw new Error(`unknown provider '${provider}'`);
	const id = modelId || def.defaultModel;
	return {
		id,
		name: id,
		api: def.api,
		provider,
		baseUrl: def.baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		maxTokens: 16384
	} as Model<Api>;
}
