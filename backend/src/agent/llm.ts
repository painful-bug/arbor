// One-shot LLM text completion — the single home for provider request/response
// shapes (moved out of kb/contextualize.ts).
import { LLM_TIMEOUT_MS } from "../config.ts";
import { badRequest } from "../errors.ts";
import { fetchJson } from "../http.ts";

/** Request for a one-shot, non-streaming text completion. */
export interface CompleteReq {
	provider: "anthropic" | "google" | "openai-compat";
	/** Overrides the provider's default API origin; REQUIRED for openai-compat. */
	baseUrl?: string;
	model: string;
	/** May be "" for keyless local providers (ollama). */
	apiKey: string;
	system?: string;
	prompt: string;
	maxTokens?: number;
	/** Constrain output to valid JSON via the provider's structured-output mode.
	 *  Small models otherwise emit malformed JSON; guided decoding prevents it. */
	json?: boolean;
}

/**
 * One-shot text completion. Returns extracted text ("" when the provider
 * returns none). Throws AppError on upstream failure (via fetchJson) or when
 * openai-compat is called without a baseUrl.
 */
export async function completeText(req: CompleteReq): Promise<string> {
	const maxTokens = req.maxTokens ?? 1024;

	if (req.provider === "anthropic") {
		const base = req.baseUrl ?? "https://api.anthropic.com";
		const data = await fetchJson<{ content: { type: string; text: string }[] }>(
			`${base}/v1/messages`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": req.apiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: req.model,
					max_tokens: maxTokens,
					...(req.system ? { system: req.system } : {}),
					messages: [{ role: "user", content: req.prompt }],
				}),
			},
			LLM_TIMEOUT_MS,
		);
		return data.content.find((c) => c.type === "text")?.text ?? "";
	}

	if (req.provider === "google") {
		const base = req.baseUrl ?? "https://generativelanguage.googleapis.com";
		const data = await fetchJson<{
			candidates: { content: { parts: { text?: string }[] } }[];
		}>(
			`${base}/v1beta/models/${req.model}:generateContent?key=${req.apiKey}`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
					contents: [{ parts: [{ text: req.prompt }] }],
					...(req.json ? { generationConfig: { responseMimeType: "application/json" } } : {}),
				}),
			},
			LLM_TIMEOUT_MS,
		);
		return data.candidates[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
	}

	// openai-compat: openai, groq, openrouter, nim, ollama — caller supplies the base URL.
	if (!req.baseUrl) throw badRequest("openai-compat completion requires baseUrl");
	const headers: Record<string, string> = { "content-type": "application/json" };
	if (req.apiKey) headers.authorization = `Bearer ${req.apiKey}`;
	const data = await fetchJson<{ choices: { message: { content: string } }[] }>(
		`${req.baseUrl}/chat/completions`,
		{
			method: "POST",
			headers,
			body: JSON.stringify({
				model: req.model,
				max_tokens: maxTokens,
				messages: [
					...(req.system ? [{ role: "system", content: req.system }] : []),
					{ role: "user", content: req.prompt },
				],
				...(req.json ? { response_format: { type: "json_object" } } : {}),
			}),
		},
		LLM_TIMEOUT_MS,
	);
	return data.choices[0]?.message?.content ?? "";
}
