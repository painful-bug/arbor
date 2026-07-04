// Card node construction: the shared node factory + per-kind frame defaults for
// every card type placed on the canvas. Pure module — no store imports, no I/O.
import type { Edge, Node, XYPosition } from "@xyflow/svelte";
import type { AgentEvent } from "$lib/ai/client";

// Nodes that already played their entrance animation this session. With
// viewport-culled rendering (onlyRenderVisibleElements) cards re-mount every time
// they pan back into view — the 480ms bounce should play once per node, not per pan.
export const animatedOnce = new Set<string>();

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

// Web embed card: an interactive iframe of a URL pasted/dropped/clicked onto the canvas.
export interface WebData {
	url: string;
	title?: string;
	block: string;
	[key: string]: unknown;
}

// Normalized highlight rect for a PDF page (coords 0–1 relative to page box).
export interface PdfHL {
	page: number;
	x: number;
	y: number;
	w: number;
	h: number;
	color: string; // CSS color string, e.g. 'rgba(255,222,89,0.45)'
	text?: string; // selected text content, used for Send-to-chat
	note?: string; // optional sticky comment attached to this highlight
}

// File card on the canvas: shows a preview of a dropped file + indexing progress.
export interface FileData {
	filename: string;
	status: "indexing" | "ready" | "error";
	block: string;
	mime: string;
	kind: import("$lib/files").FileKind;
	path?: string;
	preview?: string;
	highlights?: PdfHL[];
	/** Set once a Studio mind map has been generated for this file — id of the map's
	 *  root card, so the file node can offer an "Open mindmap" jump. */
	mindmapRootId?: string;
	[key: string]: unknown;
}

// Text card (user markdown note).
export interface TextData {
	text: string;
	block: string;
	// Set when the note was spawned from a PDF selection: the source file node + page,
	// so the note can jump back to the exact passage (Highlight → Note backlink).
	sourceRef?: { fileId: string; page: number };
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

/** Last turn helper — the one being streamed / replied to. */
export const lastTurn = (d: CardData): Turn => d.turns[d.turns.length - 1];

/** Node kinds the factory can build (xyflow node `type` values). */
export type CardKind = "card" | "web" | "file" | "text" | "tag";

const BLOCKS = ["lime", "lilac", "cream", "pink", "mint", "coral"];
let blockIdx = 0;

/** Next pastel block name in the shared cycle (consecutive cards differ in color). */
export function nextBlock(): string {
	return BLOCKS[blockIdx++ % BLOCKS.length];
}

/** Next block after `current` in the palette order (color tool cycling). */
export function cycleBlock(current: string): string {
	return BLOCKS[(BLOCKS.indexOf(current) + 1) % BLOCKS.length];
}

// Per-kind frame defaults. Height is content-driven for card/text (persisted width
// only); web/file get a fixed initial box.
const FRAME: Record<CardKind, { width?: number; height?: number }> = {
	card: { width: 400 },
	web: { width: 480, height: 560 },
	file: { width: 220, height: 280 },
	text: { width: 320 },
	tag: { width: 120 },
};

/**
 * Build a canvas node of the given kind at a position. Caller supplies the id
 * (store owns the counter) and kind-specific `data`; the frame (type/size) comes
 * from per-kind defaults.
 */
export function buildCardNode(opts: {
	kind: CardKind;
	id: string;
	position: XYPosition;
	data: Record<string, unknown>;
}): Node {
	return {
		id: opts.id,
		type: opts.kind,
		position: opts.position,
		data: opts.data,
		...FRAME[opts.kind],
	};
}

/** Parent→child edge for a branched card. */
export function childEdge(source: string, target: string, animated = false): Edge {
	const edge: Edge = { id: `e-${source}-${target}`, source, target, type: "bezier" };
	if (animated) edge.animated = true;
	return edge;
}

/** Human-readable title for a node, used by Synthesize's `[Card: title]` prefix. */
export function cardTitle(node: Node): string {
	const d = node.data as Record<string, unknown>;
	if (node.type === "card")
		return (d.title as string) || lastTurn(d as CardData)?.prompt || "Untitled";
	if (node.type === "text") return ((d.text as string) ?? "").slice(0, 60) || "Note";
	if (node.type === "file") return (d.filename as string) ?? "File";
	if (node.type === "web") return (d.title as string) ?? (d.url as string) ?? "Link";
	return node.type ?? "";
}

/** Plain-text content of a node, for the Synthesize action and export. */
export function cardPlainText(node: Node): string {
	const d = node.data as Record<string, unknown>;
	if (node.type === "card") {
		const turns = (d.turns as Turn[]) ?? [];
		return turns.map((t) => `**You:** ${t.prompt}\n\n**AI:** ${t.answer}`).join("\n\n");
	}
	if (node.type === "text") return (d.text as string) ?? "";
	if (node.type === "file") return (d.preview as string) ?? "";
	if (node.type === "web") return (d.title as string) ?? (d.url as string) ?? "";
	return "";
}
