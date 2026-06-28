import { loadText } from "./loaders.ts";
import { embed } from "./embeddings.ts";
import { upsert, hybridSearch, clear, sources as storeSources, sourceContent } from "./store.ts";
import { contextualize } from "./contextualize.ts";
import { randomBytes } from "node:crypto";

function splitText(text: string, size = 800, overlap = 120): string[] {
	const paragraphs = text.split(/\n\n+/);
	const chunks: string[] = [];
	let buf = "";
	for (const para of paragraphs) {
		if (buf.length + para.length + 2 > size && buf) {
			chunks.push(buf.trim());
			buf = buf.slice(Math.max(0, buf.length - overlap));
		}
		buf += (buf ? "\n\n" : "") + para;
	}
	if (buf.trim()) chunks.push(buf.trim());
	return chunks.length ? chunks : text.length ? [text.slice(0, size)] : [];
}

export async function addFile(
	canvas: string,
	filename: string,
	mime: string,
	bytes: Uint8Array,
): Promise<number> {
	if (!canvas) { console.warn("[KB] addFile called with empty canvas id — skipping"); return 0; }
	const text = await loadText(filename, mime, bytes);
	if (!text.trim()) return 0;

	console.log(`[KB] addFile ${filename} (${canvas}): ${text.length} chars extracted`);
	const chunks = splitText(text);

	// Contextual headers: prepend a 1-sentence situating header per chunk
	const headers = await contextualize(filename, chunks).catch(() =>
		new Array<string>(chunks.length).fill(""),
	);

	const embedTexts = chunks.map((chunk, i) =>
		headers[i] ? `${headers[i]}\n\n${chunk}` : chunk,
	);

	const vectors = await embed(embedTexts);

	const rows = embedTexts.map((text, i) => ({
		id: randomBytes(8).toString("hex"),
		source: filename,
		text,
		vector: vectors[i],
	}));

	await upsert(canvas, filename, rows);
	return rows.length;
}

export async function addChat(
	canvas: string,
	cardId: string,
	prompt: string,
	answer: string,
): Promise<void> {
	if (!canvas) { console.warn("[KB] addChat called with empty canvas id — skipping"); return; }
	const body = `User: ${prompt}\n\nAssistant: ${answer}`;
	const source = `chat:${cardId}`;
	const vectors = await embed([body]);
	await upsert(canvas, source, [{
		id: randomBytes(8).toString("hex"),
		source,
		text: body,
		vector: vectors[0],
	}]);
}

export async function addCard(canvas: string, cardId: string, title: string): Promise<void> {
	const source = `card:${cardId}`;
	const vectors = await embed([title]);
	await upsert(canvas, source, [{
		id: randomBytes(8).toString("hex"),
		source,
		text: title,
		vector: vectors[0],
	}]);
}

export async function search(canvas: string, query: string, k = 6): Promise<string[]> {
	if (!canvas) return [];
	const [queryVec] = await embed([query]);
	return hybridSearch(canvas, queryVec, query, k);
}

export async function clearCanvas(canvas: string): Promise<void> {
	await clear(canvas);
}

export async function readSource(canvas: string, source: string): Promise<string[]> {
	if (!canvas || !source) return [];
	return sourceContent(canvas, source);
}

export async function contentsOf(canvas: string): Promise<{ sources: string[]; chunks: number }> {
	if (!canvas) return { sources: [], chunks: 0 };
	const list = await storeSources(canvas);
	return {
		sources: list.map((s) => s.source),
		chunks: list.reduce((sum, s) => sum + s.chunks, 0),
	};
}
