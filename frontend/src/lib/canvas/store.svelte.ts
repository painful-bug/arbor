// Canvas state: nodes/edges for Svelte Flow + actions to grow the tree.
// Satellite modules: cards.ts (node factory/types), persistence.ts (index/docs),
// history.ts (undo/redo), kb-sync.ts (KB indexing), context.ts (digests),
// runs.ts (agent runs). Public API is frozen here via re-exports.
import type { Edge, Node, XYPosition } from "@xyflow/svelte";
import type { ArrangeLayout } from "$lib/ai/client";
import { kbClear, PROVIDERS, type Provider } from "$lib/ai/client";
import { apiFetch, apiJson, apiPut } from "$lib/api";
import {
	buildCardNode,
	type CardData,
	childEdge,
	cycleBlock,
	type FileData,
	type MindmapData,
	type MindNode,
	nextBlock,
	type TagData,
	type TextData,
	type Turn,
	type WebData,
} from "./cards";
import { clusterColor, clusterKey, matchCluster } from "./cluster-tags";
import { snippetOf } from "./context";
import { createHistory } from "./history";
import { finishIndexing, startIndexing } from "./indexing.svelte";
import { cleanupFileNodes, createKbSync } from "./kb-sync";
import { findFreeOffset } from "./mindmap-layout";
import {
	type CanvasDoc,
	type CanvasMeta,
	loadDoc,
	newDoc,
	readIndex,
	writeDoc,
	writeIndex,
} from "./persistence";
import { nextZ, prevZ } from "./zorder";

export type {
	CardData,
	FileData,
	MindmapData,
	MindNode,
	PdfHL,
	TagData,
	TextData,
	Turn,
	WebData,
} from "./cards";
// ── Frozen public API: re-export moved pieces ────────────────────────────────
export { lastTurn } from "./cards";
export type { ConnectedItem } from "./context";
export { connectedDigestFrom, connectedIds, digestFrom, snippetOf } from "./context";
export { getCachedDoc } from "./persistence";
export { continueCard, retryCard, runModel, runSession, synthesizeSelection } from "./runs";

// ── Tool state (shared by toolbar + canvas) ──────────────────────────────────
export type Tool = "hand" | "select" | "text" | "duplicate" | "connect" | "color";
export const tool = $state<{ active: Tool; connectFrom: string | null }>({
	active: "hand",
	connectFrom: null,
});

let idCounter = 0;
/** Next canvas node id (counter resets per loaded doc). */
export const nextNodeId = (): string => `n${++idCounter}`;

export const flow = $state<{ nodes: Node[]; edges: Edge[]; selected: string | null }>({
	nodes: [],
	edges: [],
	selected: null,
});

// Hub session: canvas-wide agent chat (active when no card is selected).
export const session = $state<{ turns: Turn[]; streaming: boolean }>({
	turns: [],
	streaming: false,
});

// ── Multi-canvas registry + view state the Library/Sidebar bind to ──────────
export const library = $state<{ list: CanvasMeta[] }>({ list: [] });
export const ui = $state<{ view: "canvas" | "library"; sidebarExpanded: boolean }>({
	view: "canvas",
	sidebarExpanded: false,
});
let currentId = "";
export const currentCanvasId = () => currentId;
export const currentCanvasName = () => library.list.find((c) => c.id === currentId)?.name ?? "";

const kbSync = createKbSync({
	canvas: () => currentId || "default",
	onIndexed: (id) => triggerAutolink(id),
});

