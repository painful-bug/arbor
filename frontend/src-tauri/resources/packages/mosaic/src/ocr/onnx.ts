// Shared ONNX plumbing: lazy model download into modelDir + cached sessions.
// All models are local after first fetch; no network at steady state.
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { InferenceSession } from "onnxruntime-node";

export function modelsRoot(modelDir?: string): string {
	return join(modelDir ?? join(tmpdir(), "mosaic-models"), "mosaic");
}

/** Download `url` → `<modelsRoot>/<sub>/<file>` once; return the local path. */
export async function ensureModel(modelDir: string | undefined, sub: string, file: string, url: string): Promise<string> {
	const dir = join(modelsRoot(modelDir), sub);
	const dest = join(dir, file);
	if (existsSync(dest)) return dest;
	await mkdir(dir, { recursive: true });
	const res = await fetch(url);
	if (!res.ok || !res.body) throw new Error(`mosaic: model download failed ${res.status} ${url}`);
	const tmp = `${dest}.part`;
	await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tmp));
	const { rename } = await import("node:fs/promises");
	await rename(tmp, dest);
	return dest;
}

const sessions = new Map<string, Promise<InferenceSession>>();

export async function session(path: string): Promise<InferenceSession> {
	let s = sessions.get(path);
	if (!s) {
		s = import("onnxruntime-node").then((ort) => ort.InferenceSession.create(path));
		sessions.set(path, s);
	}
	return s;
}
