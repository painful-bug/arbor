// Canvas persistence plumbing: the index of canvases + per-canvas docs, stored in
// the backend (SQLite) over HTTP. Writes are fire-and-forget — the in-memory flow
// state is the source of truth during a session; persistence is backup.
import type { Edge, Node } from "@xyflow/svelte";
import { apiJson, apiPut } from "$lib/api";
import type { Turn } from "./cards";

export interface CanvasMeta {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

export interface CanvasDoc extends CanvasMeta {
	nodes: Node[];
	edges: Edge[];
	session?: Turn[];
}

export interface CanvasIndex {
	current: string;
	list: CanvasMeta[];
}

/** New unique canvas id. */
export const uid = (): string =>
	`c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Fresh empty canvas doc. */
export function newDoc(name: string): CanvasDoc {
	const now = Date.now();
	return { id: uid(), name, createdAt: now, updatedAt: now, nodes: [], edges: [] };
}

/** Load the canvas index (current id + metadata list). */
export async function readIndex(): Promise<CanvasIndex> {
	return apiJson<CanvasIndex>("/api/canvases");
}

/** Persist the canvas index. Fire-and-forget; failures are logged, not thrown. */
export function writeIndex(current: string, list: CanvasMeta[]): void {
	apiPut("/api/canvases", { current, list }).catch((e) => console.error("[persist]", e));
}

// In-memory doc cache: populated on load/write so Library.svelte can show previews sync.
const docCache = new Map<string, CanvasDoc>();

/** Load one canvas doc; null on 404 or unreachable backend. Populates the cache. */
export async function loadDoc(id: string): Promise<CanvasDoc | null> {
	try {
		const doc = await apiJson<CanvasDoc>(`/api/canvases/${id}`);
		docCache.set(id, doc);
		return doc;
	} catch {
		return null; // 404 (deleted/never-written) or backend unreachable
	}
}

/** Synchronous doc lookup from cache — used by Library for thumbnails without await. */
export function getCachedDoc(id: string): CanvasDoc | null {
	return docCache.get(id) ?? null;
}

/** Persist one canvas doc. Fire-and-forget; failures are logged, not thrown. */
export function writeDoc(doc: CanvasDoc): void {
	docCache.set(doc.id, doc);
	apiPut(`/api/canvases/${doc.id}`, doc).catch((e) => console.error("[persist]", e));
}