// Normalize loaded nodes: clear mid-stream flags, migrate pre-thread Q→A cards.
function normalize(nodes: Node[]): Node[] {
	for (const n of nodes ?? []) {
		if (n.data?.streaming) n.data.streaming = false;
		// Height is always content-driven; width persists so user-resized cards restore.
		if (n.type === "card" || n.type === "file") {
			if (!n.width) n.width = 400;
			delete n.height;
		}
		// Mind maps auto-size to their graph — drop any persisted fixed frame so the
		// whole map fits in view (xyflow measures the content instead).
		if (n.type === "mindmap") {
			n.width = undefined;
			n.height = undefined;
			// Root now obeys `expanded` (so it can collapse the whole tree); default
			// it open for maps saved before that change, else they'd load root-only.
			const d = n.data as MindmapData | undefined;
			const rootId = d?.nodes?.find((x) => x.parent === null)?.id;
			if (d && rootId && d.expanded?.[rootId] === undefined) {
				d.expanded = { ...(d.expanded ?? {}), [rootId]: true };
			}
		}
		if (n.data && n.type === "card" && !Array.isArray(n.data.turns)) {
			n.data.title = n.data.title ?? n.data.prompt ?? "";
			n.data.turns = [
				{
					prompt: n.data.prompt ?? "",
					answer: n.data.answer ?? "",
					events: Array.isArray(n.data.events) ? n.data.events : [],
				},
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
	hist.reset();
	hist.lock();

	const nodes = normalize(doc?.nodes ?? []);
	flow.nodes = nodes;
	flow.edges = doc?.edges ?? [];
	flow.selected = null;
	session.turns = doc?.session ?? [];
	session.streaming = false;
	idCounter = 0;
	for (const n of nodes) {
		const num = parseInt(String(n.id).replace(/\D/g, ""), 10);
		if (!Number.isNaN(num) && num > idCounter) idCounter = num;
	}
	// Capture loaded state as first undo snapshot after effects settle.
	setTimeout(() => {
		hist.unlock();
		pushHistory();
		// Backfill: link any nodes that aren't semantically connected yet.
		if (settings.autoConnect) {
			// justified: autolink is best-effort background enrichment.
			void import("./autolink").then((m) => m.autolinkAll()).catch(() => {});
		}
	}, 10);
}

export async function init(): Promise<void> {
	// Backend already migrated any legacy JSON into SQLite on boot.
	const stored = await readIndex();

	if (!stored.list.length) {
		// Fresh install — create default canvas.
		const doc = newDoc("Canvas 1");
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
	currentId = stored.list.some((c) => c.id === stored.current) ? stored.current : stored.list[0].id;

	applyDoc(await loadDoc(currentId));
	await loadSettingsAsync();
}

/** Persist the active canvas's current nodes/edges/session + bump its updatedAt. */
export function saveCanvas(): void {
	if (!currentId) return;
	const meta = library.list.find((c) => c.id === currentId);
	if (!meta) return;
	const now = Date.now();
	writeDoc({
		...meta,
		updatedAt: now,
		nodes: flow.nodes,
		edges: flow.edges,
		session: session.turns,
	});
	library.list = library.list.map((c) => (c.id === currentId ? { ...c, updatedAt: now } : c));
	writeIndex(currentId, library.list);
}

export function newCanvas(name?: string): string {
	saveCanvas();
	const doc = newDoc(name || `Canvas ${library.list.length + 1}`);
	writeDoc(doc);
	library.list = [
		{ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt },
		...library.list,
	];
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
	void apiFetch(`/api/canvases/${id}`, { method: "DELETE" });
	// Drop this canvas's whole KB index (clearCanvas → dropTable). ponytail: orphaned
	// per-canvas blobs are left on disk; cheap to ignore vs. listing every file node.
	void kbClear(id);
	library.list = library.list.filter((c) => c.id !== id);
	writeIndex(currentId, library.list);
	if (currentId === id) {
		currentId = "";
		if (!library.list.length) newCanvas("Canvas 1");
		else await switchCanvas(library.list[0].id);
	}
}

// ── Undo / redo ──────────────────────────────────────────────────────────────
const hist = createHistory<{ nodes: Node[]; edges: Edge[] }>(50);

/** Snapshot current nodes/edges onto the undo stack (no-op while locked). */
export function pushHistory(): void {
	hist.push({ nodes: flow.nodes, edges: flow.edges });
}

export function undo(): void {
	const snap = hist.undo();
	if (!snap) return;
	hist.lock(500); // past the 400ms save debounce
	flow.nodes = snap.nodes;
	flow.edges = snap.edges;
	flow.selected = null;
	saveCanvas();
}

export function redo(): void {
	const snap = hist.redo();
	if (!snap) return;
	hist.lock(500);
	flow.nodes = snap.nodes;
	flow.edges = snap.edges;
	flow.selected = null;
	saveCanvas();
}

export function canUndo(): boolean {
	return hist.canUndo();
}

export function canRedo(): boolean {
	return hist.canRedo();
}

// ── Settings ─────────────────────────────────────────────────────────────────

export const DEFAULT_MODELS = Object.fromEntries(
	PROVIDERS.map((p) => [p.id, p.defaultModel]),
) as Record<Provider, string>;

const VALID_PROVIDERS = new Set(PROVIDERS.map((p) => p.id));

// Model ladder: tried in order, falls back to the next rung on rate-limit.
// Gemini first (generous free tier), then fast/cheap inference, then the rest.
export const DEFAULT_LADDER: Provider[] = [
	"google",
	"nim",
	"groq",
	"openrouter",
	"anthropic",
	"openai",
	"ollama",
];

interface Settings {
	providerLadder: Provider[];
	models: Record<Provider, string>;
	workflow: string;
	bashEnabled: boolean;
	websearch: { enabled: boolean; backend: "duckduckgo" | "tavily" };
	snapToGrid: boolean;
	autoConnect: boolean;
	theme: "light" | "dark";
	clusterSpacing: number; // Clean Up inter-cluster gutter (avg-radius units)
	autoCleanup: { enabled: boolean; intervalMin: number }; // periodic Clean Up (Cmd-C) while canvas open
	highlightClusters: boolean; // tint + animated border behind each named cluster
	clusterShape: "squircle" | "circle"; // highlight hull shape (only when highlightClusters)
}

const FALLBACK_SETTINGS: Settings = {
	providerLadder: [...DEFAULT_LADDER],
	models: { ...DEFAULT_MODELS },
	workflow: "general",
	bashEnabled: false,
	websearch: { enabled: false, backend: "duckduckgo" },
	snapToGrid: false,
	autoConnect: true,
	theme: "dark",
	clusterSpacing: 8,
	autoCleanup: { enabled: false, intervalMin: 30 },
	highlightClusters: true,
	clusterShape: "squircle",
};

const LS_KEY = "arbor:settings";
export const settings = $state<Settings>({ ...FALLBACK_SETTINGS, models: { ...DEFAULT_MODELS } });

/** {provider, model} ladder ready to send to the backend, in user-chosen order. */
export function activeLadder(): { provider: Provider; model: string }[] {
	return settings.providerLadder.map((provider) => ({
		provider,
		model: settings.models[provider] || DEFAULT_MODELS[provider],
	}));
}

function applySettings(p: Record<string, unknown>): void {
	if (Array.isArray(p.providerLadder)) {
		const ladder = p.providerLadder.filter(
			(x, i, arr): x is Provider =>
				typeof x === "string" && VALID_PROVIDERS.has(x as Provider) && arr.indexOf(x) === i,
		);
		if (ladder.length) settings.providerLadder = ladder;
	} else if (typeof p.provider === "string" && VALID_PROVIDERS.has(p.provider as Provider)) {
		// Legacy single-provider settings — migrate to a one-rung ladder.
		settings.providerLadder = [p.provider as Provider];
	}
	if (p.models && typeof p.models === "object") {
		const m = p.models as Record<string, string>;
		for (const k of Object.keys(m)) {
			if (VALID_PROVIDERS.has(k as Provider)) settings.models[k as Provider] = m[k];
		}
	}
	if (typeof p.workflow === "string") settings.workflow = p.workflow;
	if (typeof p.bashEnabled === "boolean") settings.bashEnabled = p.bashEnabled;
	if (p.websearch && typeof p.websearch === "object") {
		const ws = p.websearch as Record<string, unknown>;
		if (typeof ws.enabled === "boolean") settings.websearch.enabled = ws.enabled;
		if (ws.backend === "duckduckgo" || ws.backend === "tavily")
			settings.websearch.backend = ws.backend;
	}
	if (typeof p.snapToGrid === "boolean") settings.snapToGrid = p.snapToGrid;
	if (typeof p.autoConnect === "boolean") settings.autoConnect = p.autoConnect;
	if (p.theme === "light" || p.theme === "dark") settings.theme = p.theme;
	if (typeof p.clusterSpacing === "number" && p.clusterSpacing >= 0)
		settings.clusterSpacing = p.clusterSpacing;
	if (p.autoCleanup && typeof p.autoCleanup === "object") {
		const ac = p.autoCleanup as Record<string, unknown>;
		if (typeof ac.enabled === "boolean") settings.autoCleanup.enabled = ac.enabled;
		if (typeof ac.intervalMin === "number" && ac.intervalMin >= 1)
			settings.autoCleanup.intervalMin = ac.intervalMin;
	}
	if (typeof p.highlightClusters === "boolean") settings.highlightClusters = p.highlightClusters;
	if (p.clusterShape === "squircle" || p.clusterShape === "circle")
		settings.clusterShape = p.clusterShape;
}

// Apply any localStorage-cached settings immediately (synchronous, before backend responds).
try {
	const raw = typeof localStorage !== "undefined" && localStorage.getItem(LS_KEY);
	if (raw) applySettings(JSON.parse(raw) as Record<string, unknown>);
} catch {
	// justified: corrupt localStorage cache — fall back to defaults.
}

async function loadSettingsAsync(): Promise<void> {
	let p: Record<string, unknown> | null = null;
	try {
		p = await apiJson<Record<string, unknown> | null>("/api/settings");
	} catch {
		return;
	}
	if (!p) return; // none saved yet — keep defaults
	try {
		applySettings(p);
		// Keep localStorage in sync with backend's authoritative copy.
		if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, JSON.stringify(p));
	} catch {
		// justified: localStorage may be unavailable (private mode) — backend copy stands.
	}
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
		highlightClusters: settings.highlightClusters,
		clusterShape: settings.clusterShape,
	};
	try {
		if (typeof localStorage !== "undefined") localStorage.setItem(LS_KEY, JSON.stringify(payload));
	} catch {
		// justified: localStorage may be unavailable — backend PUT below still persists.
	}
	apiPut("/api/settings", payload).catch((e) => console.error("[persist]", e));
}

// ── Semantic auto-linking ─────────────────────────────────────────────────────
/** Schedule background semantic linking for a node (no-op when auto-connect off).
 * Dynamic import breaks the store↔autolink cycle (autolink imports this module). */
export function triggerAutolink(nodeId: string): void {
	if (!settings.autoConnect) return;
	// justified: autolink is best-effort background enrichment.
	void import("./autolink").then((m) => m.scheduleAutolink(nodeId)).catch(() => {});
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
	opts: { parentId?: string; quote?: string; workflow?: string } = {},
): string {
	const id = nextNodeId();
	const data: CardData = {
		title: prompt,
		turns: [{ prompt, answer: "", events: [] }],
		streaming: true,
		block: nextBlock(),
		quote: opts.quote,
		workflow: opts.workflow ?? settings.workflow,
	};
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "card", id, position, data })];
	if (opts.parentId) {
		flow.edges = [...flow.edges, childEdge(opts.parentId, id, true)];
		remapEdgeSides(new Set([id]));
	}
	return id;
}

