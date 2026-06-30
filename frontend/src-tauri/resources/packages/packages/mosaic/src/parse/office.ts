import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { type Block } from "../ast.ts";

const para = (text: string): Block => ({
	type: "paragraph",
	page: 1,
	readingOrder: 0,
	method: "native",
	confidence: 1,
	text,
});

/** Flat text blob → paragraph blocks split on blank lines. */
function textToBlocks(text: string): Block[] {
	return text
		.split(/\n{2,}/)
		.map((t) => t.trim())
		.filter(Boolean)
		.map(para);
}

export async function parseDocx(bytes: Uint8Array): Promise<Block[]> {
	const mammoth = await import("mammoth");
	const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
	return textToBlocks(value);
}

export async function parsePptx(bytes: Uint8Array): Promise<Block[]> {
	const { parseOfficeAsync } = await import("officeparser");
	const text = await parseOfficeAsync(Buffer.from(bytes));
	return textToBlocks(text);
}

export async function parseCsv(bytes: Uint8Array): Promise<Block[]> {
	const { csvParseRows } = await import("d3-dsv");
	const rows = csvParseRows(new TextDecoder().decode(bytes));
	return rows.length ? [{ type: "table", page: 1, readingOrder: 0, method: "native", confidence: 1, rows }] : [];
}

/** EPUB has no buffer-native loader here, so spill to a temp file for LangChain. */
export async function parseEpub(bytes: Uint8Array): Promise<Block[]> {
	const { EPubLoader } = await import("@langchain/community/document_loaders/fs/epub");
	const p = join(tmpdir(), `mosaic_${randomBytes(8).toString("hex")}.epub`);
	await writeFile(p, bytes);
	try {
		const docs = await new EPubLoader(p).load();
		return textToBlocks(docs.map((d) => d.pageContent).join("\n\n"));
	} finally {
		await unlink(p).catch(() => {});
	}
}
