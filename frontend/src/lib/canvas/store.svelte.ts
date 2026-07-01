// Canvas state: nodes/edges for Svelte Flow + actions to grow the tree.
import type { Node, Edge, XYPosition } from '@xyflow/svelte';
import {
	runAgent,
	kbRemove,
	PROVIDERS,
	type Provider,
	type ChatMessage,
	type AgentEvent
} from '$lib/ai/client';
import { workflowSystemPrompt } from '$lib/ai/workflows';
import { apiJson, apiPut, apiFetch } from '$lib/api';

// One exchange in a card's conversation: user prompt → agent answer + its timeline.
export interface Turn {
	prompt: string;
	answer: string;
	events: AgentEvent[]; // streamed tool calls + reasoning for this turn
}

export interface CardData {
	title: string; // card header = first turn's prompt
	turns: Turn[]; // the conversation (>=1)
	streaming: boolean;
	block: string; // pastel block name (lime|lilac|cream|pink|mint|coral)
	quote?: string; // highlighted excerpt this card branched from
	workflow?: string; // research workflow id this card runs under
	[key: string]: unknown;
}

// Last turn helper — the one being streamed / replied to.
export const lastTurn = (d: CardData): Turn => d.turns[d.turns.length - 1];

const BLOCKS = ['lime', 'lilac', 'cream', 'pink', 'mint', 'coral'];
let blockIdx = 0;

// ── Tool state (shared by toolbar + canvas) ──────────────────────────────────
export type Tool = 'hand' | 'select' | 'text' | 'duplicate' | 'connect' | 'color';
export const tool = $state<{ active: Tool; connectFrom: string | null }>({
	active: 'hand',
	connectFrom: null
});
let idCounter = 0;
const nextId = () => `n${++idCounter}`;

export const flow = $state<{ nodes: Node[]; edges: Edge[]; selected: string | null }>({
	nodes: [],
	edges: [],
	selected: null
});

// Hub session: canvas-wide agent chat (active when no card is selected).
export const session = $state<{ turns: Turn[]; streaming: boolean }>({
	turns: [],
	streaming: false
});

// ── Multi-canvas persistence ────────────────────────────────────────────────
// All canvases/settings live in the backend (SQLite); we reach it over HTTP.
// Writes are fire-and-forget (the in-memory `flow` is the source of truth during a
// session; persistence is backup), matching the old fire-and-forget Tauri commands.
interface CanvasMeta {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}
interface CanvasDoc extends CanvasMeta {
	nodes: Node[];
	edges: Edge[];
	session?: Turn[];
}
interface CanvasIndex {
	current: string;
	list: CanvasMeta[];
}

// Reactive registry + view state the Library/Sidebar bind to.
export const library = $state<{ list: CanvasMeta[] }>({ list: [] });
export const ui = $state<{ view: 'canvas' | 'library'; sidebarExpanded: boolean }>({
	view: 'canvas',
	sidebarExpanded: false
});
let currentId = '';
export const currentCanvasId = () => currentId;

const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

async function readIndex(): Promise<CanvasIndex> {
	return apiJson<CanvasIndex>('/api/canvases');
}

function writeIndex(current: string, list: CanvasMeta[]): void {
	void apiPut('/api/canvases', { current, list });
}

// In-memory doc cache: populated on load/write so Library.svelte can show previews sync.
const _docCache = new Map<string, CanvasDoc>();

async function loadDoc(id: string): Promise<CanvasDoc | null> {
	try {
		const doc = await apiJson<CanvasDoc>(`/api/canvases/${id}`);
		_docCache.set(id, doc);
		return doc;
	} catch {
		return null; // 404 (deleted/never-written) or backend unreachable
	}
}

// Synchronous doc lookup from cache — used by Library for thumbnails without await.
export function getCachedDoc(id: string): CanvasDoc | null {
	return _docCache.get(id) ?? null;
}

function writeDoc(doc: CanvasDoc): void {
	_docCache.set(doc.id, doc);
	void apiPut(`/api/canvases/${doc.id}`, doc);
}

// Normalize loaded nodes: clear mid-stream flags, migrate pre-thread Q→A cards.
function normalize(nodes: Node[]): Node[] {
	for (const n of nodes ?? []) {
		if (n.data && n.data.streaming) n.data.streaming = false;
		// Height is always content-driven; width persists so user-resized cards restore.
		if (n.type === 'card' || n.type === 'file') {
			if (!n.width) n.width = 400;
			delete n.height;
		}
		if (n.data && n.type === 'card' && !Array.isArray(n.data.turns)) {
			n.data.title = n.data.title ?? n.data.prompt ?? '';
			n.data.turns = [
				{
					prompt: n.data.prompt ?? '',
					answer: n.data.answer ?? '',
					events: Array.isArray(n.data.events) ? n.data.events : []
				}
			];
			delete n.data.prompt;
			delete n.data.answer;
			delete n.data.events;
		}
	}
	return nodes ?? [];
}

function applyDoc(doc: CanvasDoc | null): void {
	// Reset undo history on canvas switch; lock prevents effect from double-pushing.
	history.length = 0;
	histPtr = -1;
	_histLock = true;

	const nodes = normalize(doc?.nodes ?? []);
	flow.nodes = nodes;
	flow.edges = doc?.edges ?? [];
	flow.selected = null;
	session.turns = doc?.session ?? [];
	session.streaming = false;
	idCounter = 0;
	for (const n of nodes) {
		const num = parseInt(String(n.id).replace(/\D/g, ''), 10);
		if (!isNaN(num) && num > idCounter) idCounter = num;
	}
	// Capture loaded state as first undo snapshot after effects settle.
	setTimeout(() => {
		_histLock = false;
		pushHistory();
		// Backfill: link any nodes that aren't semantically connected yet.
		if (settings.autoConnect) {
			void import('./autolink').then((m) => m.autolinkAll()).catch(() => {});
		}
	}, 10);
}

function newDoc(name: string): CanvasDoc {
	const now = Date.now();
	return { id: uid(), name, createdAt: now, updatedAt: now, nodes: [], edges: [] };
}

