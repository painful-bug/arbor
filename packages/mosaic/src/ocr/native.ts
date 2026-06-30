// Local OCR engines: Apple Vision (macOS, best quality, gives bbox + confidence)
// → tesseract (cross-platform, TSV gives bbox + confidence). Both shell out via
// node:child_process (no Bun APIs). bbox is normalized 0..1, top-left origin.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);

export interface OcrLine {
	text: string;
	bbox: { x0: number; y0: number; x1: number; y1: number }; // normalized 0..1, top-left
	confidence: number;
}

async function withTempPng<T>(png: Uint8Array, fn: (path: string) => Promise<T>): Promise<T> {
	const p = join(tmpdir(), `mosaic_ocr_${randomBytes(8).toString("hex")}.png`);
	await writeFile(p, png);
	try {
		return await fn(p);
	} finally {
		await unlink(p).catch(() => {});
	}
}

// ── Apple Vision (macOS) ─────────────────────────────────────────────────────
// Locate native/ocr.swift relative to this module (works from src/ and dist/).
function swiftSource(): string | null {
	const here = dirname(fileURLToPath(import.meta.url));
	for (const rel of ["../native/ocr.swift", "../../native/ocr.swift"]) {
		const p = join(here, rel);
		if (existsSync(p)) return p;
	}
	return null;
}

let visionBin: string | null | undefined;

async function findVision(modelDir?: string): Promise<string | null> {
	if (visionBin !== undefined) return visionBin;
	if (process.platform !== "darwin") return (visionBin = null);
	const binDir = join(modelDir ?? tmpdir(), "bin");
	const bin = join(binDir, "mosaic-ocr");
	if (existsSync(bin)) return (visionBin = bin);
	const src = swiftSource();
	if (!src) return (visionBin = null);
	try {
		await mkdir(binDir, { recursive: true });
		await run("swiftc", ["-O", src, "-o", bin]);
		if (existsSync(bin)) return (visionBin = bin);
	} catch {
		/* swiftc missing or compile failed */
	}
	return (visionBin = null);
}

async function ocrVision(png: Uint8Array, modelDir?: string): Promise<OcrLine[]> {
	const bin = await findVision(modelDir);
	if (!bin) return [];
	return withTempPng(png, async (p) => {
		const { stdout } = await run(bin, [p], { maxBuffer: 64 * 1024 * 1024 });
		const lines: OcrLine[] = [];
		for (const row of stdout.split("\n")) {
			const s = row.trim();
			if (!s) continue;
			try {
				const o = JSON.parse(s) as { t: string; x: number; y: number; w: number; h: number; c: number };
				// Vision origin is bottom-left → flip y to top-left.
				lines.push({
					text: o.t,
					bbox: { x0: o.x, y0: 1 - (o.y + o.h), x1: o.x + o.w, y1: 1 - o.y },
					confidence: o.c,
				});
			} catch {
				/* skip malformed line */
			}
		}
		return lines;
	});
}

// ── Tesseract ────────────────────────────────────────────────────────────────
const TESSERACT_BINS = ["/opt/homebrew/bin/tesseract", "/usr/local/bin/tesseract", "tesseract"];
let tesseractBin: string | null | undefined;

async function findTesseract(): Promise<string | null> {
	if (tesseractBin !== undefined) return tesseractBin;
	for (const bin of TESSERACT_BINS) {
		try {
			await run(bin, ["--version"]);
			return (tesseractBin = bin);
		} catch {
			/* not here */
		}
	}
	return (tesseractBin = null);
}

// TSV columns: level page block par line word left top width height conf text
function parseTsv(tsv: string, imgW: number, imgH: number): OcrLine[] {
	const byLine = new Map<string, { words: string[]; l: number; t: number; r: number; b: number; conf: number[] }>();
	for (const row of tsv.split("\n").slice(1)) {
		const c = row.split("\t");
		if (c.length < 12 || c[0] !== "5") continue; // level 5 = word
		const text = c[11]?.trim();
		if (!text) continue;
		const [left, top, w, h, conf] = [+c[6], +c[7], +c[8], +c[9], +c[10]];
		const key = `${c[2]}:${c[3]}:${c[4]}`;
		const e = byLine.get(key) ?? { words: [], l: Infinity, t: Infinity, r: 0, b: 0, conf: [] };
		e.words.push(text);
		e.l = Math.min(e.l, left);
		e.t = Math.min(e.t, top);
		e.r = Math.max(e.r, left + w);
		e.b = Math.max(e.b, top + h);
		if (conf >= 0) e.conf.push(conf);
		byLine.set(key, e);
	}
	return [...byLine.values()].map((e) => ({
		text: e.words.join(" "),
		bbox: { x0: e.l / imgW, y0: e.t / imgH, x1: e.r / imgW, y1: e.b / imgH },
		confidence: e.conf.length ? e.conf.reduce((a, b) => a + b, 0) / e.conf.length / 100 : 0.5,
	}));
}

async function ocrTesseract(png: Uint8Array, imgW: number, imgH: number): Promise<OcrLine[]> {
	const bin = await findTesseract();
	if (!bin) return [];
	return withTempPng(png, async (p) => {
		const { stdout } = await run(bin, [p, "stdout", "--psm", "3", "--oem", "1", "tsv"], {
			maxBuffer: 64 * 1024 * 1024,
		});
		return parseTsv(stdout, imgW, imgH);
	});
}

export { ocrVision, ocrTesseract };
