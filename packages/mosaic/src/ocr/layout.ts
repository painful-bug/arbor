// DocLayout-YOLO (ONNX) region detection — labels regions on a page image so each
// can be routed to the right processor (text → PP-OCR, formula → LaTeX OCR, table
// → reconstruction, figure → kept). YOLOv10-based: NMS-free, output is already
// decoded [1, 300, 6] = (x0,y0,x1,y1, conf, cls) in the 1024 letterbox space.
import { type BBox } from "../ast.ts";
import { ensureModel, session } from "./onnx.ts";

export type RegionType = "text" | "title" | "table" | "figure" | "formula";

export interface Region {
	type: RegionType;
	bbox: BBox; // normalized 0..1, top-left
	confidence: number;
}

const MODEL_URL =
	"https://huggingface.co/wybxc/DocLayout-YOLO-DocStructBench-onnx/resolve/main/doclayout_yolo_docstructbench_imgsz1024.onnx";
const IMGSZ = 1024;
const CONF = 0.25;

// DocStructBench class order. "abandon" = headers/footers/page numbers → dropped.
const CLASSES = [
	"title", "plain text", "abandon", "figure", "figure_caption",
	"table", "table_caption", "table_footnote", "isolate_formula", "formula_caption",
] as const;

function mapType(name: string): RegionType | null {
	switch (name) {
		case "title": return "title";
		case "figure": return "figure";
		case "table": return "table";
		case "isolate_formula": return "formula";
		case "abandon": return null; // skip page furniture
		default: return "text"; // plain text + all captions/footnotes
	}
}

// Letterbox to IMGSZ×IMGSZ (pad 114), BGR, CHW, /255 — matches the model's training transform.
async function preprocess(png: Uint8Array): Promise<{ tensor: Float32Array; w0: number; h0: number; r: number; padX: number; padY: number }> {
	const { default: sharp } = await import("sharp");
	const meta = await sharp(png).metadata();
	const w0 = meta.width ?? 1;
	const h0 = meta.height ?? 1;
	const r = Math.min(IMGSZ / w0, IMGSZ / h0);
	const rw = Math.round(w0 * r);
	const rh = Math.round(h0 * r);
	const padX = Math.floor((IMGSZ - rw) / 2);
	const padY = Math.floor((IMGSZ - rh) / 2);
	const { data } = await sharp(png)
		.removeAlpha()
		.resize(IMGSZ, IMGSZ, { fit: "contain", background: { r: 114, g: 114, b: 114 } })
		.raw()
		.toBuffer({ resolveWithObject: true }); // RGB interleaved, HWC

	const n = IMGSZ * IMGSZ;
	const t = new Float32Array(3 * n);
	for (let i = 0; i < n; i++) {
		const rr = data[i * 3] / 255;
		const gg = data[i * 3 + 1] / 255;
		const bb = data[i * 3 + 2] / 255;
		t[i] = bb;          // B plane
		t[n + i] = gg;      // G plane
		t[2 * n + i] = rr;  // R plane
	}
	return { tensor: t, w0, h0, r, padX, padY };
}

export async function detectLayout(png: Uint8Array, modelDir?: string): Promise<Region[]> {
	const path = await ensureModel(modelDir, "doclayout", "doclayout_yolo_docstructbench_imgsz1024.onnx", MODEL_URL);
	const sess = await session(path);
	const ort = await import("onnxruntime-node");
	const { tensor, w0, h0, r, padX, padY } = await preprocess(png);
	const input = new ort.Tensor("float32", tensor, [1, 3, IMGSZ, IMGSZ]);
	const out = await sess.run({ [sess.inputNames[0]]: input });
	const data = out[sess.outputNames[0]].data as Float32Array; // [1,300,6]

	const regions: Region[] = [];
	for (let i = 0; i < data.length; i += 6) {
		const conf = data[i + 4];
		if (conf < CONF) continue;
		const type = mapType(CLASSES[Math.round(data[i + 5])] ?? "");
		if (!type) continue;
		// un-letterbox → original px → normalize
		const x0 = (data[i] - padX) / r / w0;
		const y0 = (data[i + 1] - padY) / r / h0;
		const x1 = (data[i + 2] - padX) / r / w0;
		const y1 = (data[i + 3] - padY) / r / h0;
		regions.push({
			type,
			confidence: conf,
			bbox: {
				x0: Math.max(0, Math.min(1, x0)),
				y0: Math.max(0, Math.min(1, y0)),
				x1: Math.max(0, Math.min(1, x1)),
				y1: Math.max(0, Math.min(1, y1)),
			},
		});
	}
	return suppressNested(regions);
}

const area = (b: BBox) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
function inter(a: BBox, b: BBox): number {
	const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
	const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
	return w > 0 && h > 0 ? w * h : 0;
}

// YOLOv10 is NMS-free but still emits nested boxes (a wrapping "figure" plus the
// text blocks inside it), which would OCR the same pixels twice. Keep regions by
// confidence and drop any that mostly contain, or are mostly contained by, a
// region already kept.
function suppressNested(regions: Region[]): Region[] {
	const sorted = [...regions].sort((a, b) => b.confidence - a.confidence);
	const kept: Region[] = [];
	for (const r of sorted) {
		const ra = area(r.bbox) || 1e-9;
		const overlaps = kept.some((k) => {
			const i = inter(r.bbox, k.bbox);
			return i / ra > 0.6 || i / (area(k.bbox) || 1e-9) > 0.6;
		});
		if (!overlaps) kept.push(r);
	}
	return kept;
}
