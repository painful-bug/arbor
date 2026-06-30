// Global search engine — pure state + matching, no viewport dependency.
// Canvas.svelte owns the swoop (it has the useSvelteFlow() hook) and reacts to
// `searchState.cursor`/`searchState.matches`; node components read
// `searchHighlight` to <mark> the matched word on their face.
import type { Node } from '@xyflow/svelte';
import { flow, currentCanvasId } from './store.svelte';
import { kbSearchHits } from '$lib/ai/client';

// One Match per occurrence (local) or per file node (deep RAG hit). `ordInNode` is the
// occurrence's index within its node, counted over the node's visible segments in render
// order — so the focused card can colour exactly that occurrence. RAG hits use -1 (deep
// content not on the face: focus only, no active mark).
export interface Match {
	nodeId: string;
	ordInNode: number;
	kind: 'local' | 'rag';
	page?: number; // rag hits: source page, for deep-linking into the preview
}

export const searchState = $state<{
	open: boolean;
	query: string;
	matches: Match[];
	cursor: number;
	ragLoading: boolean;
}>({ open: false, query: '', matches: [], cursor: 0, ragLoading: false });

export const searchHighlight = $state<{ nodeId: string | null; terms: string[]; activeOrd: number }>(
	{ nodeId: null, terms: [], activeOrd: -1 }
);

// Set when the active match is deep file content (rag) with a known page: Canvas
// reacts by opening that file's preview and PdfViewer scrolls to the page. `seq`
// bumps on every request so re-focusing the same hit re-triggers the effect.
export const deepLink = $state<{ nodeId: string | null; page: number; query: string; seq: number }>(
	{ nodeId: null, page: 0, query: '', seq: 0 }
);

// Visible segments per node type, in the SAME order the card renders them — so an
// occurrence ordinal lines up with the rendered <mark> sequence. Only face-visible
// text (cards: title + latest answer) so the "N of M" counter matches what's highlighted.
function segmentsOf(n: Node): string[] {
	const d = n.data as Record<string, unknown>;
	if (n.type === 'card') {
		const turns = (d.turns as { answer?: string }[] | undefined) ?? [];
		const lastAnswer = turns.length ? (turns[turns.length - 1].answer ?? '') : '';
		return [(d.title as string) ?? '', lastAnswer];
	}
	if (n.type === 'text') return [(d.text as string) ?? ''];
	if (n.type === 'file') return [(d.filename as string) ?? '', (d.preview as string) ?? ''];
	if (n.type === 'web') return [(d.title as string) ?? '', (d.url as string) ?? ''];
	return [];
}

function countOcc(haystack: string, needle: string): number {
	if (!needle) return 0;
	const h = haystack.toLowerCase();
	const n = needle.toLowerCase();
	let i = 0;
	let c = 0;
	while ((i = h.indexOf(n, i)) !== -1) {
		c++;
		i += n.length;
	}
	return c;
}

function clearHighlight() {
	searchHighlight.nodeId = null;
	searchHighlight.terms = [];
	searchHighlight.activeOrd = -1;
}

export function focus(idx: number): void {
	const m = searchState.matches;
	if (!m.length) {
		clearHighlight();
		return;
	}
	const i = ((idx % m.length) + m.length) % m.length;
	searchState.cursor = i;
	const id = m[i].nodeId;
	flow.selected = id;
	searchHighlight.nodeId = id;
	searchHighlight.terms = [searchState.query.trim()];
	searchHighlight.activeOrd = m[i].ordInNode;

	// Deep file-content hit with a page → ask Canvas to open the preview at that page.
	if (m[i].kind === 'rag' && m[i].page) {
		deepLink.nodeId = id;
		deepLink.page = m[i].page!;
		deepLink.query = searchState.query.trim();
		deepLink.seq++;
	}
}

export function next(): void {
	focus(searchState.cursor + 1);
}
export function prev(): void {
	focus(searchState.cursor - 1);
}

function runLocal(q: string): void {
	if (searchState.query.trim() !== q) return;
	const matches: Match[] = [];
	for (const n of flow.nodes) {
		if (n.type === 'group') continue;
		let ord = 0;
		for (const seg of segmentsOf(n)) {
			const c = countOcc(seg, q);
			for (let i = 0; i < c; i++) matches.push({ nodeId: n.id, ordInNode: ord++, kind: 'local' });
		}
	}
	searchState.matches = matches;
	searchState.cursor = 0;
	if (matches.length) focus(0);
	else clearHighlight();
}

async function runRag(q: string): Promise<void> {
	if (searchState.query.trim() !== q) return;
	searchState.ragLoading = true;
	const hits = await kbSearchHits(currentCanvasId() || 'default', q, 8);
	searchState.ragLoading = false;
	if (searchState.query.trim() !== q) return;

	// Append deep file-content hits whose file node isn't already matched locally.
	const already = new Set(searchState.matches.map((m) => m.nodeId));
	const extra: Match[] = [];
	for (const h of hits) {
		const node = flow.nodes.find(
			(n) => n.type === 'file' && (n.data as Record<string, unknown>).filename === h.source
		);
		if (!node || already.has(node.id)) continue;
		already.add(node.id);
		extra.push({ nodeId: node.id, ordInNode: -1, kind: 'rag', page: h.page });
	}
	if (!extra.length) return;
	const hadNone = searchState.matches.length === 0;
	searchState.matches = [...searchState.matches, ...extra];
	if (hadNone) focus(0);
}

let localTimer: ReturnType<typeof setTimeout>;
let ragTimer: ReturnType<typeof setTimeout>;

export function rebuild(query: string): void {
	searchState.query = query;
	clearTimeout(localTimer);
	clearTimeout(ragTimer);
	const q = query.trim();
	if (!q) {
		searchState.matches = [];
		searchState.cursor = 0;
		clearHighlight();
		return;
	}
	localTimer = setTimeout(() => runLocal(q), 120);
	ragTimer = setTimeout(() => void runRag(q), 260);
}

export function openSearch(): void {
	searchState.open = true;
}

export function closeSearch(): void {
	clearTimeout(localTimer);
	clearTimeout(ragTimer);
	searchState.open = false;
	searchState.query = '';
	searchState.matches = [];
	searchState.cursor = 0;
	searchState.ragLoading = false;
	clearHighlight();
	deepLink.nodeId = null;
}