export async function init(): Promise<void> {
	// Backend already migrated any legacy JSON into SQLite on boot.
	const stored = await readIndex();

	if (!stored.list.length) {
		// Fresh install — create default canvas.
		const doc = newDoc('Canvas 1');
		writeDoc(doc);
		const meta = { id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
		library.list = [meta];
		writeIndex(doc.id, [meta]);
		currentId = doc.id;
		applyDoc(doc);
		await loadSettingsAsync();
		return;
	}

	library.list = stored.list;
	currentId = stored.list.some((c) => c.id === stored.current)
		? stored.current
		: stored.list[0].id;

	applyDoc(await loadDoc(currentId));
	await loadSettingsAsync();
}

// Persist the active canvas's current nodes/edges/session + bump its updatedAt.
export function saveCanvas(): void {
	if (!currentId) return;
	const meta = library.list.find((c) => c.id === currentId);
	if (!meta) return;
	const now = Date.now();
	writeDoc({ ...meta, updatedAt: now, nodes: flow.nodes, edges: flow.edges, session: session.turns });
	library.list = library.list.map((c) => (c.id === currentId ? { ...c, updatedAt: now } : c));
	writeIndex(currentId, library.list);
}

export function newCanvas(name?: string): string {
	saveCanvas();
	const doc = newDoc(name || `Canvas ${library.list.length + 1}`);
	writeDoc(doc);
	library.list = [{ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt }, ...library.list];
	writeIndex(doc.id, library.list);
	currentId = doc.id;
	applyDoc(doc);
	return doc.id;
}

export async function switchCanvas(id: string): Promise<void> {
	if (id === currentId) return;
	saveCanvas();
	currentId = id;
	writeIndex(currentId, library.list);
	applyDoc(await loadDoc(id));
}

export async function renameCanvas(id: string, name: string): Promise<void> {
	const trimmed = name.trim();
	if (!trimmed) return;
	library.list = library.list.map((c) => (c.id === id ? { ...c, name: trimmed } : c));
	writeIndex(currentId, library.list);
	const doc = await loadDoc(id);
	if (doc) writeDoc({ ...doc, name: trimmed });
}

export async function deleteCanvas(id: string): Promise<void> {
	void apiFetch(`/api/canvases/${id}`, { method: 'DELETE' });
	// Drop this canvas's whole RAG index (clearCanvas → dropTable). ponytail: orphaned
	// per-canvas blobs are left on disk; cheap to ignore vs. listing every file node.
	void apiFetch(`/api/rag/${encodeURIComponent(id)}/files`, { method: 'DELETE' });
	library.list = library.list.filter((c) => c.id !== id);
	writeIndex(currentId, library.list);
	if (currentId === id) {
		currentId = '';
		if (!library.list.length) newCanvas('Canvas 1');
		else await switchCanvas(library.list[0].id);
	}
}

// ── Undo / redo ──────────────────────────────────────────────────────────────
// ponytail: full-doc snapshots, not per-op diffs. Fine to thousands of nodes;
// switch to a command/diff log only if snapshot size becomes measurable.

const history: { nodes: Node[]; edges: Edge[] }[] = [];
let histPtr = -1;
let _histLock = false;

export function pushHistory(): void {
	if (_histLock) return;
	const snap = JSON.parse(JSON.stringify({ nodes: flow.nodes, edges: flow.edges })) as {
		nodes: Node[];
		edges: Edge[];
	};
	// Skip if nothing changed since last snapshot.
	if (histPtr >= 0 && JSON.stringify(history[histPtr]) === JSON.stringify(snap)) return;
	history.splice(histPtr + 1); // drop redo tail
	history.push(snap);
	if (history.length > 50) history.shift();
	histPtr = history.length - 1;
}

export function undo(): void {
	if (histPtr <= 0) return;
	histPtr--;
	_histLock = true;
	const snap = history[histPtr];
	flow.nodes = JSON.parse(JSON.stringify(snap.nodes));
	flow.edges = JSON.parse(JSON.stringify(snap.edges));
	flow.selected = null;
	saveCanvas();
	setTimeout(() => { _histLock = false; }, 500); // past the 400ms save debounce
}

export function redo(): void {
	if (histPtr >= history.length - 1) return;
	histPtr++;
	_histLock = true;
	const snap = history[histPtr];
	flow.nodes = JSON.parse(JSON.stringify(snap.nodes));
	flow.edges = JSON.parse(JSON.stringify(snap.edges));
	flow.selected = null;
	saveCanvas();
	setTimeout(() => { _histLock = false; }, 500);
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_MODELS = Object.fromEntries(
	PROVIDERS.map((p) => [p.id, p.defaultModel])
) as Record<Provider, string>;

const VALID_PROVIDERS = new Set(PROVIDERS.map((p) => p.id));

// Model ladder: tried in order, falls back to the next rung on rate-limit.
// Gemini first (generous free tier), then fast/cheap inference, then the rest.
export const DEFAULT_LADDER: Provider[] = ['google', 'nim', 'groq', 'openrouter', 'anthropic', 'openai', 'ollama'];

interface Settings {
	providerLadder: Provider[];
	models: Record<Provider, string>;
	workflow: string;
	bashEnabled: boolean;
	websearch: { enabled: boolean; backend: 'duckduckgo' | 'tavily' };
	snapToGrid: boolean;
	autoConnect: boolean;
	theme: 'light' | 'dark';
	clusterSpacing: number; // Clean Up inter-cluster gutter (avg-radius units)
	autoCleanup: { enabled: boolean; intervalMin: number }; // periodic Clean Up (Cmd-C) while canvas open
}

const FALLBACK_SETTINGS: Settings = {
	providerLadder: [...DEFAULT_LADDER],
	models: { ...DEFAULT_MODELS },
	workflow: 'general',
	bashEnabled: false,
	websearch: { enabled: false, backend: 'duckduckgo' },
	snapToGrid: false,
	autoConnect: true,
	theme: 'dark',
	clusterSpacing: 8,
	autoCleanup: { enabled: false, intervalMin: 30 },
};

const LS_KEY = 'arbor:settings';
export const settings = $state<Settings>({ ...FALLBACK_SETTINGS, models: { ...DEFAULT_MODELS } });

// {provider, model} ladder ready to send to the backend, in user-chosen order.
export function activeLadder(): { provider: Provider; model: string }[] {
	return settings.providerLadder.map((provider) => ({
		provider,
		model: settings.models[provider] || DEFAULT_MODELS[provider]
	}));
}

function applySettings(p: Record<string, unknown>): void {
	if (Array.isArray(p.providerLadder)) {
		const ladder = p.providerLadder.filter(
			(x, i, arr): x is Provider => typeof x === 'string' && VALID_PROVIDERS.has(x as Provider) && arr.indexOf(x) === i
		);
		if (ladder.length) settings.providerLadder = ladder;
	} else if (typeof p.provider === 'string' && VALID_PROVIDERS.has(p.provider as Provider)) {
		// Legacy single-provider settings — migrate to a one-rung ladder.
		settings.providerLadder = [p.provider as Provider];
	}
	if (p.models && typeof p.models === 'object') {
		const m = p.models as Record<string, string>;
		for (const k of Object.keys(m)) {
			if (VALID_PROVIDERS.has(k as Provider)) settings.models[k as Provider] = m[k];
		}
	}
	if (typeof p.workflow === 'string') settings.workflow = p.workflow;
	if (typeof p.bashEnabled === 'boolean') settings.bashEnabled = p.bashEnabled;
	if (p.websearch && typeof p.websearch === 'object') {
		const ws = p.websearch as Record<string, unknown>;
		if (typeof ws.enabled === 'boolean') settings.websearch.enabled = ws.enabled;
		if (ws.backend === 'duckduckgo' || ws.backend === 'tavily') settings.websearch.backend = ws.backend;
	}
	if (typeof p.snapToGrid === 'boolean') settings.snapToGrid = p.snapToGrid;
	if (typeof p.autoConnect === 'boolean') settings.autoConnect = p.autoConnect;
	if (p.theme === 'light' || p.theme === 'dark') settings.theme = p.theme;
	if (typeof p.clusterSpacing === 'number' && p.clusterSpacing >= 0)
		settings.clusterSpacing = p.clusterSpacing;
	if (p.autoCleanup && typeof p.autoCleanup === 'object') {
		const ac = p.autoCleanup as Record<string, unknown>;
		if (typeof ac.enabled === 'boolean') settings.autoCleanup.enabled = ac.enabled;
		if (typeof ac.intervalMin === 'number' && ac.intervalMin >= 1)
			settings.autoCleanup.intervalMin = ac.intervalMin;
	}
}

// Apply any localStorage-cached settings immediately (synchronous, before backend responds).
try {
	const raw = typeof localStorage !== 'undefined' && localStorage.getItem(LS_KEY);
	if (raw) applySettings(JSON.parse(raw) as Record<string, unknown>);
} catch {}

async function loadSettingsAsync(): Promise<void> {
	let p: Record<string, unknown> | null = null;
	try { p = await apiJson<Record<string, unknown> | null>('/api/settings'); } catch { return; }
	if (!p) return; // none saved yet — keep defaults
	try {
		applySettings(p);
		// Keep localStorage in sync with backend's authoritative copy.
		if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(p));
	} catch {}
}

export function persistSettings(): void {
	const payload = {
		providerLadder: [...settings.providerLadder],
		models: { ...settings.models },
		workflow: settings.workflow,
		bashEnabled: settings.bashEnabled,
		websearch: { ...settings.websearch },
		snapToGrid: settings.snapToGrid,
		autoConnect: settings.autoConnect,
		theme: settings.theme,
		clusterSpacing: settings.clusterSpacing,
		autoCleanup: { ...settings.autoCleanup },
	};
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(payload));
	} catch {}
	void apiPut('/api/settings', payload);
}

