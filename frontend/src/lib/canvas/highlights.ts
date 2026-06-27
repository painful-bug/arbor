// Shared utilities for localStorage-persisted highlights and text-mark rendering.

export function loadHL<T>(key: string): T[] {
	try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

export function saveHL<T>(key: string, value: T[]): void {
	try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

// Wrap every occurrence of each mark string in <mark>…</mark> within rendered HTML.
// ponytail: string-match; switch to Range/offset anchoring if marks need to survive edits.
export function applyTextHL(html: string, marks: string[]): string {
	let src = html;
	for (const hl of marks) {
		if (!hl) continue;
		const escaped = hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		src = src.replace(new RegExp(escaped, 'g'), `<mark>${hl}</mark>`);
	}
	return src;
}
