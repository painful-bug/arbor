// Local cross-encoder reranker. A bi-encoder (the embedder) is fast but coarse;
// a cross-encoder reads query + passage together and scores true relevance, so we
// over-fetch with hybrid search then rerank down to the few chunks the LLM sees.
import { MODELS_DIR } from "../paths.ts";

// Dynamic import: see embeddings.ts — defers onnxruntime-node's native addon
// (and its thread pools) until a rerank actually runs.
let _mod: typeof import("@xenova/transformers") | null = null;
let _tok: any = null;
let _model: any = null;

async function load() {
	if (!_mod) {
		_mod = await import("@xenova/transformers");
		_mod.env.cacheDir = MODELS_DIR;
	}
	if (!_tok || !_model) {
		_tok = await _mod.AutoTokenizer.from_pretrained("Xenova/bge-reranker-base");
		_model = await _mod.AutoModelForSequenceClassification.from_pretrained("Xenova/bge-reranker-base");
	}
	return { tok: _tok, model: _model };
}

export interface Scored {
	text: string;
	score: number; // sigmoid relevance in [0,1]
}

// Rerank passages by cross-encoder relevance to the query. Returns desc by score.
// Throws if the model can't load — callers fall back to the pre-rerank order.
export async function rerank(query: string, passages: string[]): Promise<Scored[]> {
	if (passages.length === 0) return [];
	const { tok, model } = await load();
	const inputs = tok(new Array(passages.length).fill(query), {
		text_pair: passages,
		padding: true,
		truncation: true,
	});
	const { logits } = await model(inputs);
	const raw = logits.tolist() as number[][];
	return passages
		.map((text, i) => ({ text, score: 1 / (1 + Math.exp(-raw[i][0])) }))
		.sort((a, b) => b.score - a.score);
}
