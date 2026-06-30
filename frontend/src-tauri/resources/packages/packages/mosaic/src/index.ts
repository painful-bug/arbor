// @arbor/mosaic — universal document understanding: bytes → MosaicDoc (AST) →
// Markdown/LaTeX. Local-first, in-process, Node-portable. Phase 2 covers native
// text (PDF text layer, DOCX, PPTX, CSV, EPUB, HTML, txt); OCR/layout/formula
// arrive in later phases without changing this public surface.

import { type Block, type MosaicDoc, type MosaicPage } from "./ast.ts";
import { parseText, parseHtml } from "./parse/text.ts";
import { parsePdf, pdfPageCount } from "./parse/pdf.ts";
import { parseDocx, parsePptx, parseCsv, parseEpub } from "./parse/office.ts";
import { ocrImage } from "./ocr/index.ts";
import { detectLayout } from "./ocr/layout.ts";

export { toMarkdown } from "./markdown.ts";
export { blocksInOrder, plainText } from "./ast.ts";
export type { Block, BlockType, BBox, Method, MosaicDoc, MosaicPage } from "./ast.ts";

export interface ExtractOptions {
	filename?: string;
	mime?: string;
	/** Where ONNX models cache (app passes ~/.arbor/models). Used by OCR phases. */
	modelDir?: string;
	/** Cap total pages parsed. */
	maxPages?: number;
	/** 1-based inclusive page range, e.g. "1-10" or "5". */
	pages?: string;
	ocr?: {
		cloudOcrImage?: (png: Uint8Array) => Promise<string>;
	};
	onProgress?: (p: { page: number; total: number }) => void;
}

const MIME_BY_EXT: Record<string, string> = {
	pdf: "application/pdf",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	csv: "text/csv",
	epub: "application/epub+zip",
	html: "text/html",
	htm: "text/html",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	tiff: "image/tiff",
	tif: "image/tiff",
	bmp: "image/bmp",
};

function guessMime(filename: string): string {
	const ext = filename.toLowerCase().split(".").pop() ?? "";
	return MIME_BY_EXT[ext] ?? "text/plain";
}

/** Resolve a 1-based "start-end" range string against a total into [start, end) 0-based. */
function resolveRange(total: number, pages?: string, maxPages?: number): [number, number] {
	let start = 0;
	let end = total;
	if (pages) {
		const m = pages.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
		if (m) {
			start = Math.max(0, parseInt(m[1], 10) - 1);
			end = m[2] ? parseInt(m[2], 10) : start + 1;
		}
	}
	end = Math.min(end, total);
	if (maxPages != null) end = Math.min(end, start + maxPages);
	return [start, Math.max(start, end)];
}

/** Group flat blocks into pages, sort by page, assign global reading order. */
function assemble(
	filename: string,
	mime: string,
	blocks: Block[],
	dims?: Map<number, { width: number; height: number }>,
): MosaicDoc {
	const byPage = new Map<number, Block[]>();
	for (const b of blocks) {
		const list = byPage.get(b.page) ?? [];
		list.push(b);
		byPage.set(b.page, list);
	}
	let order = 0;
	const pages: MosaicPage[] = [...byPage.keys()]
		.sort((a, b) => a - b)
		.map((n) => {
			const blks = byPage.get(n)!;
			for (const b of blks) b.readingOrder = order++;
			const d = dims?.get(n);
			return { number: n, blocks: blks, width: d?.width, height: d?.height };
		});
	return { filename, mime, pages };
}

export async function extract(bytes: Uint8Array, opts: ExtractOptions = {}): Promise<MosaicDoc> {
	const filename = opts.filename ?? "document";
	const mime = opts.mime ?? guessMime(filename);
	const lower = filename.toLowerCase();

	if (mime === "application/pdf" || lower.endsWith(".pdf")) {
		const total = await pdfPageCount(bytes);
		const range = resolveRange(total, opts.pages, opts.maxPages);
		const ocr = (png: Uint8Array, img: { width: number; height: number }) =>
			ocrImage(png, {
				modelDir: opts.modelDir,
				imgWidth: img.width,
				imgHeight: img.height,
				cloudOcrImage: opts.ocr?.cloudOcrImage,
			});
		// Region routing helps printed multi-column docs (PP-OCR path). On macOS
		// Apple Vision already returns clean ordered full-page text, and DocLayout-YOLO
		// mis-segments handwriting, so skip cropping there. (Phase 4 adds formula/table
		// region extraction on top of the macOS full-page text.)
		const layout = process.platform === "darwin" ? undefined : (png: Uint8Array) => detectLayout(png, opts.modelDir);
		const { blocks, dims } = await parsePdf(bytes, range, { ocr, layout, onProgress: opts.onProgress });
		return assemble(filename, mime, blocks, dims);
	}
	if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) {
		return assemble(filename, mime, await parseDocx(bytes));
	}
	if (mime.includes("presentationml") || lower.endsWith(".pptx")) {
		return assemble(filename, mime, await parsePptx(bytes));
	}
	if (mime === "text/csv" || lower.endsWith(".csv")) {
		return assemble(filename, mime, await parseCsv(bytes));
	}
	if (mime === "application/epub+zip" || lower.endsWith(".epub")) {
		return assemble(filename, mime, await parseEpub(bytes));
	}

	if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(lower)) {
		const blocks = await ocrImageFile(bytes, mime, opts);
		return assemble(filename, mime, blocks);
	}

	const text = new TextDecoder().decode(bytes);
	if (mime === "text/html" || /\.(html?|htm)$/i.test(lower)) {
		return assemble(filename, mime, parseHtml(text));
	}
	return assemble(filename, "text/plain", parseText(text));
}

/** Render an image to PNG via mupdf, OCR it, return one paragraph block. */
async function ocrImageFile(bytes: Uint8Array, mime: string, opts: ExtractOptions): Promise<Block[]> {
	const { default: mupdf } = await import("mupdf");
	let png = bytes;
	let imgW = 0;
	let imgH = 0;
	try {
		const doc = mupdf.Document.openDocument(bytes, mime || "image/png");
		const pixmap = doc
			.loadPage(0)
			.toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false, true);
		png = pixmap.asPNG();
		imgW = pixmap.getWidth();
		imgH = pixmap.getHeight();
	} catch {
		/* mupdf can't open it (e.g. SVG) — pass raw bytes to the OCR chain */
	}
	const lines = await ocrImage(png, {
		modelDir: opts.modelDir,
		imgWidth: imgW || 1,
		imgHeight: imgH || 1,
		cloudOcrImage: opts.ocr?.cloudOcrImage,
	});
	const text = lines.map((l) => l.text.trim()).filter(Boolean).join("\n").trim();
	return text ? [{ type: "paragraph", page: 1, readingOrder: 0, method: "ocr", confidence: 1, text }] : [];
}
