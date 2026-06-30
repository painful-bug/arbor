// Realtime semantic auto-linking. As cards/notes/files are created or edited, the
// backend embeds the node's text and returns its nearest other nodes; we draw a
// dashed "semantic" edge between them. Background, debounced, toggleable.
//
// Edges are stored in flow.edges like any other edge (so they persist + undo for
// free) but carry `data.auto = true` so they can be told apart from manual/branch
// edges and reconciled independently.
import type { Edge } from '@xyflow/svelte';
import { flow, settings, currentCanvasId, snippetOf } from './store.svelte';
import { kbRelate } from '$lib/ai/client';

const MAX_DEGREE = 2; // ponytail: 2 keeps graph sparse; raise only if canvas feels disconnected
const DEBOUNCE_MS = 1500;
const ELIGIBLE = new Set(['card', 'text', 'file']);

// Undirected, deterministic id so the same pair never produces two edges.
export function semEdgeId(a: string, b: string): string {
	const [lo, hi] = a < b ? [a, b] : [b, a];
	return `sem:${lo}:${hi}`;
}

export function isSemanticEdge(e: Edge): boolean {
	return !!(e.data as { auto?: boolean } | undefined)?.auto;
}

function makeSemEdge(a: string, b: string): Edge {
	const [lo, hi] = a < b ? [a, b] : [b, a];
	return {
		id: semEdgeId(a, b),
		source: lo,
		target: hi,
		type: 'bezier',
		data: { auto: true },
		// Color resolves per theme via the CSS var (light: violet, dark: light violet).
		style: 'stroke: var(--c-edge-semantic); stroke-width: 1; stroke-dasharray: 3 10; opacity: 0.45;'
	};
}

// Pure edge diff for a single node. Only auto edges *touching this node* are
// changed; manual/branch edges and other nodes' auto edges are preserved verbatim.
export function reconcileSemanticEdges(
	nodeId: string,
	neighborIds: string[],
	edges: Edge[]
): Edge[] {
	const targets = neighborIds.filter((id) => id && id !== nodeId).slice(0, MAX_DEGREE);
	const desired = new Set(targets.map((nb) => semEdgeId(nodeId, nb)));

	const kept = edges.filter((e) => {
		if (!isSemanticEdge(e)) return true; // manual / branch edge
		const touches = e.source === nodeId || e.target === nodeId;
		if (!touches) return true; // another node's auto edge
		return desired.has(e.id); // ours — keep only if still a neighbor
	});

	const existing = new Set(kept.map((e) => e.id));
	const added = targets
		.map((nb) => semEdgeId(nodeId, nb))
		.filter((id) => !existing.has(id))
		.map((id) => {
			const [, lo, hi] = id.split(':');
			return makeSemEdge(lo, hi);
		});

	return [...kept, ...added];
}

// The KB source id a node was indexed under (see store: file→filename,
// note→text:id, card→chat:id). Used to exclude the node from its own results.
function sourceOf(node: { id: string; type?: string; data: Record<string, unknown> }): string {
	if (node.type === 'file') return (node.data.filename as string) ?? '';
	return `${node.type === 'text' ? 'text' : 'chat'}:${node.id}`;
}

// Reverse: map a KB source back to an on-canvas node id (or undefined if gone).
function nodeIdForSource(source: string): string | undefined {
	const m = source.match(/^(?:text|chat|card):(.+)$/);
	if (m) return m[1];
	const f = flow.nodes.find((n) => n.type === 'file' && (n.data as { filename?: string }).filename === source);
	return f?.id;
}

// True when a non-semantic edge already connects the two nodes.
function hasManualEdge(a: string, b: string, edges: Edge[]): boolean {
	return edges.some(
		(e) =>
			!isSemanticEdge(e) &&
			((e.source === a && e.target === b) || (e.source === b && e.target === a))
	);
}

function eligible(n: { type?: string; data: Record<string, unknown> }): boolean {
	return ELIGIBLE.has(n.type ?? '') && !!snippetOf(n as Parameters<typeof snippetOf>[0]).trim();
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Debounced per node — coalesces bursts (typing, rapid file drops). The backend's
// embed queue serializes the actual work, so a backfill of many nodes is safe.
export function scheduleAutolink(nodeId: string): void {
	if (!settings.autoConnect) return;
	clearTimeout(timers.get(nodeId));
	timers.set(
		nodeId,
		setTimeout(() => {
			timers.delete(nodeId);
			void runAutolink(nodeId);
		}, DEBOUNCE_MS)
	);
}

// Re-link every eligible node — used on canvas load and when the toggle is enabled,
// so pre-existing cards/notes/files get connected, not just newly created ones.
export function autolinkAll(): void {
	if (!settings.autoConnect) return;
	for (const n of flow.nodes) if (eligible(n)) scheduleAutolink(n.id);
}

async function runAutolink(nodeId: string): Promise<void> {
	if (!settings.autoConnect) return;
	const node = flow.nodes.find((n) => n.id === nodeId);
	if (!node || !eligible(node)) return;
	if (flow.nodes.filter(eligible).length < 2) return; // nothing to link to

	const text = snippetOf(node);
	const canvas = currentCanvasId() || 'default';
	const neighbors = await kbRelate(canvas, text, { exclude: sourceOf(node), k: MAX_DEGREE, minScore: 0.70 });

	// Re-check after the await: the toggle may have flipped or the node been deleted.
	if (!settings.autoConnect || !flow.nodes.some((n) => n.id === nodeId)) return;

	const present = new Set(flow.nodes.map((n) => n.id));
	const neighborIds = neighbors
		.map((nb) => nodeIdForSource(nb.source))
		.filter((id): id is string => !!id && id !== nodeId && present.has(id))
		.filter((id) => !hasManualEdge(nodeId, id, flow.edges)); // skip already-connected pairs

	const next = reconcileSemanticEdges(nodeId, neighborIds, flow.edges);
	const changed =
		next.length !== flow.edges.length || next.some((e, i) => e.id !== flow.edges[i]?.id);
	if (changed) flow.edges = next;
}
