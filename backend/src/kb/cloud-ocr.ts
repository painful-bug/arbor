// Cloud-VLM OCR fallback injected into @arbor/mosaic as `ocr.cloudOcrImage`.
// Local engines (Apple Vision, tesseract, PP-OCR ONNX) live inside the package;
// this only adds the keyed cloud providers, reading keys from Bun.secrets so they
// never leave the backend. Returns "" when no provider key is set.

const SERVICE = "app.arbor.canvas";
const getKey = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

const OCR_PROMPT =
	"Extract ALL text from this image verbatim. Include every word, number, formula, and symbol you can see. Output only the extracted text — no commentary, no markdown formatting, no explanation.";

async function ocrAnthropic(png: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(png).toString("base64");
	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
		body: JSON.stringify({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 4096,
			messages: [{ role: "user", content: [
				{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
				{ type: "text", text: OCR_PROMPT },
			] }],
		}),
	});
	if (!res.ok) throw new Error(`Anthropic OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { content: { type: string; text: string }[] };
	return data.content.find((c) => c.type === "text")?.text ?? "";
}

async function ocrOpenAI(png: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(png).toString("base64");
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: "gpt-4o",
			max_tokens: 4096,
			messages: [{ role: "user", content: [
				{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
				{ type: "text", text: OCR_PROMPT },
			] }],
		}),
	});
	if (!res.ok) throw new Error(`OpenAI OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? "";
}

async function ocrGoogle(png: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(png).toString("base64");
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ contents: [{ parts: [
				{ inline_data: { mime_type: "image/png", data: b64 } },
				{ text: OCR_PROMPT },
			] }] }),
		},
	);
	if (!res.ok) throw new Error(`Google OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { candidates: { content: { parts: { text?: string }[] } }[] };
	return data.candidates[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
}

async function ocrOpenRouter(png: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(png).toString("base64");
	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: "meta-llama/llama-3.2-11b-vision-instruct",
			max_tokens: 4096,
			messages: [{ role: "user", content: [
				{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
				{ type: "text", text: OCR_PROMPT },
			] }],
		}),
	});
	if (!res.ok) throw new Error(`OpenRouter OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? "";
}

export async function cloudOcrImage(png: Uint8Array): Promise<string> {
	const [anthropic, openai, google, openrouter] = await Promise.all([
		getKey("anthropic"), getKey("openai"), getKey("google"), getKey("openrouter"),
	]);
	if (anthropic) return ocrAnthropic(png, anthropic);
	if (openai) return ocrOpenAI(png, openai);
	if (google) return ocrGoogle(png, google);
	if (openrouter) return ocrOpenRouter(png, openrouter);
	return "";
}