export function addWebCard(
	position: XYPosition,
	url: string,
	opts: { parentId?: string } = {},
): string {
	const id = nextNodeId();
	const data: WebData = { url, block: nextBlock() };
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "web", id, position, data })];
	if (opts.parentId) {
		flow.edges = [...flow.edges, childEdge(opts.parentId, id)];
		remapEdgeSides(new Set([id]));
	}
	return id;
}

export function addFileCard(
	position: XYPosition,
	filename: string,
	opts: { mime?: string; kind?: FileData["kind"]; path?: string } = {},
): string {
	const id = nextNodeId();
	const data: FileData = {
		filename,
		status: "indexing",
		block: nextBlock(),
		mime: opts.mime ?? "",
		kind: opts.kind ?? "other",
		path: opts.path,
	};
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "file", id, position, data })];
	startIndexing(id); // file cards spawn 'indexing' — register with the toolbar toast
	return id;
}

export function addTextCard(position: XYPosition, text = ""): string {
	const id = nextNodeId();
	const data: TextData = { text, block: nextBlock() };
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "text", id, position, data })];
	return id;
}

// Highlight → Note: spawn a text note beside a PDF's file node, carrying the source
// passage + page so it can jump back, and draw the parent→note link. Returns note id.
export function addSourceNote(fileId: string, page: number, text: string): string {
	const src = flow.nodes.find((n) => n.id === fileId);
	const base = src?.position ?? { x: 400, y: 300 };
	const position = { x: base.x + (src?.width ?? 220) + 60, y: base.y };
	const id = nextNodeId();
	const data: TextData = { text, block: nextBlock(), sourceRef: { fileId, page } };
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "text", id, position, data })];
	flow.edges = [...flow.edges, childEdge(fileId, id)];
	remapEdgeSides(new Set([id]));
	return id;
}

