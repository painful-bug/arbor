import { MODELS_DIR } from "../paths.ts";

// Dynamic import: @xenova/transformers eagerly loads onnxruntime-node's native
// addon (which spins up CPU-core-sized thread pools) the moment the package is
// imported at all, even before a pipeline is created. Deferring the import to
// first actual use keeps idle sessions (no KB activity) from paying that cost.
let _mod: typeof import("@xenova/transformers") | null = null;
let _pipe: any = null;

async function getPipe() {
	if (!_mod) {
		_mod = await import("@xenova/transformers");
		_mod.env.cacheDir = MODELS_DIR;
	}
	if (!_pipe) _pipe = await _mod.pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
	return _pipe;
}

// ponytail: serialize embed calls — the pipeline is a singleton and isn't
// concurrency-safe, so parallel file indexing must take turns here. Extract/OCR
// (the slow part) still runs in parallel across requests.
let _queue: Promise<unknown> = Promise.resolve();

export function embed(texts: string[]): Promise<number[][]> {
	const run = _queue.then(async () => {
		const pipe = await getPipe();
		const out = await pipe(texts, { pooling: "mean", normalize: true });
		return out.tolist() as number[][];
	});
	_queue = run.catch(() => {});
	return run as Promise<number[][]>;
}
