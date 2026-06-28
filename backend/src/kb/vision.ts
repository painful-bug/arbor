// Vision-based OCR: tries tesseract (local, fast, deterministic) first, then
// falls back to cloud vision LLMs. Keys come from the same Bun.secrets store.

const SERVICE = "app.loom.canvas";
const getKey = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

// ── Tesseract OCR ─────────────────────────────────────────────────────────────
// Cache result of binary probe so we only pay it once per process.
const TESSERACT_BINS = ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "tesseract"];
let tesseractBin: string | null | undefined = undefined;

async function findTesseract(): Promise<string | null> {
	if (tesseractBin !== undefined) return tesseractBin;
	for (const bin of TESSERACT_BINS) {
		try {
			const p = Bun.spawn([bin, "--version"], { stdout: "pipe", stderr: "pipe" });
			await p.exited;
			if (p.exitCode === 0) { tesseractBin = bin; return bin; }
		} catch { /* not in this path */ }
	}
	tesseractBin = null;
	return null;
}

async function ocrTesseract(pngBytes: Uint8Array): Promise<string> {
	const bin = await findTesseract();
	if (!bin) return "";
	const { writeFile, unlink } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { randomBytes } = await import("node:crypto");
	const tmp = join(tmpdir(), `loom_ocr_${randomBytes(8).toString("hex")}.png`);
	await writeFile(tmp, pngBytes);
	try {
		const proc = Bun.spawn(
			[bin, tmp, "stdout", "--psm", "3", "--oem", "1"],
			{ stdout: "pipe", stderr: "pipe" }
		);
		const text = await new Response(proc.stdout).text();
		await proc.exited;
		return text.replace(/\f/g, "\n").trim(); // strip form-feed chars tesseract emits
	} finally {
		await unlink(tmp).catch(() => {});
	}
}

const OCR_PROMPT =
	"Extract ALL text from this image verbatim. Include every word, number, formula, and symbol you can see. Output only the extracted text — no commentary, no markdown formatting, no explanation.";

async function ocrAnthropic(pngBytes: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(pngBytes).toString("base64");
	const res = await fetch("https://api.anthropic.com/v1/messages", {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01"
		},
		body: JSON.stringify({
			model: "claude-haiku-4-5-20251001",
			max_tokens: 4096,
			messages: [
				{
					role: "user",
					content: [
						{ type: "image", source: { type: "base64", media_type: "image/png", data: b64 } },
						{ type: "text", text: OCR_PROMPT }
					]
				}
			]
		})
	});
	if (!res.ok) throw new Error(`Anthropic OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { content: { type: string; text: string }[] };
	return data.content.find((c) => c.type === "text")?.text ?? "";
}

async function ocrOpenAI(pngBytes: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(pngBytes).toString("base64");
	const res = await fetch("https://api.openai.com/v1/chat/completions", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: "gpt-4o",
			max_tokens: 4096,
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
						{ type: "text", text: OCR_PROMPT }
					]
				}
			]
		})
	});
	if (!res.ok) throw new Error(`OpenAI OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? "";
}

async function ocrGoogle(pngBytes: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(pngBytes).toString("base64");
	const res = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				contents: [
					{
						parts: [
							{ inline_data: { mime_type: "image/png", data: b64 } },
							{ text: OCR_PROMPT }
						]
					}
				]
			})
		}
	);
	if (!res.ok) throw new Error(`Google OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { candidates: { content: { parts: { text?: string }[] } }[] };
	return data.candidates[0]?.content?.parts?.find((p) => p.text)?.text ?? "";
}

async function ocrOpenRouter(pngBytes: Uint8Array, apiKey: string): Promise<string> {
	const b64 = Buffer.from(pngBytes).toString("base64");
	const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({
			model: "meta-llama/llama-3.2-11b-vision-instruct",
			max_tokens: 4096,
			messages: [
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
						{ type: "text", text: OCR_PROMPT }
					]
				}
			]
		})
	});
	if (!res.ok) throw new Error(`OpenRouter OCR ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as { choices: { message: { content: string } }[] };
	return data.choices[0]?.message?.content ?? "";
}

// OCR one PNG image. Tries tesseract first (local, deterministic, great for
// printed text), then falls back to cloud vision LLMs. Returns "" if nothing works.
export async function ocrImage(pngBytes: Uint8Array): Promise<string> {
	// 1. Tesseract: fast, offline, excellent for typed/printed text in PDFs.
	const tessText = await ocrTesseract(pngBytes).catch(() => "");
	if (tessText.trim().length > 30) return tessText;

	// 2. Cloud vision LLMs (for handwriting or if tesseract isn't installed).
	const [anthropicKey, openaiKey, googleKey, openrouterKey] = await Promise.all([
		getKey("anthropic"),
		getKey("openai"),
		getKey("google"),
		getKey("openrouter")
	]);

	if (anthropicKey) return ocrAnthropic(pngBytes, anthropicKey);
	if (openaiKey) return ocrOpenAI(pngBytes, openaiKey);
	if (googleKey) return ocrGoogle(pngBytes, googleKey);
	if (openrouterKey) return ocrOpenRouter(pngBytes, openrouterKey);

	console.warn("[KB] No vision provider key and tesseract unavailable — scanned PDF/image will not be indexed.");
	return "";
}

// True page count via mupdf. PDFLoader/pdf-parse only yields pages that carry a
// text layer, so it under-reports for scanned PDFs — use this for the OCR decision.
export async function pdfPageCount(pdfBytes: Uint8Array): Promise<number> {
	const { default: mupdf } = await import("mupdf");
	return mupdf.Document.openDocument(pdfBytes, "application/pdf").countPages();
}

// Render all pages of a PDF buffer to PNG bytes using mupdf.js (pure WASM, no native deps).
// Returns one PNG per page, scaled at 2× for OCR quality.
export async function pdfToImages(pdfBytes: Uint8Array): Promise<Uint8Array[]> {
	const { default: mupdf } = await import("mupdf");
	const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
	const count = doc.countPages();
	const pages: Uint8Array[] = [];
	const scale = mupdf.Matrix.scale(2, 2);
	// ponytail: 120-page cap is just a runaway guard; tesseract (the default OCR) is
	// local and free, so it's generous. Lower it if cloud-LLM OCR cost becomes a concern.
	for (let i = 0; i < Math.min(count, 120); i++) {
		const page = doc.loadPage(i);
		const pixmap = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
		pages.push(pixmap.asPNG());
	}
	return pages;
}