// Mind map (Studio 4a): ONE interactive canvas node holding the whole LLM topic
// tree, placed in open space near the source file (spiral scan avoids overlapping
// existing nodes). Collapsed by default — branches expand on click inside the
// node (see MindmapNode.svelte). Records the map on the file node (`mindmapRootId`)
// so it can offer an "Open mindmap" jump. Returns the mindmap node's id.
export function addMindmap(fileId: string, nodes: MindNode[]): string | null {
	const root = nodes.find((n) => n.parent === null);
	if (!root) return null;
	const measuredW = (n?: Node) =>
		(n as (Node & { measured?: { width?: number } }) | undefined)?.measured?.width ?? n?.width;
	const measuredH = (n?: Node) =>
		(n as (Node & { measured?: { height?: number } }) | undefined)?.measured?.height ?? n?.height;

	const src = flow.nodes.find((n) => n.id === fileId);
	const base = src?.position ?? { x: 400, y: 300 };
	const fileW = measuredW(src) ?? 220;
	const W = 380;
	const H = 260; // collapsed footprint estimate — grows once measured
	const GAP = 160;
	const occupied = flow.nodes
		.filter((n) => n.type !== "group")
		.map((n) => {
			const w = measuredW(n) ?? 320;
			const h = measuredH(n) ?? 200;
			return { x1: n.position.x, y1: n.position.y, x2: n.position.x + w, y2: n.position.y + h };
		});
	const t = findFreeOffset(
		{ minX: 0, minY: 0, maxX: W, maxY: H },
		occupied,
		base.x + fileW + GAP,
		base.y,
	);

	const id = nextNodeId();
	const data: MindmapData = {
		fileId,
		source: (src?.data as FileData | undefined)?.filename ?? "",
		nodes,
		// Root open by default so the first level shows; clicking root collapses all.
		expanded: { [root.id]: true },
		block: nextBlock(),
	};
	flow.nodes = [
		...flow.nodes.map((n) =>
			n.id === fileId ? { ...n, data: { ...n.data, mindmapRootId: id } } : n,
		),
		buildCardNode({ kind: "mindmap", id, position: t, data }),
	];
	flow.edges = [...flow.edges, childEdge(fileId, id)];
	remapEdgeSides(new Set([id]));
	return id;
}

