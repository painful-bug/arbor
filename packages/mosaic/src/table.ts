// Table region → rows[][]. Lines from a detected `table` region are clustered
// into rows by vertical band, and cells within a row are ordered left-to-right.
// ponytail: geometric clustering, not full table-structure recognition (SLANet/
// TSR). Borderless tables with ragged columns may mis-align cells — upgrade to a
// TSR ONNX model in ocr/ if that shows up. Markdown still renders the grid.
import type { OcrLine } from "./ocr/index.ts";

export function linesToTable(lines: OcrLine[]): string[][] {
	const items = lines.filter((l) => l.text.trim());
	if (!items.length) return [];
	const sorted = [...items].sort((a, b) => a.bbox.y0 - b.bbox.y0);

	// Group into rows: a line joins the current row if its center sits within the
	// row's vertical band, else it starts a new row.
	const rows: OcrLine[][] = [];
	for (const l of sorted) {
		const row = rows[rows.length - 1];
		const cy = (l.bbox.y0 + l.bbox.y1) / 2;
		const band = row ? Math.max(...row.map((r) => r.bbox.y1)) : 0;
		if (row && cy <= band) row.push(l);
		else rows.push([l]);
	}

	return rows.map((row) =>
		[...row].sort((a, b) => a.bbox.x0 - b.bbox.x0).map((l) => l.text.trim()),
	);
}
