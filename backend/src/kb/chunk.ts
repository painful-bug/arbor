// Structure-aware chunking via LangChain splitters. Markdown content (OCR output,
// .md files) splits on headings/lists so a section stays whole; everything else uses
// the recursive splitter that prefers paragraph/sentence boundaries over mid-word cuts.
import { RecursiveCharacterTextSplitter, MarkdownTextSplitter } from "@langchain/textsplitters";

const SIZE = 800;
const OVERLAP = 120;

function looksMarkdown(filename: string, text: string): boolean {
	if (/\.(md|markdown)$/i.test(filename)) return true;
	// Headings, pipe tables, or fenced code → treat as markdown.
	return /^#{1,6}\s/m.test(text) || /^\s*\|.+\|\s*$/m.test(text) || /```/.test(text);
}

async function split(text: string, filename: string): Promise<string[]> {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const splitter = looksMarkdown(filename, trimmed)
		? new MarkdownTextSplitter({ chunkSize: SIZE, chunkOverlap: OVERLAP })
		: new RecursiveCharacterTextSplitter({ chunkSize: SIZE, chunkOverlap: OVERLAP });
	const chunks = await splitter.splitText(trimmed);
	return chunks.map((c) => c.trim()).filter(Boolean);
}

export async function chunkText(text: string, filename = ""): Promise<string[]> {
	return split(text, filename);
}

// Per-page chunking so each chunk keeps its source page for deep-linking.
// ponytail: a chunk never straddles a page boundary, so cross-page context is
// slightly reduced — page attribution is worth more for in-preview search.
export async function chunkPages(
	pages: { page: number; text: string }[],
	filename = "",
): Promise<{ text: string; page: number }[]> {
	const out: { text: string; page: number }[] = [];
	for (const { page, text } of pages) {
		for (const c of await split(text, filename)) out.push({ text: c, page });
	}
	return out;
}
