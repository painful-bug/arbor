// Canvas state: nodes/edges for Svelte Flow + actions to grow the tree.
import type { Node, Edge, XYPosition } from '@xyflow/svelte';
import {
	runAgent,
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

export const BLOCKS = ['lime', 'lilac', 'cream', 'pink', 'mint', 'coral'];
let blockIdx = 0;

// ── Tool state (shared by toolbar + canvas) ──────────────────────────────────
export type Tool = 'hand' | 'text' | 'duplicate' | 'connect' | 'color';
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
}
interface CanvasIndex {
	current: string;
	list: CanvasMeta[];
}

// Reactive registry + view state the Library/Sidebar bind to.
export const library = $state<{ list: CanvasMeta[] }>({ list: [] });
export const ui = $state<{ view: 'canvas' | 'library' }>({ view: 'canvas' });
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
	idCounter = 0;
	for (const n of nodes) {
		const num = parseInt(String(n.id).replace(/\D/g, ''), 10);
		if (!isNaN(num) && num > idCounter) idCounter = num;
	}
	// Capture loaded state as first undo snapshot after effects settle.
	setTimeout(() => {
		_histLock = false;
		pushHistory();
	}, 10);
}

function newDoc(name: string): CanvasDoc {
	const now = Date.now();
	return { id: uid(), name, createdAt: now, updatedAt: now, nodes: [], edges: [] };
}

export async function init(): Promise<void> {
	// Backend already migrated any legacy ~/.loom JSON into SQLite on boot.
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

// Persist the active canvas's current nodes/edges + bump its updatedAt.
export function saveCanvas(): void {
	if (!currentId) return;
	const meta = library.list.find((c) => c.id === currentId);
	if (!meta) return;
	const now = Date.now();
	writeDoc({ ...meta, updatedAt: now, nodes: flow.nodes, edges: flow.edges });
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

// Knowledge-base (Graphiti) config. Mirrors the backend GraphitiSettings shape.
// Default is fully local (Ollama LLM + embedder) — no key, no rate limits.
export interface GraphitiSettings {
	llmProvider: 'ollama' | 'groq' | 'gemini' | 'custom';
	llmModel: string;
	llmApiBase: string;
	embedder: 'ollama' | 'gemini';
	embedderModel: string;
	ollamaUrl: string;
}

const GRAPHITI_DEFAULTS: GraphitiSettings = {
	llmProvider: 'ollama',
	llmModel: 'llama3.2:3b',
	llmApiBase: '',
	embedder: 'ollama',
	embedderModel: 'nomic-embed-text',
	ollamaUrl: 'http://localhost:11434/v1'
};

interface Settings {
	provider: Provider;
	models: Record<Provider, string>;
	workflow: string;
	bashEnabled: boolean;
	websearch: { enabled: boolean; backend: 'duckduckgo' | 'tavily' };
	graphiti: GraphitiSettings;
}

const FALLBACK_SETTINGS: Settings = {
	provider: 'nim',
	models: { ...DEFAULT_MODELS },
	workflow: 'general',
	bashEnabled: false,
	websearch: { enabled: false, backend: 'duckduckgo' },
	graphiti: { ...GRAPHITI_DEFAULTS }
};

export const settings = $state<Settings>({
	...FALLBACK_SETTINGS,
	models: { ...DEFAULT_MODELS },
	graphiti: { ...GRAPHITI_DEFAULTS }
});

async function loadSettingsAsync(): Promise<void> {
	let p: Record<string, unknown> | null = null;
	try { p = await apiJson<Record<string, unknown> | null>('/api/settings'); } catch { return; }
	if (!p) return; // none saved yet — keep defaults
	try {
		if (typeof p.provider === 'string' && VALID_PROVIDERS.has(p.provider as Provider)) {
			settings.provider = p.provider as Provider;
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
		if (p.graphiti && typeof p.graphiti === 'object') {
			settings.graphiti = { ...GRAPHITI_DEFAULTS, ...(p.graphiti as Partial<GraphitiSettings>) };
		}
	} catch {}
}

export function persistSettings(): void {
	void apiPut('/api/settings', {
		provider: settings.provider,
		models: settings.models,
		workflow: settings.workflow,
		bashEnabled: settings.bashEnabled,
		websearch: settings.websearch,
		graphiti: settings.graphiti
	});
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

// File card on the canvas: shows a preview of a dropped file + indexing progress.
export interface FileData {
	filename: string;
	status: 'indexing' | 'ready' | 'error';
	block: string;
	mime: string;
	kind: import('$lib/files').FileKind;
	path?: string;
	preview?: string;
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
	flow.nodes = [...flow.nodes, { id, type: 'file', position, data }];
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

// ── Text card (user markdown note) ───────────────────────────────────────────
export interface TextData {
	text: string;
	block: string;
	[key: string]: unknown;
}

export function addTextCard(position: XYPosition, text = ''): string {
	const id = nextId();
	const block = BLOCKS[blockIdx++ % BLOCKS.length];
	const data: TextData = { text, block };
	flow.nodes = [...flow.nodes, { id, type: 'text', position, data, width: 320 }];
	return id;
}

export function setCardText(id: string, text: string): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, text } } : n
	);
}

export function setCardBlock(id: string, block: string): void {
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
	const digest = canvasDigest(id);
	const systemPrompt = digest
		? `${workflowSystemPrompt(workflow)}\n\n${digest}`
		: workflowSystemPrompt(workflow);

	let answer = '';
	await runAgent(
		id,
		messages,
		{
			provider: settings.provider,
			model: settings.models[settings.provider] || DEFAULT_MODELS[settings.provider],
			systemPrompt,
			workflow,
			bash: settings.bashEnabled,
			websearch: settings.websearch.enabled,
			websearchBackend: settings.websearch.backend,
			canvas: currentId
		},
		(e) => {
			switch (e.type) {
				case 'text_delta':
					answer += e.delta ?? '';
					setTurnAnswer(id, answer, true);
					break;
				case 'thinking_delta':
				case 'tool_start':
				case 'tool_end':
					pushEvent(id, e);
					break;
				case 'error':
					answer += `\n\n_[error: ${e.message}]_`;
					setTurnAnswer(id, answer, false);
					break;
				case 'done':
					setTurnAnswer(id, answer, false);
					if (turns.length === 1) void generateTitle(id, active.prompt, answer);
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
			provider: settings.provider,
			model: settings.models[settings.provider] || DEFAULT_MODELS[settings.provider],
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

export function renameCard(id: string, title: string): void {
	const t = title.trim();
	if (!t) return;
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, title: t } } : n
	);
}

// Flatten a card's turns into alternating user/assistant messages.
function pushTurns(messages: ChatMessage[], d: CardData): void {
	for (const t of d.turns ?? []) {
		if (t.prompt) messages.push({ role: 'user', content: t.prompt });
		if (t.answer) messages.push({ role: 'assistant', content: t.answer });
	}
}

function canvasDigest(excludeId: string): string {
	const cards = flow.nodes
		.filter((n) => n.type === 'card' && n.id !== excludeId)
		.map((n) => {
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