/** Toggle whether a mind-map node's children are revealed (any node, any depth). */
export function toggleMindmapBranch(nodeId: string, branchId: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== nodeId) return n;
		const d = n.data as MindmapData;
		return {
			...n,
			data: { ...d, expanded: { ...d.expanded, [branchId]: !d.expanded?.[branchId] } },
		};
	});
}

/** Rename a mind map — edits the root topic's title (shown as the card name). */
export function renameMindmap(nodeId: string, title: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== nodeId) return n;
		const d = n.data as MindmapData;
		return {
			...n,
			data: { ...d, nodes: d.nodes.map((x) => (x.parent === null ? { ...x, title } : x)) },
		};
	});
}

/** Expand (reveal every internal node's children) or collapse the whole map. */
export function setMindmapExpandAll(nodeId: string, open: boolean): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== nodeId) return n;
		const d = n.data as MindmapData;
		const expanded: Record<string, boolean> = {};
		if (open) {
			const parents = new Set(d.nodes.map((x) => x.parent).filter(Boolean) as string[]);
			for (const pid of parents) expanded[pid] = true;
		}
		return { ...n, data: { ...d, expanded } };
	});
}

/** Lift one node + its whole subtree out of a mindmap node as a standalone text card. */
export function pinMindmapBranch(nodeId: string, branchId: string): string | null {
	const mm = flow.nodes.find((n) => n.id === nodeId);
	if (!mm) return null;
	const d = mm.data as MindmapData;
	const branch = d.nodes.find((x) => x.id === branchId);
	if (!branch) return null;
	const lines: string[] = [];
	const walk = (node: MindNode, depth: number) => {
		if (depth === 0) {
			lines.push(`**${node.title}**`);
			if (node.summary) lines.push(node.summary);
		} else {
			const indent = "  ".repeat(depth - 1);
			lines.push(`${indent}- **${node.title}**${node.summary ? ` — ${node.summary}` : ""}`);
		}
		for (const c of d.nodes.filter((x) => x.parent === node.id)) walk(c, depth + 1);
	};
	walk(branch, 0);
	const text = lines.join("\n");
	const id = nextNodeId();
	const w = mm.measured?.width ?? mm.width ?? 380;
	const data: TextData = { text, block: nextBlock() };
	flow.nodes = [
		...flow.nodes,
		buildCardNode({
			kind: "text",
			id,
			position: { x: mm.position.x + w + 48, y: mm.position.y },
			data,
		}),
	];
	flow.edges = [...flow.edges, childEdge(nodeId, id)];
	return id;
}

export function setFileStatus(id: string, status: FileData["status"]): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, status } } : n));
	// Keep the aggregate indexing toast in sync at the one status choke point.
	if (status === "indexing") startIndexing(id);
	else finishIndexing(id);
}

export function setFilePreview(id: string, preview: string): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, preview } } : n));
}

export function setFileHighlights(id: string, highlights: import("./cards").PdfHL[]): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, highlights } } : n));
}

/** Record Drive provenance on a file/text node once an import lands (enables Re-sync). */
export function setFileDrive(id: string, drive: import("./cards").DriveRef): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, drive } } : n));
}

