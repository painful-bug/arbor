import { extract, toMarkdown } from "@arbor/mosaic";
import { cloudOcrImage } from "./cloud-ocr.ts";
import { MODELS_DIR } from "../paths.ts";
import { embed } from "./embeddings.ts";
import { upsert, hybridSearch, clear, removeSource, relate, sources as storeSources, sourceContent } from "./store.ts";
import { contextualize } from "./contextualize.ts";
import { rerank } from "./rerank.ts";
import { chunkText } from "./chunk.ts";
import { randomBytes } from "node:crypto";

export type Verdict = "strong" | "weak" | "none";
export interface GradedSearch {
	chunks: { text: string; score: number }[];
	verdict: Verdict;
}

// Cross-encoder sigmoid score bands (calibrated on bge-reranker-base):
// relevant pairs land ~0.9+, irrelevant ~0.0. A best hit below WEAK means the KB
// almost certainly lacks the answer — the agent should fall back to web/tools.
const STRONG = 0.5;
const WEAK = 0.05;

export async function addFile(
	canvas: string,
	filename: string,
	mime: string,
	bytes: Uint8Array,
): Promise<number> {
	if (!canvas) { console.warn("[KB] addFile called with empty canvas id — skipping"); return 0; }
	// @arbor/mosaic: bytes → typed AST → Markdown (text layer + OCR + layout). Cloud
	// VLM OCR is injected so keys stay in the backend (Bun.secrets), never the package.
	const doc = await extract(bytes, { filename, mime, modelDir: MODELS_DIR, ocr: { cloudOcrImage } });
	const text = toMarkdown(doc);
	if (!text.trim()) return 0;

	console.log(`[KB] addFile ${filename} (${canvas}): ${text.length} chars extracted`);
	const chunks = await chunkText(text, filename);
	if (chunks.length === 0) return 0;

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

// Retrieve → rerank → grade. Over-fetch with hybrid search, rerank with the
// cross-encoder, keep the top k, and grade sufficiency from the best score so the
// agent knows whether to trust the KB or fall back to web/tools (CRAG).
export async function searchGraded(canvas: string, query: string, k = 6): Promise<GradedSearch> {
	if (!canvas) return { chunks: [], verdict: "none" };
	const [queryVec] = await embed([query]);
	const candidates = await hybridSearch(canvas, queryVec, query, Math.max(k * 3, 20));
	if (candidates.length === 0) return { chunks: [], verdict: "none" };

	const ranked = await rerank(query, candidates).catch(() => null);
	if (!ranked) {
		// Reranker unavailable — return hybrid order, score -1 signals "unscored".
		return { chunks: candidates.slice(0, k).map((text) => ({ text, score: -1 })), verdict: "weak" };
	}

	const top = ranked.slice(0, k);
	const best = top[0]?.score ?? 0;
	const verdict: Verdict = best >= STRONG ? "strong" : best >= WEAK ? "weak" : "none";
	return { chunks: top, verdict };
}

export async function search(canvas: string, query: string, k = 6): Promise<string[]> {
	const { chunks } = await searchGraded(canvas, query, k);
	return chunks.map((c) => c.text);
}

// Semantic neighbors of a node, for background auto-linking. Embeds the node's
// representative text fresh (works even before the node's own indexing lands) and
// finds the nearest other sources above minScore.
export async function relateNode(
	canvas: string,
	text: string,
	exclude: string,
	k = 3,
	minScore = 0.62,
): Promise<{ source: string; score: number }[]> {
	if (!canvas || !text.trim()) return [];
	const [vec] = await embed([text]);
	const neighbors = await relate(canvas, vec, k, exclude ? [exclude] : []);
	return neighbors.filter((n) => n.score >= minScore);
}

export async function removeFile(canvas: string, filename: string): Promise<void> {
	await removeSource(canvas, filename);
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