// ── Semantic auto-linking ─────────────────────────────────────────────────────
// Dynamic import breaks the store↔autolink cycle (autolink imports this module).
function triggerAutolink(nodeId: string): void {
	if (!settings.autoConnect) return;
	void import('./autolink').then((m) => m.scheduleAutolink(nodeId)).catch(() => {});
}

// Remove every auto semantic edge across all canvases (current + stored docs).
// Called when the user turns the feature off and chooses to drop existing links.
export async function purgeSemanticEdges(): Promise<void> {
	const isAuto = (e: Edge) => !!(e.data as { auto?: boolean } | undefined)?.auto;
	flow.edges = flow.edges.filter((e) => !isAuto(e));
	saveCanvas();
	for (const meta of library.list) {
		if (meta.id === currentId) continue;
		const doc = await loadDoc(meta.id);
		if (!doc) continue;
		const edges = (doc.edges ?? []).filter((e) => !isAuto(e));
		if (edges.length !== (doc.edges?.length ?? 0)) writeDoc({ ...doc, edges });
	}
}

// ── Canvas actions ───────────────────────────────────────────────────────────

export function addCard(
	position: XYPosition,
	prompt: string,
	opts: { parentId?: string; quote?: string; workflow?: string } = {}
): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const data: CardData = {
		title: prompt,
		turns: [{ prompt, answer: '', events: [] }],
		streaming: true,
		block,
		quote: opts.quote,
		workflow: opts.workflow ?? settings.workflow
	};
	flow.nodes = [...flow.nodes, { id, type: 'card', position, data, width: 400 }];
	if (opts.parentId) {
		flow.edges = [
			...flow.edges,
			{
				id: `e-${opts.parentId}-${id}`,
				source: opts.parentId,
				target: id,
				type: 'bezier',
				animated: true
			}
		];
	}
	return id;
}

// Write the streamed answer into the card's last (active) turn.
function setTurnAnswer(id: string, answer: string, streaming: boolean): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[])];
		turns[turns.length - 1] = { ...turns[turns.length - 1], answer };
		return { ...n, data: { ...n.data, turns, streaming } };
	});
}

// Append a follow-up turn to an existing card and run it. Drives multi-turn chat.
export function continueCard(id: string, prompt: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[]), { prompt, answer: '', events: [] }];
		return { ...n, data: { ...n.data, turns, streaming: true } };
	});
	void runModel(id);
}

// Re-run the last turn from scratch (clears its answer + events).
export function retryCard(id: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = n.data.turns as Turn[];
		const last = turns[turns.length - 1];
		const fresh = [...turns.slice(0, -1), { prompt: last.prompt, answer: '', events: [] }];
		return { ...n, data: { ...n.data, turns: fresh, streaming: true } };
	});
	void runModel(id);
}

// Web embed card: an interactive iframe of a URL pasted/dropped/clicked onto the canvas.
interface WebData {
	url: string;
	title?: string;
	block: string;
	[key: string]: unknown;
}

export function addWebCard(position: XYPosition, url: string, opts: { parentId?: string } = {}): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const data: WebData = { url, block };
	flow.nodes = [...flow.nodes, { id, type: 'web', position, data, width: 480, height: 560 }];
	if (opts.parentId) {
		flow.edges = [
			...flow.edges,
			{ id: `e-${opts.parentId}-${id}`, source: opts.parentId, target: id, type: 'bezier' }
		];
	}
	return id;
}

// Normalized highlight rect for a PDF page (coords 0–1 relative to page box).
export interface PdfHL {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string;   // CSS color string, e.g. 'rgba(255,222,89,0.45)'
	text?: string;   // selected text content, used for Send-to-chat
}

// File card on the canvas: shows a preview of a dropped file + indexing progress.
export interface FileData {
	filename: string;
	status: 'indexing' | 'ready' | 'error';
	block: string;
	mime: string;
	kind: import('$lib/files').FileKind;
	path?: string;
	preview?: string;
	highlights?: PdfHL[];
	[key: string]: unknown;
}