export function setCardText(id: string, text: string): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n));
	kbSync.onTextChanged(id, text);
}

function setCardBlock(id: string, block: string): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, block } } : n));
}

export function bringToFront(ids: string[]): void {
	const z = nextZ(flow.nodes);
	flow.nodes = flow.nodes.map((n) => (ids.includes(n.id) ? { ...n, zIndex: z } : n));
}

export function sendToBack(ids: string[]): void {
	const z = prevZ(flow.nodes);
	flow.nodes = flow.nodes.map((n) => (ids.includes(n.id) ? { ...n, zIndex: z } : n));
}

/** Lock = position lock only (Miro-style): dragging is blocked, delete/edit still work. */
export function setLocked(ids: string[], locked: boolean): void {
	flow.nodes = flow.nodes.map((n) =>
		ids.includes(n.id) ? { ...n, draggable: !locked, data: { ...n.data, locked } } : n,
	);
}

export function cycleCardBlock(id: string): void {
	const n = flow.nodes.find((node) => node.id === id);
	if (!n) return;
	setCardBlock(id, cycleBlock((n.data as { block?: string }).block ?? "lime"));
}

export function duplicateNode(id: string): string {
	const src = flow.nodes.find((n) => n.id === id);
	if (!src) return "";
	const newId = nextNodeId();
	const data = JSON.parse(JSON.stringify(src.data)) as Record<string, unknown>;
	if ("streaming" in data) data.streaming = false;
	const srcW =
		(src as Node & { measured?: { width?: number } }).measured?.width ?? src.width ?? 400;
	// Place beside original — don't spread src to avoid copying SvelteFlow internals
	const node: Node = {
		id: newId,
		type: src.type ?? "card",
		position: { x: src.position.x + srcW + 40, y: src.position.y },
		data,
		width: src.width,
	};
	if (src.height != null) node.height = src.height;
	flow.nodes = [...flow.nodes, node];
	return newId;
}

export function duplicateSelected(): void {
	const selected = flow.nodes.filter((n) => n.selected);
	if (!selected.length) return;
	const newNodes: Node[] = selected.map((src) => {
		const newId = nextNodeId();
		const data = JSON.parse(JSON.stringify(src.data)) as Record<string, unknown>;
		if ("streaming" in data) data.streaming = false;
		const srcW =
			(src as Node & { measured?: { width?: number } }).measured?.width ?? src.width ?? 400;
		const node: Node = {
			id: newId,
			type: src.type ?? "card",
			position: { x: src.position.x + srcW + 40, y: src.position.y },
			data,
			width: src.width,
			selected: true,
		};
		if (src.height != null) node.height = src.height;
		return node;
	});
	flow.nodes = [...flow.nodes.map((n) => ({ ...n, selected: false })), ...newNodes];
}

// Purge removed file nodes' KB chunks + blobs before dropping them from the graph.
function cleanupRemovedNodes(ids: Set<string>): void {
	const fileNodes = flow.nodes
		.filter((n) => ids.has(n.id) && n.type === "file")
		.map((n) => ({ id: n.id, filename: (n.data as { filename?: string }).filename }));
	cleanupFileNodes(currentId, fileNodes);
}

export function deleteSelected(): void {
	const toDelete = new Set(flow.nodes.filter((n) => n.selected).map((n) => n.id));
	if (!toDelete.size) return;
	cleanupRemovedNodes(toDelete);
	flow.edges = flow.edges.filter((e) => !toDelete.has(e.source) && !toDelete.has(e.target));
	flow.nodes = flow.nodes.filter((n) => !toDelete.has(n.id));
}

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

export function addManualEdge(
	source: string,
	target: string,
	sourceHandle: string,
	targetHandle: string,
): void {
	const id = `e-${source}-${target}-${Date.now()}`;
	flow.edges = [...flow.edges, { id, source, target, sourceHandle, targetHandle, type: "bezier" }];
}

// ── Edge side-anchoring ───────────────────────────────────────────────────────
// All card types share one handle convention: top-s/top-t … left-s/left-t.
const SIDE_HANDLE_RE = /^(top|right|bottom|left)-(s|t)$/;

export function nodeCenter(n: {
	position: { x: number; y: number };
	measured?: { width?: number; height?: number };
	width?: number;
	height?: number;
	parentId?: string;
}): { x: number; y: number } {
	const w = n.measured?.width ?? n.width ?? 400;
	const h = n.measured?.height ?? n.height ?? 200;
	// Grouped nodes' position is relative to their group frame — add its offset
	// (single-level nesting only; groups can't contain groups in this codebase).
	const parent = n.parentId ? flow.nodes.find((p) => p.id === n.parentId) : undefined;
	const ox = parent?.position.x ?? 0;
	const oy = parent?.position.y ?? 0;
	return { x: ox + n.position.x + w / 2, y: oy + n.position.y + h / 2 };
}

