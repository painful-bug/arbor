import { type Block, type MosaicDoc, blocksInOrder } from "./ast.ts";

function tableToMarkdown(rows: string[][]): string {
	if (rows.length === 0) return "";
	const width = Math.max(...rows.map((r) => r.length));
	const pad = (r: string[]) => {
		const cells = [...r];
		while (cells.length < width) cells.push("");
		return cells.map((c) => c.replace(/\|/g, "\\|").replace(/\n/g, " ").trim());
	};
	const header = pad(rows[0]);
	const sep = new Array(width).fill("---");
	const body = rows.slice(1).map(pad);
	return [header, sep, ...body].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function blockToMarkdown(b: Block): string {
	switch (b.type) {
		case "heading": {
			const level = Math.min(Math.max(b.level ?? 1, 1), 6);
			return `${"#".repeat(level)} ${b.text ?? ""}`.trim();
		}
		case "formula":
			return b.latex ? `$$\n${b.latex.trim()}\n$$` : (b.text ?? "");
		case "table":
			return b.rows ? tableToMarkdown(b.rows) : (b.text ?? "");
		case "figure": {
			// Caption / OCR'd figure text rendered as an italic note so it stays searchable.
			const cap = (b.text ?? "").trim();
			return cap ? `> _Figure:_ ${cap}` : "";
		}
		case "list":
		case "paragraph":
		default:
			return (b.text ?? "").trim();
	}
}

/** Render the AST to Markdown + LaTeX, in reading order, page by page. */
export function toMarkdown(doc: MosaicDoc): string {
	return blocksInOrder(doc)
		.map(blockToMarkdown)
		.filter((s) => s.length > 0)
		.join("\n\n")
		.trim();
}