export function addFileCard(
	position: XYPosition,
	filename: string,
	opts: { mime?: string; kind?: FileData['kind']; path?: string } = {}
): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const data: FileData = {
		filename,
		status: 'indexing',
		block,
		mime: opts.mime ?? '',
		kind: opts.kind ?? 'other',
		path: opts.path
	};
	flow.nodes = [...flow.nodes, { id, type: 'file', position, data, width: 220, height: 280 }];
	return id;
}

export function setFileStatus(id: string, status: FileData['status']): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, status } } : n
	);
}

export function setFilePreview(id: string, preview: string): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, preview } } : n
	);
}

export function setFileHighlights(id: string, highlights: PdfHL[]): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, highlights } } : n
	);
}

// ── Text card (user markdown note) ───────────────────────────────────────────
export interface TextData {
	text: string;
	block: string;
	[key: string]: unknown;
}

// A cluster label dropped by the user after Clean Up. `anchor` is the member ids of
// the cluster it names — the tag floats above their bounding box and follows them as
// the spacing slider moves or cards are dragged.
export interface TagData {
	text: string;
	anchor: string[];
	[key: string]: unknown;
}

export function addTextCard(position: XYPosition, text = ''): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const data: TextData = { text, block };
	flow.nodes = [...flow.nodes, { id, type: 'text', position, data, width: 320 }];
	return id;
}

const _textIndexTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function setCardText(id: string, text: string): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, text } } : n
	);
	// Debounce KB indexing so we don't re-embed on every keystroke
	const prev = _textIndexTimers.get(id);
	if (prev) clearTimeout(prev);
	_textIndexTimers.set(id, setTimeout(() => {
		_textIndexTimers.delete(id);
		if (text.trim()) {
			void indexTextCard(id, text);
		}
	}, 2000));
}

async function indexTextCard(cardId: string, text: string): Promise<void> {
	const { kbAdd } = await import('$lib/ai/client');
	const canvas = currentCanvasId() || 'default';
	const bytes = new TextEncoder().encode(text);
	await kbAdd(canvas, `text:${cardId}`, 'text/plain', bytes.buffer as ArrayBuffer).catch(() => {});
	triggerAutolink(cardId);
}

function setCardBlock(id: string, block: string): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, block } } : n
	);
}

export function cycleCardBlock(id: string): void {
	const n = flow.nodes.find((node) => node.id === id);
	if (!n) return;
	const cur = (n.data as { block?: string }).block ?? 'lime';
	const next = BLOCKS[(BLOCKS.indexOf(cur) + 1) % BLOCKS.length];
	setCardBlock(id, next);
}

export function duplicateNode(id: string): string {
	const src = flow.nodes.find((n) => n.id === id);
	if (!src) return '';
	const newId = nextId();
	const data = JSON.parse(JSON.stringify(src.data)) as Record<string, unknown>;
	if ('streaming' in data) data.streaming = false;
	const srcW = (src as Node & { measured?: { width?: number } }).measured?.width ?? src.width ?? 400;
	// Place beside original — don't spread src to avoid copying SvelteFlow internals
	const node: Node = {
		id: newId,
		type: src.type ?? 'card',
		position: { x: src.position.x + srcW + 40, y: src.position.y },
		data,
		width: src.width
	};
	if (src.height != null) node.height = src.height;
	flow.nodes = [...flow.nodes, node];
	return newId;
}

export function duplicateSelected(): void {
	const selected = flow.nodes.filter((n) => n.selected);
	if (!selected.length) return;
	const newNodes: Node[] = selected.map((src) => {
		const newId = nextId();
		const data = JSON.parse(JSON.stringify(src.data)) as Record<string, unknown>;
		if ('streaming' in data) data.streaming = false;
		const srcW = (src as Node & { measured?: { width?: number } }).measured?.width ?? src.width ?? 400;
		const node: Node = {
			id: newId,
			type: src.type ?? 'card',
			position: { x: src.position.x + srcW + 40, y: src.position.y },
			data,
			width: src.width,
			selected: true
		};
		if (src.height != null) node.height = src.height;
		return node;
	});
	flow.nodes = [...flow.nodes.map((n) => ({ ...n, selected: false })), ...newNodes];
}

// Purge a removed file node's RAG chunks + stored blob. Idempotent, so it's safe to
// call from every delete path. Dynamic import of files.ts avoids a static store↔files cycle.
function cleanupRemovedNodes(ids: Set<string>): void {
	const fileNodes = flow.nodes.filter(
		(n) => ids.has(n.id) && n.type === 'file'
	);
	if (!fileNodes.length) return;
	void import('$lib/files').then(({ deleteFileBlob }) => {
		for (const n of fileNodes) {
			const filename = (n.data as { filename?: string }).filename;
			if (filename) void kbRemove(currentId, filename);
			deleteFileBlob(n.id);
		}
	});
}

export function deleteSelected(): void {
	const toDelete = new Set(flow.nodes.filter((n) => n.selected).map((n) => n.id));
	if (!toDelete.size) return;
	cleanupRemovedNodes(toDelete);
	flow.edges = flow.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
	flow.nodes = flow.nodes.filter((n) => !toDelete.has(n.id));
}

export function addManualEdge(
	source: string,
	target: string,
	sourceHandle: string,
	targetHandle: string
): void {
	const id = `e-${source}-${target}-${Date.now()}`;
	flow.edges = [
		...flow.edges,
		{ id, source, target, sourceHandle, targetHandle, type: 'bezier' }
	];
}

// ── Edge side-anchoring ───────────────────────────────────────────────────────
// All card types share one handle convention: top-s/top-t … left-s/left-t.
const SIDE_HANDLE_RE = /^(top|right|bottom|left)-(s|t)$/;

export function nodeCenter(n: {
	position: { x: number; y: number };
	measured?: { width?: number; height?: number };
	width?: number;
	height?: number;
}): { x: number; y: number } {
	const w = n.measured?.width ?? n.width ?? 400;
	const h = n.measured?.height ?? n.height ?? 200;
	return { x: n.position.x + w / 2, y: n.position.y + h / 2 };
}

// The side of `from` that faces `to` — picked by the dominant axis between centers.
export function facingSide(from: { x: number; y: number }, to: { x: number; y: number }): string {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
}

// Re-anchor edges so each end attaches on the side facing the other card — no more
// bottom→top lines to a card that's actually off to the right. Only remaps the 4
// side handles (named or null from old saves); corner/custom handles are left as-is.
// `touched`: if given, only edges incident to those node ids are remapped.
export function remapEdgeSides(touched?: Set<string>): void {
	flow.edges = flow.edges.map((edge) => {
		if (touched && !touched.has(edge.source) && !touched.has(edge.target)) return edge;
		const src = flow.nodes.find((n) => n.id === edge.source);
		const tgt = flow.nodes.find((n) => n.id === edge.target);
		if (!src || !tgt) return edge;
		const sh = edge.sourceHandle;
		const th = edge.targetHandle;
		if ((sh != null && !SIDE_HANDLE_RE.test(sh)) || (th != null && !SIDE_HANDLE_RE.test(th)))
			return edge;
		const sc = nodeCenter(src);
		const tc = nodeCenter(tgt);
		return { ...edge, sourceHandle: facingSide(sc, tc) + '-s', targetHandle: facingSide(tc, sc) + '-t' };
	});
}

