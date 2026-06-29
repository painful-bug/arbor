// Fully local OCR. Apple Vision (macOS) is primary; tesseract.js (WASM, bundled)
// is the cross-platform engine — primary on Windows/Linux, fallback on macOS.
// No network calls, no API keys.
import { mkdirSync, existsSync } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { ARBOR_DIR } from "../paths.ts";

const IS_MAC = process.platform === "darwin";

// Compiled Apple Vision helper lives in the data dir; source ships in the repo.
const OCR_BIN_DIR = join(ARBOR_DIR, "bin");
const OCR_BIN = join(OCR_BIN_DIR, "arbor-ocr");
const OCR_SWIFT = fileURLToPath(new URL("../../native/ocr.swift", import.meta.url));
// Vendored eng traineddata so tesseract.js runs offline (no CDN fetch).
const TESSDATA_DIR = fileURLToPath(new URL("../../native/tessdata", import.meta.url));

function tmpPng(): string {
	return join(tmpdir(), `arbor_ocr_${randomBytes(8).toString("hex")}.png`);
}

// Compile the Swift Vision helper once, cached in ~/.arbor/bin. Throws if swiftc absent.
async function ensureVisionBinary(): Promise<void> {
	if (existsSync(OCR_BIN)) return;
	mkdirSync(OCR_BIN_DIR, { recursive: true });
	const proc = Bun.spawn(["swiftc", OCR_SWIFT, "-O", "-o", OCR_BIN], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const code = await proc.exited;
	if (code !== 0) {
		const err = await new Response(proc.stderr).text();
		throw new Error(`swiftc failed (${code}): ${err.slice(0, 300)}`);
	}
}

async function appleVisionOCR(pngBytes: Uint8Array): Promise<string> {
	await ensureVisionBinary();
	const path = tmpPng();
	await writeFile(path, pngBytes);
	try {
		const proc = Bun.spawn([OCR_BIN, path], { stdout: "pipe", stderr: "pipe" });
		const code = await proc.exited;
		if (code !== 0) {
			const err = await new Response(proc.stderr).text();
			throw new Error(`arbor-ocr failed (${code}): ${err.slice(0, 300)}`);
		}
		return (await new Response(proc.stdout).text()).trim();
	} finally {
		await unlink(path).catch(() => {});
	}
}

// One cached tesseract.js worker, lazily created. eng only.
// ponytail: eng only; add more langs on demand.
let _worker: Promise<import("tesseract.js").Worker> | null = null;
async function tessWorker() {
	if (!_worker) {
		const { createWorker } = await import("tesseract.js");
		_worker = createWorker("eng", undefined, {
			langPath: TESSDATA_DIR,
			cacheMethod: "none",
			logger: () => {},
		});
	}
	return _worker;
}

async function tesseractOCR(pngBytes: Uint8Array): Promise<string> {
	const worker = await tessWorker();
	const { data } = await worker.recognize(Buffer.from(pngBytes));
	return data.text.trim();
}

// OCR one PNG image fully locally. macOS: Vision → tesseract.js; else tesseract.js.
export async function ocrImage(pngBytes: Uint8Array): Promise<string> {
	if (IS_MAC) {
		try {
			return await appleVisionOCR(pngBytes);
		} catch (err) {
			console.warn(`[RAG] Apple Vision OCR failed, falling back to tesseract: ${err}`);
		}
	}
	try {
		return await tesseractOCR(pngBytes);
	} catch (err) {
		console.warn(`[RAG] Tesseract OCR failed — image will not be indexed: ${err}`);
		return "";
	}
}

// Render all pages of a PDF buffer to PNG bytes using mupdf.js (pure WASM, no native deps).
// Returns one PNG per page, scaled at 2× for OCR quality.
export async function pdfToImages(pdfBytes: Uint8Array): Promise<Uint8Array[]> {
	const { default: mupdf } = await import("mupdf");
	const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
	const count = doc.countPages();
	const pages: Uint8Array[] = [];
	const scale = mupdf.Matrix.scale(2, 2);
	for (let i = 0; i < Math.min(count, 30); i++) {
		const page = doc.loadPage(i);
		const pixmap = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
		pages.push(pixmap.asPNG());
	}
	return pages;
}
