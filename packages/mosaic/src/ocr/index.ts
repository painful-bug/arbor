// OCR fallback chain. Order: PP-OCRv5 ONNX (when implemented) → Apple Vision
// (macOS) → tesseract → injected cloud VLM. First engine that returns text wins.
// Returns normalized-bbox lines; the cloud fallback has no geometry so it yields
// a single full-page line.
import { ocrVision, ocrTesseract, type OcrLine } from "./native.ts";
import { ocrPaddle } from "./ppocr.ts";

export type { OcrLine } from "./native.ts";

export interface OcrOptions {
	modelDir?: string;
	imgWidth: number;
	imgHeight: number;
	/** Injected cloud VLM fallback (e.g. the app's Bun.secrets-keyed OCR). */
	cloudOcrImage?: (png: Uint8Array) => Promise<string>;
}

const MIN_CHARS = 8; // a real engine should beat this; below it, fall through

function joinChars(lines: OcrLine[]): number {
	return lines.reduce((n, l) => n + l.text.trim().length, 0);
}

// Quality-gated engine order. PP-OCR + DocLayout-YOLO are trained on printed docs
// and underperform Apple Vision on handwriting/mixed scans, so on macOS Vision
// leads. Off macOS (no Vision), PP-OCR ONNX leads with tesseract behind it.
function engineOrder(png: Uint8Array, opts: OcrOptions): Array<() => Promise<OcrLine[] | null>> {
	const vision = () => ocrVision(png, opts.modelDir);
	const paddle = () => ocrPaddle(png, opts.modelDir);
	const tess = () => ocrTesseract(png, opts.imgWidth, opts.imgHeight);
	return process.platform === "darwin" ? [vision, tess, paddle] : [paddle, tess, vision];
}

export async function ocrImage(png: Uint8Array, opts: OcrOptions): Promise<OcrLine[]> {
	let best: OcrLine[] = [];
	for (const engine of engineOrder(png, opts)) {
		const lines = (await engine().catch(() => null)) ?? [];
		if (joinChars(lines) >= MIN_CHARS) return lines;
		if (joinChars(lines) > joinChars(best)) best = lines;
	}

	// Injected cloud VLM (handwriting / no local engine). Text only, no bbox.
	if (opts.cloudOcrImage) {
		const text = await opts.cloudOcrImage(png).catch(() => "");
		if (text.trim().length >= MIN_CHARS) {
			return [{ text: text.trim(), bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, confidence: 0.7 }];
		}
	}
	return best;
}