// ── Delete nodes ────────────────────────────────────────────────────────────
export function deleteNodes(ids: string[]): void {
	const idSet = new Set(ids);
	// Cascade: if deleting a group, also delete its children
	for (const n of flow.nodes) {
		if (n.parentId && idSet.has(n.parentId)) idSet.add(n.id);
	}
	cleanupRemovedNodes(idSet);
	flow.nodes = flow.nodes.filter((n) => !idSet.has(n.id));
	flow.edges = flow.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target));
}

// ── Group nodes ─────────────────────────────────────────────────────────────
// ponytail: parent-node approach — SvelteFlow handles drag-together natively.
interface GroupData { block: string; [key: string]: unknown }

export function groupNodes(ids: string[]): string {
	const selected = flow.nodes.filter((n) => ids.includes(n.id));
	if (selected.length < 2) return '';

	const PADDING = 28;
	const GAP = 24;
	const cols = Math.ceil(Math.sqrt(selected.length));
	const rows = Math.ceil(selected.length / cols);
	const cellW = Math.max(...selected.map((n) => n.width ?? 400));
	const cellH = 280;

	const groupW = PADDING * 2 + cols * cellW + (cols - 1) * GAP;
	const groupH = PADDING * 2 + rows * cellH + (rows - 1) * GAP;

	const avgX = selected.reduce((s, n) => s + n.position.x, 0) / selected.length;
	const avgY = selected.reduce((s, n) => s + n.position.y, 0) / selected.length;

	const groupId = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];

	const groupNode: Node = {
		id: groupId,
		type: 'group',
		position: { x: avgX - groupW / 2, y: avgY - groupH / 2 },
		data: { block } satisfies GroupData,
		width: groupW,
		height: groupH,
	};

	const idSet = new Set(ids);
	const rest = flow.nodes.filter((n) => !idSet.has(n.id));

	const reparented = selected.map((n, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		return {
			...n,
			parentId: groupId,
			position: {
				x: PADDING + col * (cellW + GAP),
				y: PADDING + row * (cellH + GAP),
			},
		};
	});

	// Group must appear before its children in the array
	flow.nodes = [...rest, groupNode, ...reparented];
	return groupId;
}

// ── Clean Up — semantic force-clustering ───────────────────────────────────

export function snippetOf(node: Node): string {
	const d = node.data as Record<string, unknown>;
	if (node.type === 'card') {
		const turns = d.turns as Turn[] | undefined;
		const title = (d.title as string) ?? '';
		const answer = turns?.length ? turns[0].answer?.slice(0, 200) : '';
		return `${title} ${answer}`.trim();
	}
	if (node.type === 'text') return ((d.text as string) ?? '').slice(0, 200);
	if (node.type === 'file') {
		const name = (d.filename as string) ?? '';
		const preview = (d.preview as string) ?? '';
		return `${name} ${preview.slice(0, 200)}`.trim();
	}
	if (node.type === 'web') return (d.title as string) ?? (d.url as string) ?? '';
	return '';
}

// Last Clean Up layout, cached so the spacing slider can re-place cards instantly
// (no re-embed). Keyed only implicitly by the current node set — invalidated when
// a referenced id is gone.
import type { ArrangeLayout } from '$lib/ai/client';
let cleanupLayout: ArrangeLayout | null = null;

// place(layout, gap) → pixel positions. Mirror of the backend helper; clusters are
// decoupled so a bigger gap just rescales the grid (ponytail: 4 lines, no shared pkg).
function placeLayout(layout: ArrangeLayout, gap: number): Record<string, { x: number; y: number }> {
	const cell = layout.cellBase + Math.max(0, gap) * layout.unit;
	const out: Record<string, { x: number; y: number }> = {};
	for (const id in layout.nodes) {
		const { col, row, lx, ly } = layout.nodes[id];
		out[id] = { x: Math.round(col * cell + lx), y: Math.round(row * cell + ly) };
	}
	return out;
}

// Apply a set of positions to the canvas and re-anchor the affected edges. Rebuilds
// moved nodes as fresh objects so SvelteFlow reacts (in-place mutation isn't picked up).
function applyPositions(positions: Record<string, { x: number; y: number }>): void {
	const moved = new Set(Object.keys(positions));
	if (!moved.size) return;
	flow.nodes = flow.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n));
	remapEdgeSides(moved);
	repositionTags();
}

// Press CC → arrange cards into loose semantic clusters. The backend embeds each
// node's text, detects topic communities, and returns a spacing-independent layout;
// here we drop it onto the canvas at the user's chosen inter-cluster spacing. No
// backdrops, no type buckets — clusters read purely from spatial proximity.
export async function cleanUp(ids?: string[]): Promise<void> {
	// Scope: selected subset (2+) or all top-level non-group nodes.
	let targets: Node[];
	if (ids && ids.length >= 2) {
		const idSet = new Set(ids);
		targets = flow.nodes.filter((n) => idSet.has(n.id) && n.type !== 'group' && n.type !== 'tag');
	} else {
		targets = flow.nodes.filter((n) => !n.parentId && n.type !== 'group' && n.type !== 'tag');
	}
	if (targets.length < 2) return;

	const { cleanupArrange } = await import('$lib/ai/client');
	const canvas = currentCanvasId() || 'default';
	const payload = targets.map((n) => ({
		id: n.id,
		text: snippetOf(n),
		w: n.measured?.width ?? n.width ?? 400,
		h: n.measured?.height ?? n.height ?? 280,
		x: n.position.x,
		y: n.position.y,
	}));
	const targetIds = new Set(targets.map((n) => n.id));
	const edges = flow.edges
		.filter((e) => targetIds.has(e.source) && targetIds.has(e.target))
		.map((e) => ({ source: e.source, target: e.target }));

	const layout = await cleanupArrange(canvas, payload, edges);
	if (!layout || Object.keys(layout.nodes).length === 0) return;

	cleanupLayout = layout;
	// Cache cluster membership (cards sharing a grid cell) so the user can tag them.
	const cells = new Map<string, string[]>();
	for (const id in layout.nodes) {
		const { col, row } = layout.nodes[id];
		const k = `${col},${row}`;
		(cells.get(k) ?? cells.set(k, []).get(k)!).push(id);
	}
	cleanupClusters = [...cells.values()];

	pushHistory();
	applyPositions(placeLayout(layout, settings.clusterSpacing));
}

