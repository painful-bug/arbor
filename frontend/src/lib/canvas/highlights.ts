// Shared utilities for localStorage-persisted highlights and text-mark rendering.

export function loadHL<T>(key: string): T[] {
	try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

export function saveHL<T>(key: string, value: T[]): void {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// Wrap every occurrence of each mark string in <mark>…</mark> within rendered HTML.
// `ci` matches case-insensitively while preserving the original casing of each hit
// (global search is case-insensitive, so its highlight must be too).
// ponytail: string-match; switch to Range/offset anchoring if marks need to survive edits.
export function applyTextHL(html: string, marks: string[], ci = false): string {
	let src = html;
	for (const hl of marks) {
		if (!hl) continue;
		const escaped = hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		src = src.replace(new RegExp(escaped, ci ? 'gi' : 'g'), (m) => `<mark>${m}</mark>`);
	}
	return src;
}

// Active-aware highlighter for global search. Wraps every match in <mark>; the match
// whose running index === `active` gets <mark class="mark-active"> (the focused word).
// `start` is the running occurrence index coming into this html fragment, so a node
// rendered in several pieces (card title + answer) can thread one continuous count.
// Returns the marked html plus the next running index.
export function markHTML(
	html: string,
	terms: string[],
	opts: { start?: number; active?: number; ci?: boolean } = {}
): { html: string; next: number } {
	const { start = 0, active = -1, ci = true } = opts;
	let idx = start;
	let src = html;
	for (const hl of terms) {
		if (!hl) continue;
		const escaped = hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		src = src.replace(new RegExp(escaped, ci ? 'gi' : 'g'), (m) => {
			const activeNow = idx === active;
			idx++;
			return activeNow ? `<mark class="mark-active">${m}</mark>` : `<mark>${m}</mark>`;
		});
	}
	return { html: src, next: idx };
}
