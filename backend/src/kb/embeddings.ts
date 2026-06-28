import { pipeline, env } from "@xenova/transformers";
import { MODELS_DIR } from "../paths.ts";

env.cacheDir = MODELS_DIR;

let _pipe: Awaited<ReturnType<typeof pipeline>> | null = null;

async function getPipe() {
	if (!_pipe) _pipe = await pipeline("feature-extraction", "Xenova/bge-small-en-v1.5");
	return _pipe!;
}

export async function embed(texts: string[]): Promise<number[][]> {
	const pipe = await getPipe();
	const out = await pipe(texts, { pooling: "mean", normalize: true });
	return out.tolist() as number[][];
}
