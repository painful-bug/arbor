type BlockType = "heading" | "paragraph" | "table" | "formula" | "figure" | "list";
/** How a block's content was obtained. */
type Method = "native" | "ocr" | "formula";
interface BBox {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}
interface Block {
    type: BlockType;
    page: number;
    readingOrder: number;
    method: Method;
    confidence: number;
    text?: string;
    latex?: string;
    rows?: string[][];
    bbox?: BBox;
    level?: number;
}
interface MosaicPage {
    number: number;
    blocks: Block[];
    width?: number;
    height?: number;
}
interface MosaicDoc {
    filename: string;
    mime: string;
    pages: MosaicPage[];
}
/** All blocks in global reading order. */
declare function blocksInOrder(doc: MosaicDoc): Block[];
/** Plain concatenated text (no markdown syntax) — handy for quick checks. */
declare function plainText(doc: MosaicDoc): string;

/** Render the AST to Markdown + LaTeX, in reading order, page by page. */
declare function toMarkdown(doc: MosaicDoc): string;
/** Same render, but split per page with the 1-based page number — lets RAG keep
 *  page attribution so a hit can deep-link to the page it came from. */
declare function toMarkdownPages(doc: MosaicDoc): {
    page: number;
    text: string;
}[];

interface ExtractOptions {
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
    onProgress?: (p: {
        page: number;
        total: number;
    }) => void;
}
declare function extract(bytes: Uint8Array, opts?: ExtractOptions): Promise<MosaicDoc>;

export { type BBox, type Block, type BlockType, type ExtractOptions, type Method, type MosaicDoc, type MosaicPage, blocksInOrder, extract, plainText, toMarkdown, toMarkdownPages };
