// Bounded undo/redo stack of deep-cloned snapshots.
// ponytail: full-doc snapshots, not per-op diffs. Fine to thousands of nodes;
// switch to a command/diff log only if snapshot size becomes measurable.

/**
 * Create an undo/redo history of at most `limit` snapshots. Snapshots are
 * deep-cloned on push and on read, so callers can mutate freely. While locked,
 * push() is a no-op (used to suppress the autosave effect re-recording a
 * snapshot that undo/redo just applied).
 */
export function createHistory<T>(limit: number) {
	const stack: T[] = [];
	let ptr = -1;
	let locked = false;
	const clone = (v: T): T => JSON.parse(JSON.stringify(v)) as T;

	return {
		/** Record a snapshot. No-op while locked or if equal to the current entry. */
		push(snap: T): void {
			if (locked) return;
			const copy = clone(snap);
			if (ptr >= 0 && JSON.stringify(stack[ptr]) === JSON.stringify(copy)) return;
			stack.splice(ptr + 1); // drop redo tail
			stack.push(copy);
			if (stack.length > limit) stack.shift();
			ptr = stack.length - 1;
		},
		/** Step back; null when at the oldest snapshot. */
		undo(): T | null {
			if (ptr <= 0) return null;
			ptr--;
			return clone(stack[ptr]);
		},
		/** Step forward; null when at the newest snapshot. */
		redo(): T | null {
			if (ptr >= stack.length - 1) return null;
			ptr++;
			return clone(stack[ptr]);
		},
		/** True while pushes are suppressed. */
		locked: (): boolean => locked,
		/** Suppress pushes; auto-unlocks after `ms` when given. */
		lock(ms?: number): void {
			locked = true;
			if (ms !== undefined) {
				setTimeout(() => {
					locked = false;
				}, ms);
			}
		},
		/** Re-enable pushes now. */
		unlock(): void {
			locked = false;
		},
		/** Drop everything (canvas switch). */
		reset(): void {
			stack.length = 0;
			ptr = -1;
			locked = false;
		},
	};
}
