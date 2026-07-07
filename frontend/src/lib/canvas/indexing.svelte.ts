// Aggregate indexing progress for the toolbar toast. Tracks the CURRENT wave of
// in-flight file indexing jobs: `total` counts jobs registered this wave, `done`
// counts finished ones. A wave lazily resets when a new job starts after the last
// one drained — so the toast can hold at 100% on the final frame, stays hidden
// between waves, and dropping more files mid-wave raises `total` (percent recomputes).

export const indexing = $state({ total: 0, done: 0, activeCount: 0 });

// Plain (non-reactive) membership set — dedupes starts/finishes; the reactive counts
// above are what the UI reads.
const inflight = new Set<string>();

/** A file began indexing. Starting a job when none are in flight opens a fresh wave. */
export function startIndexing(id: string): void {
	if (indexing.activeCount === 0) {
		indexing.total = 0;
		indexing.done = 0;
	}
	if (inflight.has(id)) return;
	inflight.add(id);
	indexing.total += 1;
	indexing.activeCount = inflight.size;
}

/** A file finished indexing (ready or error). */
export function finishIndexing(id: string): void {
	if (!inflight.has(id)) return;
	inflight.delete(id);
	indexing.done += 1;
	indexing.activeCount = inflight.size;
}

/** Whether any indexing is in flight (drives toast visibility). */
export function indexingActive(): boolean {
	return indexing.activeCount > 0;
}

/** Percent complete for the current wave (0 when idle). */
export function indexingPercent(): number {
	return indexing.total > 0 ? Math.round((indexing.done / indexing.total) * 100) : 0;
}
