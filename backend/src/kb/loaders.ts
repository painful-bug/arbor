// MIME/extension → plain text via LangChain community loaders + vision OCR fallback.
// Text-based formats (PDF with embedded text, DOCX, PPTX, CSV, EPUB) go through
// LangChain loaders. Scanned PDFs and images go through mupdf → vision LLM OCR.
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ocrImage } from "./vision.ts";

function tmpPath(ext: string): string {
	return join(tmpdir(), `loom_${randomBytes(8).toString("hex")}${ext}`);
}

async function withTempFile(ext: string, bytes: Uint8Array, fn: (path: string) => Promise<string>): Promise<string> {
	const p = tmpPath(ext);
	await writeFile(p, bytes);
	try {
		return await fn(p);
	} finally {
		await unlink(p).catch(() => {});
	}
}

function docsToText(docs: { pageContent: string }[]): string {
	return docs.map((d) => d.pageContent).join("\n\n").trim();
}

const PAGE_CHAR_THRESHOLD = 100;

async function loadPdfPerPage(filename: string, pdfBytes: Uint8Array): Promise<string> {
	const { default: mupdf } = await import("mupdf");
	const doc = mupdf.Document.openDocument(pdfBytes, "application/pdf");
	const count = Math.min(doc.countPages(), 120);
	const pageTexts: string[] = [];
	const scale = mupdf.Matrix.scale(2, 2);
	let ocrCount = 0;

	for (let i = 0; i < count; i++) {
		const page = doc.loadPage(i);
		const text = page.toStructuredText("preserve-whitespace").asText();

		if (text.trim().length >= PAGE_CHAR_THRESHOLD) {
			pageTexts.push(text.trim());
		} else {
			ocrCount++;
			const pixmap = page.toPixmap(scale, mupdf.ColorSpace.DeviceRGB, false, true);
			const ocrText = await ocrImage(pixmap.asPNG());
			if (ocrText.trim()) {
				pageTexts.push(ocrText.trim());
			} else if (text.trim()) {
				pageTexts.push(text.trim());
			}
		}
	}

	if (ocrCount > 0) {
		console.log(`[KB] ${filename}: ${count - ocrCount} text pages, ${ocrCount} OCR'd pages`);
	}

	return pageTexts.join("\n\n");
}

export async function loadText(filename: string, mime: string, bytes: Uint8Array): Promise<string> {
	const lower = filename.toLowerCase();

	// ── PDF (per-page routing: text pages kept, thin/image pages OCR'd) ─────
	if (mime === "application/pdf" || lower.endsWith(".pdf")) {
		return loadPdfPerPage(filename, bytes);
	}

	// ── DOCX ─────────────────────────────────────────────────────────────────
	if (mime.includes("officedocument.wordprocessing") || lower.endsWith(".docx")) {
		const { DocxLoader } = await import("@langchain/community/document_loaders/fs/docx");
		return withTempFile(".docx", bytes, async (p) => {
			const docs = await new DocxLoader(p).load();
			return docsToText(docs);
		});
	}

	// ── PPTX ─────────────────────────────────────────────────────────────────
	if (mime.includes("officedocument.presentationml") || lower.endsWith(".pptx")) {
		const { PPTXLoader } = await import("@langchain/community/document_loaders/fs/pptx");
		return withTempFile(".pptx", bytes, async (p) => {
			const docs = await new PPTXLoader(p).load();
			return docsToText(docs);
		});
	}

	// ── CSV ───────────────────────────────────────────────────────────────────
	if (mime === "text/csv" || lower.endsWith(".csv")) {
		const { CSVLoader } = await import("@langchain/community/document_loaders/fs/csv");
		return withTempFile(".csv", bytes, async (p) => {
			const docs = await new CSVLoader(p).load();
			return docsToText(docs);
		});
	}

	// ── EPUB ──────────────────────────────────────────────────────────────────
	if (mime === "application/epub+zip" || lower.endsWith(".epub")) {
		const { EPubLoader } = await import("@langchain/community/document_loaders/fs/epub");
		return withTempFile(".epub", bytes, async (p) => {
			const docs = await new EPubLoader(p).load();
			return docsToText(docs);
		});
	}

	// ── Images → vision OCR ───────────────────────────────────────────────────
	if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(lower)) {
		// Convert to PNG for the vision API (handles JPEG, PNG, WebP, etc. via mupdf).
		// For JPEG/PNG we pass bytes directly; mupdf handles anything.
		try {
			const { default: mupdf } = await import("mupdf");
			const doc = mupdf.Document.openDocument(bytes, mime || "image/png");
			const page = doc.loadPage(0);
			const png = page.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true).asPNG();
			return ocrImage(png);
		} catch {
			// If mupdf can't open it (e.g. SVG), send raw bytes directly.
			return ocrImage(bytes);
		}
	}

	// ── HTML ──────────────────────────────────────────────────────────────────
	const text = new TextDecoder().decode(bytes);
	if (mime === "text/html" || /\.(html?|htm)$/i.test(lower)) {
		return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	}

	// ── Plain text (txt, md, json, log, …) ────────────────────────────────────
	return text;
}
