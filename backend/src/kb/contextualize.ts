// Contextual chunk headers: ask the user's configured LLM for a one-sentence
// "where does this chunk sit in the document" header per chunk. Optional —
// returns empty headers when no provider/key is configured or calls fail.
import { chatComplete } from "../agent/complete.ts";
import { CONTEXTUALIZE_BATCH } from "../config.ts";

const CONTEXT_PROMPT = (source: string, chunk: string) =>
	`You are processing a document titled "${source}". Here is a chunk from it:\n\n<chunk>\n${chunk}\n</chunk>\n\nWrite ONE short sentence (under 25 words) that situates this chunk within the document — what topic or section it belongs to. Output ONLY the sentence, nothing else.`;

/** One situating header per chunk ("" where generation failed or is disabled). */
export async function contextualize(source: string, chunks: string[]): Promise<string[]> {
	const headers: string[] = new Array(chunks.length).fill("");

	for (let i = 0; i < chunks.length; i += CONTEXTUALIZE_BATCH) {
		const batch = chunks.slice(i, i + CONTEXTUALIZE_BATCH);
		const results = await Promise.all(
			batch.map((chunk) =>
				// justified: headers are best-effort — a failed call degrades to no header.
				chatComplete(CONTEXT_PROMPT(source, chunk.slice(0, 1500)), 200).catch(() => ""),
			),
		);
		for (let j = 0; j < results.length; j++) {
			headers[i + j] = results[j].trim();
		}
	}

	return headers;
}
