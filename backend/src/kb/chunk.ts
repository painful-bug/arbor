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

export async function chunkText(text: string, filename = ""): Promise<string[]> {
	const trimmed = text.trim();
	if (!trimmed) return [];
	const splitter = looksMarkdown(filename, trimmed)
		? new MarkdownTextSplitter({ chunkSize: SIZE, chunkOverlap: OVERLAP })
		: new RecursiveCharacterTextSplitter({ chunkSize: SIZE, chunkOverlap: OVERLAP });
	const chunks = await splitter.splitText(trimmed);
	return chunks.map((c) => c.trim()).filter(Boolean);
}
