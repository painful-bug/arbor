// Card clipboard: copy/cut/paste of canvas nodes, same-session only.
//
// ponytail: no cross-window/cross-app JSON interop — writing a JSON payload to
// the OS clipboard would either break plain-text paste elsewhere or require
// custom MIME clipboard types browsers don't reliably support yet. The plain
// text we write IS real card content (for pasting into other apps); the OS
// clipboard's current text is only used to detect that the user copied
// something else since our last copy, so a stale in-memory payload doesn't
// silently get pasted back. Upgrade path: ClipboardItem multi-format write,
// if/when custom MIME types are broadly supported in the target webviews.
import type { Edge, Node, XYPosition } from "@xyflow/svelte";
import { kbAdd } from "$lib/ai/client";
import { apiFetch } from "$lib/api";
import { cardPlainText } from "./cards";
import { currentCanvasId, deleteSelected, flow, nextNodeId, setFileStatus } from "./store.svelte";

export const ARBOR_CLIP_MARKER = "arbor-cards/v1";

const CUT_BLOB_CAP = 20 * 1024 * 1024; // don't inline bigger files into the in-memory payload

interface ClipNode {
	type: string;
	data: Record<string, unknown>;
	dx: number;
	dy: number;
	width?: number;
	height?: number;
	srcId: string;
	/** Cut file cards only: bytes captured before delete removes the backend blob. */
	blob?: { bytes: string; mime: string; name: string };
}

interface ClipEdge {
	source: string;
	target: string;
	sourceHandle?: string | null;
	targetHandle?: string | null;
}

export interface ClipPayload {
	marker: typeof ARBOR_CLIP_MARKER;
	canvasId: string;
	nodes: ClipNode[];
	edges: ClipEdge[];
}

/**
 * Pure: selection → payload. Positions are relative to the selection's bounding
 * box (so paste can drop it anywhere); group nodes bring their children along,
 * flattened to absolute positions with the parent link dropped (v1 doesn't
 * reconstruct group hierarchy on paste — pasted children land as plain nodes).
 * Edges crossing outside the selection are dropped; tag anchors are filtered to
 * only the ids actually being copied.
 */
export function serializeSelection(
	selected: Node[],
	allNodes: Node[],
	edges: Edge[],
	canvasId: string,
): ClipPayload {
	const included = new Map<string, Node>();
	for (const n of selected) {
		included.set(n.id, n);
		if (n.type !== "group") continue;
		for (const child of allNodes) {
			if (child.parentId !== n.id) continue;
			included.set(child.id, {
				...child,
				parentId: undefined,
				position: { x: n.position.x + child.position.x, y: n.position.y + child.position.y },
			});
		}
	}
	const nodes = [...included.values()];
	const ids = new Set(included.keys());

	const minX = Math.min(...nodes.map((n) => n.position.x));
	const minY = Math.min(...nodes.map((n) => n.position.y));

	const clipNodes: ClipNode[] = nodes.map((n) => {
		const data = JSON.parse(JSON.stringify(n.data)) as Record<string, unknown>;
		if ("streaming" in data) data.streaming = false;
		if (n.type === "tag" && Array.isArray(data.anchor)) {
			data.anchor = (data.anchor as string[]).filter((id) => ids.has(id));
		}
		return {
			type: n.type ?? "card",
			data,
			dx: n.position.x - minX,
			dy: n.position.y - minY,
			srcId: n.id,
			...(n.width != null ? { width: n.width } : {}),
			...(n.height != null ? { height: n.height } : {}),
		};
	});

	const clipEdges: ClipEdge[] = edges
		.filter((e) => ids.has(e.source) && ids.has(e.target))
		.map((e) => ({
			source: e.source,
			target: e.target,
			sourceHandle: e.sourceHandle,
			targetHandle: e.targetHandle,
		}));

	return { marker: ARBOR_CLIP_MARKER, canvasId, nodes: clipNodes, edges: clipEdges };
}

/** Pure: payload → fresh nodes/edges at a paste origin, with an id remap. */
export function materialize(
	p: ClipPayload,
	at: XYPosition,
	nextId: () => string,
): { nodes: Node[]; edges: Edge[]; idMap: Record<string, string> } {
	const idMap: Record<string, string> = {};
	for (const n of p.nodes) idMap[n.srcId] = nextId();

	const nodes: Node[] = p.nodes.map((n) => {
		const data = { ...n.data };
		if (n.type === "tag" && Array.isArray(data.anchor)) {
			data.anchor = (data.anchor as string[]).map((id) => idMap[id] ?? id);
		}
		const node: Node = {
			id: idMap[n.srcId],
			type: n.type,
			position: { x: at.x + n.dx, y: at.y + n.dy },
			data,
		};
		if (n.width != null) node.width = n.width;
		if (n.height != null) node.height = n.height;
		return node;
	});

	const edges: Edge[] = p.edges
		.filter((e) => idMap[e.source] && idMap[e.target])
		.map((e) => ({
			id: `e-${idMap[e.source]}-${idMap[e.target]}`,
			source: idMap[e.source],
			target: idMap[e.target],
			type: "bezier",
			...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
			...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
		}));

	return { nodes, edges, idMap };
}