// ── Cluster tags ──────────────────────────────────────────────────────────────
// Manual labels the user drops on Clean Up clusters to identify them at a glance.
// Each is a normal 'tag' node (so it persists, undoes, pans/zooms for free) anchored
// to its cluster's member ids; repositionTags() floats it above their bounding box.
let cleanupClusters: string[][] = [];
const clusterKey = (ids: string[]) => [...ids].sort().join('|');

function clusterBox(ids: string[]): { minX: number; minY: number; maxX: number } | null {
	const set = new Set(ids);
	let minX = Infinity, minY = Infinity, maxX = -Infinity, found = false;
	for (const n of flow.nodes) {
		if (!set.has(n.id)) continue;
		found = true;
		const w = n.measured?.width ?? n.width ?? 400;
		minX = Math.min(minX, n.position.x);
		minY = Math.min(minY, n.position.y);
		maxX = Math.max(maxX, n.position.x + w);
	}
	return found ? { minX, minY, maxX } : null;
}

// Drop one empty editable tag above each Clean Up cluster that isn't already tagged.
export function addClusterTags(): void {
	if (!cleanupClusters.length) return;
	const tagged = new Set(
		flow.nodes.filter((n) => n.type === 'tag').map((n) => clusterKey((n.data as TagData).anchor ?? [])),
	);
	const created: Node[] = [];
	for (const members of cleanupClusters) {
		if (members.length < 1 || tagged.has(clusterKey(members))) continue;
		const bb = clusterBox(members);
		if (!bb) continue;
		created.push({
			id: nextId(),
			type: 'tag',
			position: { x: Math.round((bb.minX + bb.maxX) / 2 - 60), y: Math.round(bb.minY - 46) },
			data: { text: '', anchor: [...members] } as TagData,
			width: 120,
		});
	}
	if (!created.length) return;
	pushHistory();
	flow.nodes = [...flow.nodes, ...created];
}

export function setTagText(id: string, text: string): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n));
}

// Float every cluster tag above its anchor cluster's current bounding box. Called
// after Clean Up, spacing changes, and drags so labels track their clusters.
export function repositionTags(): void {
	let changed = false;
	const next = flow.nodes.map((n) => {
		if (n.type !== 'tag') return n;
		const anchor = (n.data as TagData).anchor;
		if (!anchor?.length) return n;
		const bb = clusterBox(anchor);
		if (!bb) return n;
		const w = n.measured?.width ?? n.width ?? 120;
		const pos = { x: Math.round((bb.minX + bb.maxX) / 2 - w / 2), y: Math.round(bb.minY - 46) };
		if (n.position.x === pos.x && n.position.y === pos.y) return n;
		changed = true;
		return { ...n, position: pos };
	});
	if (changed) flow.nodes = next;
}

// Spacing slider → re-place the last Clean Up at a new inter-cluster gap. Pure
// client-side rescale of the cached layout: instant, no backend call. No history
// push per tick — the CC press already recorded one undo point.
export function setClusterSpacing(gap: number): void {
	settings.clusterSpacing = gap;
	persistSettingsDebounced();
	if (cleanupLayout && cleanupLayout.nodes && Object.keys(cleanupLayout.nodes).every((id) => flow.nodes.some((n) => n.id === id)))
		applyPositions(placeLayout(cleanupLayout, gap));
}

// Coalesce the rapid-fire slider writes into one settings save.
let spacingSaveTimer: ReturnType<typeof setTimeout> | null = null;
function persistSettingsDebounced(): void {
	if (spacingSaveTimer) clearTimeout(spacingSaveTimer);
	spacingSaveTimer = setTimeout(() => persistSettings(), 400);
}

// Append a streamed agent event (tool call / reasoning) to the active turn's timeline.
function pushEvent(id: string, ev: AgentEvent): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[])];
		const last = turns[turns.length - 1];
		turns[turns.length - 1] = { ...last, events: [...last.events, ev] };
		return { ...n, data: { ...n.data, turns } };
	});
}

// Run the card's active (last) turn. Context = canvas digest + ancestor threads +
// this card's own prior turns + the new prompt. Streams into the active turn.
export async function runModel(id: string): Promise<void> {
	const self = flow.nodes.find((n) => n.id === id);
	const selfData = self?.data as CardData | undefined;
	if (!selfData) return;

	const messages: ChatMessage[] = [];

	// Ancestor cards' full threads → the branch spine.
	for (const aid of ancestry(id)) {
		const node = flow.nodes.find((n) => n.id === aid);
		if (node && node.type === 'card') pushTurns(messages, node.data as CardData);
	}

	// This card's prior turns (everything before the active one).
	const turns = selfData.turns;
	for (const t of turns.slice(0, -1)) {
		if (t.prompt) messages.push({ role: 'user', content: t.prompt });
		if (t.answer) messages.push({ role: 'assistant', content: t.answer });
	}

	// Active turn's prompt. Quote prefix only on the very first turn (branch origin).
	const active = turns[turns.length - 1];
	const firstTurn = turns.length === 1;
	const quote = firstTurn ? selfData.quote : undefined;
	const base = quote
		? `Regarding this excerpt:\n\n> ${quote}\n\n${active.prompt}`
		: active.prompt;
	messages.push({ role: 'user', content: base });

	const workflow = selfData.workflow ?? settings.workflow;
	const ancestorIds = new Set(ancestry(id));
	const connected = connectedDigest(id, ancestorIds); // ancestors already sent as full message history
	const digest = canvasDigest(id, new Set([...ancestorIds, ...connectedIds(id, flow.edges)]));
	const systemPrompt = [workflowSystemPrompt(workflow), connected, digest].filter(Boolean).join('\n\n');

	let answer = '';
	await runAgent(
		id,
		messages,
		{
			providers: activeLadder(),
			systemPrompt,
			workflow,
			bash: settings.bashEnabled,
			websearch: settings.websearch.enabled,
			websearchBackend: settings.websearch.backend,
			canvasTools: true,
			canvas: currentId
		},
		(e) => {
			switch (e.type) {
				case 'text_delta':
					answer += e.delta ?? '';
					setTurnAnswer(id, answer, true);
					break;
				case 'tool_start':
					applyCanvasTool(e);
					pushEvent(id, e);
					break;
				case 'thinking_delta':
				case 'tool_end':
					pushEvent(id, e);
					break;
				case 'error':
					answer += `\n\n_[error: ${e.message}]_`;
					setTurnAnswer(id, answer, false);
					break;
				case 'done':
					setTurnAnswer(id, answer, false);
					if (turns.length === 1) {
						void generateTitle(id, active.prompt, answer);
						void generateCanvasTitle();
					}
					triggerAutolink(id);
					break;
			}
		}
	);
}

