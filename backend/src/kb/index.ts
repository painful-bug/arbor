// Per-canvas knowledge base: file/chat/card ingestion → Graphiti temporal graph.
// One Graphiti group_id per canvas (= canvas id). Replaces rag/index.ts.
import { addMemory, searchFacts, searchNodes, clearGraph } from "./mcp-client.ts";
import { loadText } from "./loaders.ts";

// ponytail: 2000-char chunks — larger than old RAG (800) because LLM entity extraction
// benefits from more context per episode. Fewer calls, richer graph edges.
function splitText(text: string, size = 2000, overlap = 200): string[] {
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
	bytes: Uint8Array
): Promise<number> {
	if (!canvas) { console.warn("[KB] addFile called with empty canvas id — skipping"); return 0; }
	const text = await loadText(filename, mime, bytes);
	if (!text.trim()) return 0;

	console.log(`[KB] addFile ${filename} (${canvas}): ${text.length} chars extracted, first 200: ${text.slice(0, 200).replace(/\n/g, " ")}`);
	const chunks = splitText(text);
	// Send chunks in parallel; each becomes an episode in the graph.
	await Promise.all(
		chunks.map((chunk, i) =>
			addMemory(canvas, `${filename}#${i}`, chunk, "text", filename).catch((err) =>
				console.error(`[KB] addMemory chunk ${i} of ${filename}:`, err)
			)
		)
	);
	return chunks.length;
}

export async function addChat(
	canvas: string,
	cardId: string,
	prompt: string,
	answer: string
): Promise<void> {
	if (!canvas) { console.warn("[KB] addChat called with empty canvas id — skipping"); return; }
	const body = `User: ${prompt}\n\nAssistant: ${answer}`;
	await addMemory(canvas, `chat:${cardId}:${Date.now()}`, body, "message", `card ${cardId}`).catch(
		(err) => console.error("[KB] addChat:", err)
	);
}

export async function addCard(canvas: string, cardId: string, title: string): Promise<void> {
	await addMemory(canvas, `card:${cardId}`, title, "text", `card ${cardId}`).catch((err) =>
		console.error("[KB] addCard:", err)
	);
}

export async function search(canvas: string, query: string, k = 6): Promise<string[]> {
	if (!canvas) return [];
	const [facts, nodes] = await Promise.all([
		searchFacts(canvas, query, k).catch(() => [] as string[]),
		searchNodes(canvas, query, k).catch(() => [] as string[])
	]);
	// Deduplicate by content; facts first (more specific), nodes second.
	const seen = new Set<string>();
	const results: string[] = [];
	for (const s of [...facts, ...nodes]) {
		const key = s.trim().toLowerCase().slice(0, 80);
		if (!seen.has(key)) {
			seen.add(key);
			results.push(s);
		}
	}
	return results.slice(0, k);
}

export async function clearCanvas(canvas: string): Promise<void> {
	await clearGraph(canvas).catch((err) => console.error("[KB] clearCanvas:", err));
}