/** The side of `from` that faces `to` — picked by the dominant axis between centers. */
export function facingSide(from: { x: number; y: number }, to: { x: number; y: number }): string {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
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
		return {
			...edge,
			sourceHandle: `${facingSide(sc, tc)}-s`,
			targetHandle: `${facingSide(tc, sc)}-t`,
		};
	});
}

// ── Group nodes ─────────────────────────────────────────────────────────────
// ponytail: parent-node approach — SvelteFlow handles drag-together natively.
export function groupNodes(ids: string[]): string {
	const selected = flow.nodes.filter((n) => ids.includes(n.id));
	if (selected.length < 2) return "";

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

	const groupId = nextNodeId();
	const groupNode: Node = {
		id: groupId,
		type: "group",
		position: { x: avgX - groupW / 2, y: avgY - groupH / 2 },
		data: { block: nextBlock() },
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
	void nameClusters([{ id: groupId, members: ids }]);
	return groupId;
}

// Dissolve a group: children keep their absolute position (relative pos + group
// origin) and lose their parent; the group frame node is removed.
export function ungroupNodes(groupId: string): void {
	const group = flow.nodes.find((n) => n.id === groupId && n.type === "group");
	if (!group) return;
	const gx = group.position.x;
	const gy = group.position.y;
	flow.nodes = flow.nodes
		.filter((n) => n.id !== groupId)
		.map((n) => {
			if (n.parentId !== groupId) return n;
			return {
				...n,
				parentId: undefined,
				position: { x: gx + n.position.x, y: gy + n.position.y },
			};
		});
}

// ── Clean Up — semantic force-clustering ───────────────────────────────────

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
export function applyPositions(positions: Record<string, { x: number; y: number }>): void {
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
	const unlocked = (n: Node) => !(n.data as { locked?: boolean }).locked;
	if (ids && ids.length >= 2) {
		const idSet = new Set(ids);
		targets = flow.nodes.filter(
			(n) => idSet.has(n.id) && n.type !== "group" && n.type !== "tag" && unlocked(n),
		);
	} else {
		targets = flow.nodes.filter(
			(n) => !n.parentId && n.type !== "group" && n.type !== "tag" && unlocked(n),
		);
	}
	if (targets.length < 2) return;

	const { cleanupArrange } = await import("$lib/ai/client");
	const canvas = currentCanvasId() || "default";
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

	// Cache cluster membership (cards sharing a grid cell) so tags can be synced to it.
	const cells = new Map<string, string[]>();
	for (const id in layout.nodes) {
		const { col, row } = layout.nodes[id];
		const k = `${col},${row}`;
		(cells.get(k) ?? cells.set(k, []).get(k)!).push(id);
	}
	cleanupClusters = [...cells.values()];

	pushHistory();
	applyPositions(placeLayout(layout, settings.clusterSpacing));
	syncClusterTags(cleanupClusters);
	void nameClusters();
}

// ── Cluster tags ──────────────────────────────────────────────────────────────
// Every Clean Up cluster (and every manual group) gets an auto-named 'tag' node
// anchored to its member ids — persists, undoes, pans/zooms for free (a normal
// node). repositionTags() floats it above the cluster's current bounding box.
let cleanupClusters: string[][] = [];

function clusterBox(
	ids: string[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
	const set = new Set(ids);
	let minX = Infinity,
		minY = Infinity,
		maxX = -Infinity,
		maxY = -Infinity,
		found = false;
	for (const n of flow.nodes) {
		if (!set.has(n.id)) continue;
		found = true;
		const w = n.measured?.width ?? n.width ?? 400;
		const h = n.measured?.height ?? n.height ?? 200;
		minX = Math.min(minX, n.position.x);
		minY = Math.min(minY, n.position.y);
		maxX = Math.max(maxX, n.position.x + w);
		maxY = Math.max(maxY, n.position.y + h);
	}
	return found ? { minX, minY, maxX, maxY } : null;
}

// Reconcile tag nodes with a fresh cluster set: reuse a tag whose old membership
// overlaps ≥50% (carrying its color and any user-given name), create one for a
// genuinely new cluster, and drop auto tags that matched nothing. Louvain output
// isn't stable across re-runs, so this is what lets renamed clusters survive CC.
function syncClusterTags(clusters: string[][]): void {
	const oldTags = flow.nodes.filter((n) => n.type === "tag");
	const old = oldTags.map((n) => {
		const d = n.data as TagData;
		return { key: clusterKey(d.anchor ?? []), ids: d.anchor ?? [] };
	});
	const keep = new Set<string>();
	const created: Node[] = [];
	let next = flow.nodes;
	clusters.forEach((members, i) => {
		if (members.length < 2) return;
		const bb = clusterBox(members);
		if (!bb) return;
		const m = matchCluster(members, old);
		if (m >= 0) {
			const t = oldTags[m];
			keep.add(t.id);
			const d = t.data as TagData;
			next = next.map((n) =>
				n.id === t.id
					? {
							...n,
							data: {
								...n.data,
								anchor: [...members],
								color: d.color ?? clusterColor(i),
								pending: d.userEdited ? d.pending : true,
							},
						}
					: n,
			);
		} else {
			created.push(
				buildCardNode({
					kind: "tag",
					id: nextNodeId(),
					position: { x: Math.round((bb.minX + bb.maxX) / 2 - 60), y: Math.round(bb.minY - 46) },
					data: {
						text: "",
						anchor: [...members],
						color: clusterColor(i),
						auto: true,
						pending: true,
					} as TagData,
				}),
			);
		}
	});
	// Drop auto tags that matched nothing this round; hand-made tags are left alone.
	const stale = oldTags.filter((n) => (n.data as TagData).auto && !keep.has(n.id)).map((n) => n.id);
	flow.nodes = [...next.filter((n) => !stale.includes(n.id)), ...created];
	repositionTags();
}

// Human-readable content type of a member node, so the namer can reflect it
// (e.g. "Data Mining PDFs"). Files → uppercased extension; others → their kind.
function memberKind(n: Node): string {
	if (n.type === "file") {
		const name = ((n.data as FileData).filename as string) ?? "";
		const ext = name.split(".").pop();
		return ext && ext !== name ? ext.toUpperCase() : "file";
	}
	if (n.type === "text") return "note";
	if (n.type === "card") return "chat";
	if (n.type === "web") return "web page";
	if (n.type === "mindmap") return "mind map";
	return "note";
}

// Batch-name every pending cluster/group tag via the small-tier backend endpoint.
// Fire-and-forget: called right after Clean Up / grouping, doesn't block the UI.
async function nameClusters(extra?: { id: string; members: string[] }[]): Promise<void> {
	const targets = [
		...flow.nodes
			.filter((n) => n.type === "tag" && (n.data as TagData).pending)
			.map((n) => ({ id: n.id, members: (n.data as TagData).anchor ?? [] })),
		...(extra ?? []),
	];
	if (!targets.length) return;
	const byId = new Map(flow.nodes.map((n) => [n.id, n]));
	const payload = targets.map((t) => ({
		id: t.id,
		members: t.members.flatMap((mid) => {
			const n = byId.get(mid);
			if (!n) return [];
			return [
				{
					id: mid,
					text: snippetOf(n),
					source: n.type === "file" ? ((n.data as FileData).filename as string) : undefined,
					kind: memberKind(n),
				},
			];
		}),
	}));
	const { cleanupName } = await import("$lib/ai/client");
	const names = await cleanupName(currentCanvasId() || "default", payload);
	flow.nodes = flow.nodes.map((n) => {
		const t = targets.find((x) => x.id === n.id);
		if (!t) return n;
		if (n.type === "tag") {
			const d = n.data as TagData;
			if (d.userEdited) return { ...n, data: { ...d, pending: false } };
			return { ...n, data: { ...d, text: names[n.id] ?? d.text, pending: false } };
		}
		return names[n.id] ? { ...n, data: { ...n.data, label: names[n.id] } } : n;
	});
	repositionTags();
}

export function setTagText(id: string, text: string): void {
	flow.nodes = flow.nodes.map((n) =>
		n.id === id ? { ...n, data: { ...n.data, text, userEdited: true } } : n,
	);
}

export function setGroupLabel(id: string, label: string): void {
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, label } } : n));
}

// Float every cluster tag above its anchor cluster's current bounding box. Called
// after Clean Up, spacing changes, and drags so labels track their clusters.
export function repositionTags(): void {
	let changed = false;
	const next = flow.nodes.map((n) => {
		if (n.type !== "tag") return n;
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

export function renameCard(id: string, title: string): void {
	const t = title.trim();
	if (!t) return;
	flow.nodes = flow.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, title: t } } : n));
}