function toBase64(buf: ArrayBuffer): string {
	let binary = "";
	const bytes = new Uint8Array(buf);
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

function fromBase64(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes.buffer;
}

const blobUrl = (canvas: string, id: string) =>
	`/api/blobs/${encodeURIComponent(`${canvas}:${id}`)}`;

// In-memory clipboard: this session only (see file header for why).
let internal: { payload: ClipPayload; osText: string } | null = null;

/** Whether a copy/cut has been made this session (gates the Paste menu item). */
export function hasClipboard(): boolean {
	return internal !== null;
}

/**
 * Whether a native paste event's OS clipboard text is still what our last
 * copy/cut wrote — i.e. this paste should materialize cards, not fall through
 * to Drive-link/URL/plain-text handling. Synchronous so callers can decide
 * before the paste event needs `preventDefault()`.
 */
export function isInternalPaste(osText: string): boolean {
	return !!internal && internal.osText === osText;
}

/** Copy (or cut) the current selection. */
export async function copySelection(cut = false): Promise<void> {
	const sel = flow.nodes.filter((n) => n.selected);
	if (!sel.length) return;

	const canvas = currentCanvasId() || "default";
	const payload = serializeSelection(sel, flow.nodes, flow.edges, canvas);
	const osText = sel.map(cardPlainText).filter(Boolean).join("\n\n---\n\n");

	if (cut) {
		// Capture file bytes now — delete below removes the backend blob, and
		// paste-after-cut needs something to restore.
		await Promise.all(
			payload.nodes
				.filter((n) => n.type === "file")
				.map(async (n) => {
					try {
						const res = await apiFetch(blobUrl(canvas, n.srcId));
						if (!res.ok) return;
						const buf = await res.arrayBuffer();
						if (buf.byteLength > CUT_BLOB_CAP) return; // too large — paste-after-cut skips bytes
						n.blob = {
							bytes: toBase64(buf),
							mime: res.headers.get("Content-Type") ?? "",
							name: decodeURIComponent(res.headers.get("X-Filename") ?? ""),
						};
					} catch {
						/* best-effort — paste-after-cut just won't restore this file's bytes */
					}
				}),
		);
	}

	internal = { payload, osText };
	await navigator.clipboard.writeText(osText).catch(() => {});
	if (cut) deleteSelected();
}

/** Paste the clipboard at a flow position. Returns the new node ids (empty if nothing to paste). */
export async function pasteAt(at: XYPosition): Promise<string[]> {
	const osText = await navigator.clipboard.readText().catch(() => "");
	if (!internal || internal.osText !== osText) return []; // stale — OS clipboard moved on

	const payload = internal.payload;
	const canvas = currentCanvasId() || "default";
	const { nodes, edges, idMap } = materialize(payload, at, nextNodeId);

	flow.nodes = [...flow.nodes.map((n) => ({ ...n, selected: false })), ...nodes];
	flow.edges = [...flow.edges, ...edges];

	await Promise.all(
		payload.nodes
			.filter((n) => n.type === "file")
			.map((n) => rekeyFileBlob(n, idMap[n.srcId], payload.canvasId, canvas)),
	);

	return nodes.map((n) => n.id);
}

async function rekeyFileBlob(
	n: ClipNode,
	newId: string | undefined,
	srcCanvas: string,
	destCanvas: string,
): Promise<void> {
	if (!newId) return;
	try {
		let bytes: ArrayBuffer;
		let mime: string;
		let name: string;
		if (n.blob) {
			bytes = fromBase64(n.blob.bytes);
			mime = n.blob.mime;
			name = n.blob.name;
		} else {
			const res = await apiFetch(blobUrl(srcCanvas, n.srcId));
			if (!res.ok) return; // source blob gone — nothing to duplicate
			bytes = await res.arrayBuffer();
			mime = res.headers.get("Content-Type") ?? "";
			name = decodeURIComponent(res.headers.get("X-Filename") ?? "");
		}
		await apiFetch(blobUrl(destCanvas, newId), {
			method: "PUT",
			headers: {
				"Content-Type": mime || "application/octet-stream",
				"X-Filename": encodeURIComponent(name),
			},
			body: bytes,
		});
		// Cross-canvas paste: index into the destination KB too (same-canvas paste
		// keeps the one KB entry the original file already has under its filename).
		if (srcCanvas !== destCanvas) {
			const filename = (n.data as { filename?: string }).filename ?? name;
			const chunks = await kbAdd(destCanvas, filename, mime, bytes);
			setFileStatus(newId, chunks > 0 ? "ready" : "error");
		}
	} catch {
		/* best-effort — the pasted card just stays without bytes/KB content */
	}
}
