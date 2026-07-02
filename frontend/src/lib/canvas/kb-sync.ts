// KB synchronization for canvas nodes: debounced text-card indexing and purge of
// removed file nodes. No store import — the store injects what it needs.
import { kbRemove } from "$lib/ai/client";
import { debounce } from "$lib/debounce";

/**
 * Per-card debounced text indexing so we don't re-embed on every keystroke.
 * `canvas` is read at index time (the active canvas can change); `onIndexed`
 * fires after a successful index (used to trigger semantic auto-linking).
 */
export function createKbSync(deps: { canvas: () => string; onIndexed: (nodeId: string) => void }) {
	const perCard = new Map<string, (text: string) => void>();

	async function indexTextCard(cardId: string, text: string): Promise<void> {
		const { kbAdd } = await import("$lib/ai/client");
		const bytes = new TextEncoder().encode(text);
		// justified: KB indexing is best-effort background work; the note itself is saved.
		await kbAdd(deps.canvas(), `text:${cardId}`, "text/plain", bytes.buffer as ArrayBuffer).catch(
			() => {},
		);
		deps.onIndexed(cardId);
	}

	return {
		/** Schedule (2s debounce) re-indexing of a text card's content. */
		onTextChanged(cardId: string, text: string): void {
			let d = perCard.get(cardId);
			if (!d) {
				d = debounce((t: string) => {
					if (t.trim()) void indexTextCard(cardId, t);
				}, 2000);
				perCard.set(cardId, d);
			}
			d(text);
		},
	};
}

/**
 * Purge removed file nodes' KB chunks + stored blobs. Idempotent, so it's safe to
 * call from every delete path. Dynamic import of files.ts avoids a static cycle.
 */
export function cleanupFileNodes(
	canvas: string,
	fileNodes: { id: string; filename?: string }[],
): void {
	if (!fileNodes.length) return;
	void import("$lib/files").then(({ deleteFileBlob }) => {
		for (const n of fileNodes) {
			if (n.filename) void kbRemove(canvas, n.filename);
			deleteFileBlob(n.id);
		}
	});
}