async function generateTitle(id: string, prompt: string, answer: string): Promise<void> {
	const messages: ChatMessage[] = [{
		role: 'user',
		content: `Write a short descriptive title (5 words max, no quotes, no trailing punctuation) that captures what this Q&A is about:\n\nQ: ${prompt.slice(0, 300)}\nA: ${answer.slice(0, 500)}`
	}];
	let title = '';
	await runAgent(
		`__title_${id}`,
		messages,
		{
			providers: activeLadder(),
			canvas: currentId
		},
		(e) => {
			if (e.type === 'text_delta') title += e.delta ?? '';
			else if (e.type === 'done' && title.trim()) {
				const clean = title.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();
				if (clean) {
					flow.nodes = flow.nodes.map((n) =>
						n.id === id ? { ...n, data: { ...n.data, title: clean } } : n
					);
				}
			}
		}
	);
}

async function generateCanvasTitle(): Promise<void> {
	const meta = library.list.find((c) => c.id === currentId);
	if (!meta || !/^Canvas \d+$/.test(meta.name)) return;
	const parts: string[] = [];
	for (const n of flow.nodes) {
		if (n.type === 'card') parts.push(((n.data as CardData).title || lastTurn(n.data as CardData)?.prompt || '').trim());
		else if (n.type === 'file') parts.push(((n.data as { filename: string }).filename || '').trim());
	}
	const content = parts.filter(Boolean).join(', ');
	if (!content) return;
	const messages: ChatMessage[] = [{
		role: 'user',
		content: `Write a short descriptive title (5 words max, no quotes, no trailing punctuation) for a research canvas containing: ${content}`
	}];
	let title = '';
	await runAgent(
		'__canvas_title__',
		messages,
		{ providers: activeLadder() },
		(e) => {
			if (e.type === 'text_delta') title += e.delta ?? '';
			else if (e.type === 'done' && title.trim()) {
				const clean = title.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.!?]+$/, '').trim();
				if (clean) void renameCanvas(currentId, clean);
			}
		}
	);
}

export function renameCard(id: string, title: string): void {
	const t = title.trim();
	if (!t) return;
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, title: t } } : n
	);
}

// ── Hub session (canvas-wide agent chat) ────────────────────────────────────

// Create a finished Q&A card from agent output — no streaming, placed to the right
// of the rightmost existing node.
function createCardFromAgent(title: string, content: string): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const maxX = flow.nodes.reduce((m, n) => Math.max(m, n.position.x + (n.width ?? 400)), 0);
	const position = { x: maxX > 0 ? maxX + 40 : 80, y: 80 };
	const data: CardData = {
		title,
		turns: [{ prompt: title, answer: content, events: [] }],
		streaming: false,
		block
	};
	flow.nodes = [...flow.nodes, { id, type: 'card', position, data, width: 400 }];
	saveCanvas();
	triggerAutolink(id);
	return id;
}

// Replace an existing card's content. ref = node id OR case-insensitive title match.
// Q&A card → overwrites last turn's answer. Text card → overwrites body.
function updateCardContent(ref: string, content: string): boolean {
	const node =
		flow.nodes.find((n) => n.id === ref) ??
		flow.nodes.find((n) => {
			const d = n.data as Record<string, unknown>;
			return (
				typeof d.title === 'string' &&
				d.title.toLowerCase() === ref.toLowerCase()
			);
		});
	if (!node) return false;
	if (node.type === 'text') {
		setCardText(node.id, content);
	} else {
		// Q&A card: replace last turn's answer (replace, not append — per user choice).
		flow.nodes = flow.nodes.map((n) => {
			if (n.id !== node.id) return n;
			const turns = [...(n.data.turns as Turn[])];
			turns[turns.length - 1] = { ...turns[turns.length - 1], answer: content };
			return { ...n, data: { ...n.data, turns, streaming: false } };
		});
	}
	saveCanvas();
	return true;
}

// Canvas digest that includes node ids — needed so the agent can reference cards by id.
// Full card content is included (capped at 6000 chars each) so the agent can reason over it.
function canvasDigestWithIds(): string {
	const cards = flow.nodes
		.filter((n) => n.type === 'card' || n.type === 'text')
		.map((n) => {
			const d = n.data as CardData & { text?: string };
			const title = (d.title ?? d.text ?? '').trim();
			const content = n.type === 'card' ? (lastTurn(d)?.answer ?? '') : (d.text ?? '');
			return { id: n.id, title, content };
		})
		.filter((c) => c.title);
	if (!cards.length) return '';
	const sections = cards.map((c) => {
		const body = c.content.trim().slice(0, 6000);
		return body
			? `### [${c.id}] ${c.title}\n${body}`
			: `### [${c.id}] ${c.title}\n(no content yet)`;
	});
	return `## Canvas cards (use ids with create_card / update_card)\n\n${sections.join('\n\n')}`;
}

function setSessionAnswer(answer: string, streaming: boolean): void {
	const turns = [...session.turns];
	if (!turns.length) return;
	turns[turns.length - 1] = { ...turns[turns.length - 1], answer };
	session.turns = turns;
	session.streaming = streaming;
}

function pushSessionEvent(ev: AgentEvent): void {
	const turns = [...session.turns];
	if (!turns.length) return;
	const last = turns[turns.length - 1];
	turns[turns.length - 1] = { ...last, events: [...last.events, ev] };
	session.turns = turns;
}

// Apply a canvas tool invocation from a tool_start SSE event.
function applyCanvasTool(ev: AgentEvent): void {
	const args = ev.args as Record<string, string> | undefined;
	if (!args) return;
	if (ev.name === 'create_card') {
		createCardFromAgent(args.title ?? '', args.content ?? '');
	} else if (ev.name === 'create_note') {
		const maxX = flow.nodes.reduce((m, n) => Math.max(m, n.position.x + (n.width ?? 400)), 0);
		const pos = { x: maxX > 0 ? maxX + 40 : 80, y: 80 };
		const noteId = addTextCard(pos, args.content ?? '');
		saveCanvas();
		triggerAutolink(noteId);
	} else if (ev.name === 'update_card') {
		updateCardContent(args.card ?? '', args.content ?? '');
	}
}

