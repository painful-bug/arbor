import { pipeline, env } from "@xenova/transformers";
import { MODELS_DIR } from "../paths.ts";

env.cacheDir = MODELS_DIR;

let _pipe: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getPipe() {
	if (!_pipe) _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
	return _pipe!;
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
