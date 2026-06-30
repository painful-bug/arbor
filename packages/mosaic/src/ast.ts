// The Document AST is mosaic's source of truth. Every parser and OCR processor
// emits Blocks; Markdown, JSON, and RAG chunks are all derived from this tree, so
// downstream formats never drift. Each block carries provenance (how it was
// extracted + a confidence) so callers can grade or filter low-trust regions.

export type BlockType = "heading" | "paragraph" | "table" | "formula" | "figure" | "list";

/** How a block's content was obtained. */
export type Method = "native" | "ocr" | "formula";

export interface BBox {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export interface Block {
	type: BlockType;
	page: number; // 1-based
	readingOrder: number; // global order across the document
	method: Method;
	confidence: number; // 0..1
	text?: string; // markdown-ready text for heading/paragraph/list/figure caption
	latex?: string; // for formula blocks
	rows?: string[][]; // for table blocks
	bbox?: BBox;
	level?: number; // heading level (1..6)
}

export interface MosaicPage {
	number: number; // 1-based
	blocks: Block[];
	width?: number;
	height?: number;
}

export interface MosaicDoc {
	filename: string;
	mime: string;
	pages: MosaicPage[];
}

/** All blocks in global reading order. */
export function blocksInOrder(doc: MosaicDoc): Block[] {
	return doc.pages
		.flatMap((p) => p.blocks)
		.sort((a, b) => a.readingOrder - b.readingOrder);
}

/** Plain concatenated text (no markdown syntax) — handy for quick checks. */
export function plainText(doc: MosaicDoc): string {
	return blocksInOrder(doc)
		.map((b) => b.latex ?? b.text ?? "")
		.filter(Boolean)
		.join("\n\n")
		.trim();
}
