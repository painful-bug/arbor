import { test, expect } from "bun:test";
import { extract, toMarkdown, toMarkdownPages, plainText } from "./index.ts";
import { parseText } from "./parse/text.ts";
import { linesToTable } from "./table.ts";

const line = (text: string, x0: number, y0: number) => ({ text, bbox: { x0, y0, x1: x0 + 0.1, y1: y0 + 0.05 }, confidence: 0.9 });

const enc = (s: string) => new TextEncoder().encode(s);

test("text: headings and paragraphs become blocks", () => {
	const blocks = parseText("# Title\n\nFirst para.\n\nSecond para.");
	expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "paragraph"]);
	expect(blocks[0].level).toBe(1);
	expect(blocks[0].text).toBe("Title");
});

test("extract txt → AST → markdown round-trips structure", async () => {
	const doc = await extract(enc("# Heading\n\nBody text here."), { filename: "note.txt" });
	expect(doc.pages).toHaveLength(1);
	const md = toMarkdown(doc);
	expect(md).toBe("# Heading\n\nBody text here.");
});

test("toMarkdownPages keeps one entry per non-empty page with its number", async () => {
	const doc = await extract(enc("# Heading\n\nBody text here."), { filename: "note.txt" });
	const pages = toMarkdownPages(doc);
	expect(pages).toHaveLength(1);
	expect(pages[0].page).toBe(1);
	expect(pages[0].text).toBe("# Heading\n\nBody text here.");
});

test("reading order is global and monotonic", async () => {
	const doc = await extract(enc("a\n\nb\n\nc"), { filename: "x.txt" });
	const orders = doc.pages[0].blocks.map((b) => b.readingOrder);
	expect(orders).toEqual([0, 1, 2]);
});

test("html strips tags to text", async () => {
	const doc = await extract(enc("<h1>Hi</h1><p>there</p>"), { filename: "p.html" });
	expect(plainText(doc)).toBe("Hi there");
});

test("csv becomes a table block rendered as markdown table", async () => {
	const doc = await extract(enc("a,b\n1,2"), { filename: "d.csv" });
	expect(doc.pages[0].blocks[0].type).toBe("table");
	expect(toMarkdown(doc)).toBe("| a | b |\n| --- | --- |\n| 1 | 2 |");
});

test("linesToTable clusters OCR lines into rows and x-ordered cells", () => {
	// two rows (y bands ~0.0 and ~0.2), cells given out of x-order
	const rows = linesToTable([
		line("B1", 0.5, 0.01),
		line("A1", 0.1, 0.0),
		line("A2", 0.1, 0.2),
		line("B2", 0.5, 0.21),
	]);
	expect(rows).toEqual([["A1", "B1"], ["A2", "B2"]]);
});
