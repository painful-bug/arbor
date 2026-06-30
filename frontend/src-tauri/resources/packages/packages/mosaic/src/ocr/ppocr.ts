// PP-OCR (ONNX) text recognition — the primary, cross-platform OCR engine. Wraps
// @gutenye/ocr-node (PaddleOCR det + cls + rec ONNX models, onnxruntime-node), so
// detection + CTC decode are battle-tested rather than hand-rolled. Returns lines
// with normalized bboxes for reading order.
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { OcrLine } from "./native.ts";

type GutenLine = { text: string; mean: number; box?: number[][] };
type GutenOcr = { detect(image: string): Promise<GutenLine[]> };

let instance: Promise<GutenOcr> | undefined;

function load(): Promise<GutenOcr> {
	if (!instance) {
		instance = import("@gutenye/ocr-node").then((m) => (m.default as { create(): Promise<GutenOcr> }).create());
	}
	return instance;
}

export async function ocrPaddle(png: Uint8Array, _modelDir?: string): Promise<OcrLine[] | null> {
	const ocr = await load();
	const { default: sharp } = await import("sharp");
	const meta = await sharp(png).metadata();
	const w = meta.width ?? 1;
	const h = meta.height ?? 1;

	const p = join(tmpdir(), `mosaic_ppocr_${randomBytes(8).toString("hex")}.png`);
	await writeFile(p, png);
	try {
		const lines = await ocr.detect(p);
		return lines
			.filter((l) => l.text?.trim())
			.map((l) => {
				const xs = (l.box ?? []).map((pt) => pt[0]);
				const ys = (l.box ?? []).map((pt) => pt[1]);
				const x0 = xs.length ? Math.min(...xs) : 0;
				const y0 = ys.length ? Math.min(...ys) : 0;
				const x1 = xs.length ? Math.max(...xs) : w;
				const y1 = ys.length ? Math.max(...ys) : h;
				return {
					text: l.text.trim(),
					bbox: { x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h },
					confidence: l.mean ?? 0.8,
				};
			});
	} finally {
		await unlink(p).catch(() => {});
	}
}
