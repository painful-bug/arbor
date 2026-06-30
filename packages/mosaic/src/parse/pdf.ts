import { type BBox, type Block, type BlockType } from "../ast.ts";
import type { OcrLine } from "../ocr/index.ts";
import type { Region, RegionType } from "../ocr/layout.ts";
import type { FormulaOcr } from "../ocr/formula.ts";
import { linesToTable } from "../table.ts";

/** mupdf StructuredText bbox is {x,y,w,h}; the AST uses corner coords. */
function toBBox(b: { x: number; y: number; w: number; h: number } | undefined): BBox | undefined {
	if (!b) return undefined;
	return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

function blockText(blk: { lines?: { text?: string; spans?: { text?: string }[] }[] }): string {
	return (blk.lines ?? [])
		.map((l) => l.text ?? (l.spans ?? []).map((s) => s.text ?? "").join(""))
		.join("\n")
		.trim();
}

/** OCR one rendered page/region; img dims are the rendered pixmap's pixel size. */
export type PageOcr = (png: Uint8Array, img: { width: number; height: number }) => Promise<OcrLine[]>;
/** Detect layout regions on a rendered page (normalized 0..1 bboxes). */
export type PageLayout = (png: Uint8Array) => Promise<Region[]>;

export interface PdfResult {
	blocks: Block[];
	dims: Map<number, { width: number; height: number }>;
}

const PAGE_CHAR_THRESHOLD = 100; // below this a page is treated as scanned → OCR
const RENDER_SCALE = 2;

const BLOCK_TYPE: Record<RegionType, BlockType> = {
	title: "heading",
	text: "paragraph",
	figure: "figure",
	formula: "formula",
	table: "table",
};

function joinLines(lines: OcrLine[]): { text: string; conf: number } {
	const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
	const text = sorted.map((l) => l.text.trim()).filter(Boolean).join("\n").trim();
	const conf = sorted.length ? sorted.reduce((s, l) => s + l.confidence, 0) / sorted.length : 0;
	return { text, conf };
}

const byYX = (a: Region, b: Region) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0;

// Reading order for region-routed pages. Detect a 2-column layout (no region
// straddles the page midline) and read left column fully, then right; otherwise
// a single top-to-bottom flow. ponytail: midline split handles 1- and 2-column
// docs; upgrade to recursive XY-cut if 3+ columns or full-width banners appear.
function readingOrder(regions: Region[]): Region[] {
	if (regions.length < 3) return [...regions].sort(byYX);
	const straddles = regions.some((r) => r.bbox.x0 < 0.45 && r.bbox.x1 > 0.55);
	if (straddles) return [...regions].sort(byYX);
	const center = (r: Region) => (r.bbox.x0 + r.bbox.x1) / 2;
	const left = regions.filter((r) => center(r) < 0.5).sort(byYX);
	const right = regions.filter((r) => center(r) >= 0.5).sort(byYX);
	return [...left, ...right];
}

/** Crop a normalized region out of a rendered page PNG. */
async function cropRegion(png: Uint8Array, r: BBox, imgW: number, imgH: number): Promise<{ png: Uint8Array; w: number; h: number } | null> {
	const left = Math.max(0, Math.floor(r.x0 * imgW));
	const top = Math.max(0, Math.floor(r.y0 * imgH));
	const w = Math.min(imgW - left, Math.ceil((r.x1 - r.x0) * imgW));
	const h = Math.min(imgH - top, Math.ceil((r.y1 - r.y0) * imgH));
	if (w < 4 || h < 4) return null;
	const { default: sharp } = await import("sharp");
	const out = await sharp(png).extract({ left, top, width: w, height: h }).png().toBuffer();
	return { png: new Uint8Array(out), w, h };
}

/**
 * PDF → blocks. Native text pages keep their text layer. Scanned pages are
 * rendered, layout-detected (when `layout` is injected), and each region is
 * OCR'd via the injected `ocr` chain and typed by its region class. Without a
 * layout fn, the whole page is OCR'd as one paragraph.
 */
export async function parsePdf(
	bytes: Uint8Array,
	range: [number, number],
	deps: { ocr?: PageOcr; layout?: PageLayout; formula?: FormulaOcr; onProgress?: (p: { page: number; total: number }) => void } = {},
): Promise<PdfResult> {
	const { ocr, layout, formula, onProgress } = deps;
	const { default: mupdf } = await import("mupdf");
	const doc = mupdf.Document.openDocument(bytes, "application/pdf");
	const [start, end] = range;
	const blocks: Block[] = [];
	const dims = new Map<number, { width: number; height: number }>();

	for (let i = start; i < end; i++) {
		const pageNum = i + 1;
		const page = doc.loadPage(i);
		const [x0, y0, x1, y1] = page.getBounds();
		const pageW = x1 - x0;
		const pageH = y1 - y0;
		dims.set(pageNum, { width: pageW, height: pageH });

		const st = JSON.parse(page.toStructuredText("preserve-whitespace").asJSON());
		const native: Block[] = [];
		for (const blk of st.blocks ?? []) {
			const text = blockText(blk);
			if (!text) continue;
			native.push({ type: "paragraph", page: pageNum, readingOrder: 0, method: "native", confidence: 1, text, bbox: toBBox(blk.bbox) });
		}
		const nativeChars = native.reduce((n, b) => n + (b.text?.length ?? 0), 0);

		if (ocr && nativeChars < PAGE_CHAR_THRESHOLD) {
			const pixmap = page.toPixmap(mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE), mupdf.ColorSpace.DeviceRGB, false, true);
			const pagePng = pixmap.asPNG();
			const imgW = pixmap.getWidth();
			const imgH = pixmap.getHeight();
			const before = blocks.length;

			const detected = layout ? await layout(pagePng).catch(() => []) : [];
			for (const reg of readingOrder(detected)) {
				const crop = await cropRegion(pagePng, reg.bbox, imgW, imgH);
				if (!crop) continue;
				const lines = await ocr(crop.png, { width: crop.w, height: crop.h });
				const { text, conf } = joinLines(lines);
				const bbox: BBox = { x0: reg.bbox.x0 * pageW, y0: reg.bbox.y0 * pageH, x1: reg.bbox.x1 * pageW, y1: reg.bbox.y1 * pageH };
				const base = { page: pageNum, readingOrder: 0, method: "ocr" as const, confidence: conf || reg.confidence, bbox };

				if (reg.type === "table") {
					const rows = linesToTable(lines);
					if (rows.length) { blocks.push({ ...base, type: "table", rows }); continue; }
				}
				if (reg.type === "formula") {
					const latex = formula ? await formula(crop.png).catch(() => null) : null;
					if (latex || text) { blocks.push({ ...base, type: "formula", latex: latex ?? undefined, text: latex ? undefined : text }); continue; }
				}
				if (text) blocks.push({ ...base, type: BLOCK_TYPE[reg.type], text });
			}

			// No layout, empty layout, or layout produced no text → OCR whole page.
			if (blocks.length === before) {
				const lines = await ocr(pagePng, { width: imgW, height: imgH });
				const { text, conf } = joinLines(lines);
				if (text) {
					blocks.push({ type: "paragraph", page: pageNum, readingOrder: 0, method: "ocr", confidence: conf, text });
				} else {
					blocks.push(...native);
				}
			}
		} else {
			blocks.push(...native);
		}

		onProgress?.({ page: pageNum - start, total: end - start });
	}

	return { blocks, dims };
}

/** Page count without a full parse — used to resolve page ranges in the CLI/UI. */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
	const { default: mupdf } = await import("mupdf");
	return mupdf.Document.openDocument(bytes, "application/pdf").countPages();
}
