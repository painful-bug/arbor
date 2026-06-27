// MIME/extension → plain text via LangChain community loaders + vision OCR fallback.
// Text-based formats (PDF with embedded text, DOCX, PPTX, CSV, EPUB) go through
// LangChain loaders. Scanned PDFs and images go through mupdf → vision LLM OCR.
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { ocrImage, pdfToImages } from "./vision.ts";

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

// OCR multiple page images in sequence (parallel floods API rate limits for large docs).
async function ocrPages(pages: Uint8Array[]): Promise<string> {
	const texts: string[] = [];
	for (const png of pages) {
		const t = await ocrImage(png);
		if (t.trim()) texts.push(t.trim());
	}
	return texts.join("\n\n---\n\n");
}

export async function loadText(filename: string, mime: string, bytes: Uint8Array): Promise<string> {
	const lower = filename.toLowerCase();

	// ── PDF ──────────────────────────────────────────────────────────────────
	if (mime === "application/pdf" || lower.endsWith(".pdf")) {
		// 1. Try text extraction first (fast, free, works for text-based PDFs).
		const { PDFLoader } = await import("@langchain/community/document_loaders/fs/pdf");
		const text = await withTempFile(".pdf", bytes, async (p) => {
			const docs = await new PDFLoader(p, { splitPages: false }).load();
			return docsToText(docs);
		});

		if (text.trim().length > 50) return text; // has real text content

		// 2. No text extracted → scanned PDF. Render pages and OCR via vision LLM.
		console.log(`[RAG] ${filename}: no text in PDF, falling back to vision OCR`);
		const pages = await pdfToImages(bytes);
		if (!pages.length) return "";
		return ocrPages(pages);
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