// Run a hub session turn. Mirrors runModel but targets session state + uses canvasTools.
export async function runSession(prompt: string): Promise<void> {
	session.turns = [...session.turns, { prompt, answer: '', events: [] }];
	session.streaming = true;
	saveCanvas();

	const messages: ChatMessage[] = [];
	for (const t of session.turns.slice(0, -1)) {
		if (t.prompt) messages.push({ role: 'user', content: t.prompt });
		if (t.answer) messages.push({ role: 'assistant', content: t.answer });
	}
	messages.push({ role: 'user', content: prompt });

	const workflow = settings.workflow;
	const digest = canvasDigestWithIds();
	const toolHint =
		'\n\n## Hub Session Rules\n' +
		'You are the canvas-level assistant. The full content of every canvas card is provided IN THIS SYSTEM PROMPT in the "Canvas cards" section below — read it directly to answer questions about card contents. ' +
		'DO NOT call knowledge_base_search to find card content; KB tools only work for files the user has explicitly uploaded (PDFs, docx, images, etc.), not for canvas cards.\n\n' +
		'**Bias toward action over clarification.** If the user\'s intent is clear enough to attempt, execute it immediately without asking questions. ' +
		'Call create_card once per card you want to create — do not batch them into one card. ' +
		'Ask a question only if you genuinely cannot proceed without the answer.\n\n' +
		'## Canvas Tools\n' +
		'- create_card(title, content): creates a new Q&A card on the canvas. Call this once per card — multiple calls = multiple cards.\n' +
		'- create_note(title?, content): creates a standalone markdown note card — for drafted prose, summaries, emails, outlines.\n' +
		'- update_card(card, content): replaces an existing card\'s content (use card id when available).';
	const systemPrompt = workflowSystemPrompt(workflow) + toolHint + (digest ? '\n\n' + digest : '');

	let answer = '';
	await runAgent(
		'__session__',
		messages,
		{
			providers: activeLadder(),
			systemPrompt,
			workflow,
			bash: false,
			websearch: settings.websearch.enabled,
			websearchBackend: settings.websearch.backend,
			canvasTools: true,
			canvas: currentId
		},
		(e) => {
			switch (e.type) {
				case 'text_delta':
					answer += e.delta ?? '';
					setSessionAnswer(answer, true);
					break;
				case 'tool_start':
					applyCanvasTool(e);
					pushSessionEvent(e);
					break;
				case 'thinking_delta':
				case 'tool_end':
					pushSessionEvent(e);
					break;
				case 'error':
					answer += `\n\n_[error: ${e.message}]_`;
					setSessionAnswer(answer, false);
					saveCanvas();
					break;
				case 'done':
					setSessionAnswer(answer, false);
					saveCanvas();
					break;
			}
		}
	);
}

// Flatten a card's turns into alternating user/assistant messages.
function pushTurns(messages: ChatMessage[], d: CardData): void {
	for (const t of d.turns ?? []) {
		if (t.prompt) messages.push({ role: 'user', content: t.prompt });
		if (t.answer) messages.push({ role: 'assistant', content: t.answer });
	}
}

// Nodes directly linked to `id` by any edge (manual or semantic), either direction.
export function connectedIds(id: string, edges: Edge[]): Set<string> {
	const ids = new Set<string>();
	for (const e of edges) {
		if (e.source === id) ids.add(e.target);
		else if (e.target === id) ids.add(e.source);
	}
	ids.delete(id);
	return ids;
}

export interface ConnectedItem {
	kind: 'card' | 'text' | 'file';
	title: string; // card title / filename ('' for notes)
	body: string; // pre-truncated content to show
}

// Richer, higher-priority context block for nodes directly connected to this card —
// fuller text than the generic one-line digest, since the user wired them together.
export function connectedDigestFrom(items: ConnectedItem[]): string {
	const sections = items
		.map((it) => {
			const body = it.body.trim();
			if (it.kind === 'card') return body ? `### "${it.title || '(untitled card)'}"\n${body}` : '';
			if (it.kind === 'text') return body ? `### [note]\n${body}` : '';
			return `### [file: ${it.title}]\n${body || '(not yet indexed)'}`;
		})
		.filter(Boolean);
	if (!sections.length) return '';
	return (
		'## Connected to this card\n' +
		'The user directly linked these on the canvas — prioritize them over the "Other threads" section below.\n\n' +
		sections.join('\n\n')
	);
}

function connectedDigest(id: string, skip: Set<string>): string {
	const ids = [...connectedIds(id, flow.edges)].filter((cid) => !skip.has(cid));
	const items: ConnectedItem[] = ids
		.map((cid) => flow.nodes.find((n) => n.id === cid))
		.filter((n): n is Node => !!n && (n.type === 'card' || n.type === 'text' || n.type === 'file'))
		.map((n) => {
			if (n.type === 'card') {
				const d = n.data as CardData;
				const t = lastTurn(d);
				const body = [t?.prompt, t?.answer].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim().slice(0, 800);
				return { kind: 'card' as const, title: d.title ?? '', body };
			}
			if (n.type === 'text') {
				const d = n.data as TextData;
				return { kind: 'text' as const, title: '', body: (d.text ?? '').slice(0, 1500) };
			}
			const d = n.data as FileData;
			return { kind: 'file' as const, title: d.filename ?? '', body: (d.preview ?? '').slice(0, 1500) };
		});
	return connectedDigestFrom(items);
}

function canvasDigest(excludeId: string, skip: Set<string> = new Set()): string {
	const cards = flow.nodes
		.filter(
			(n) =>
				(n.type === 'card' || n.type === 'text' || n.type === 'file') &&
				n.id !== excludeId &&
				!skip.has(n.id)
		)
		.map((n) => {
			if (n.type === 'text') {
				const d = n.data as TextData;
				return { id: n.id, title: '[note]', lastAnswer: (d.text ?? '').slice(0, 120) };
			}
			if (n.type === 'file') {
				const d = n.data as FileData;
				return { id: n.id, title: `[file: ${d.filename}]`, lastAnswer: '' };
			}
			const d = n.data as CardData;
			return { id: n.id, title: d.title ?? '', lastAnswer: lastTurn(d)?.answer ?? '' };
		});
	return digestFrom(cards, excludeId);
}

export function digestFrom(
	cards: { id: string; title: string; lastAnswer: string }[],
	excludeId: string
): string {
	const lines: string[] = [];
	for (const c of cards) {
		if (c.id === excludeId) continue;
		const title = c.title.trim();
		if (!title) continue;
		const snippet = c.lastAnswer.replace(/\s+/g, ' ').trim().slice(0, 120);
		lines.push(snippet ? `- "${title}": ${snippet}` : `- "${title}"`);
	}
	if (!lines.length) return '';
	return `## Other threads on this canvas\nThe user may reference these. Use them as context when relevant.\n${lines.join('\n')}`;
}

function ancestry(id: string): string[] {
	const parentOf = new Map<string, string>();
	for (const e of flow.edges) parentOf.set(e.target, e.source);
	const chain: string[] = [];
	let cur = parentOf.get(id);
	while (cur) {
		chain.unshift(cur);
		cur = parentOf.get(cur);
	}
	return chain;
}
