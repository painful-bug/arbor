// ── Blob registry ────────────────────────────────────────────────────────────
// In-memory Map backed by the backend (~/.arbor/blobs) so bytes survive restarts
// without re-dropping. Bytes go over the wire raw; filename rides in X-Filename
// (URI-encoded so non-ASCII names stay header-safe).

import { SvelteMap } from "svelte/reactivity";
import { apiFetch } from "$lib/api";
import { currentCanvasId } from "$lib/canvas/store.svelte";

// Reactive map: FileCard reads getFileBlob() inside a $derived, so writes here
// (putFileBlob / hydrateFileBlobs, both async/late) must trigger a re-render.
const blobs = new SvelteMap<string, { bytes: ArrayBuffer; mime: string; name: string }>();

// Blobs are keyed by canvas so per-canvas-reused node IDs (n1, n2, …) can't collide
// across canvases — both in memory and on the backend (~/.arbor/blobs/<key>).
const key = (id: string) => `${currentCanvasId()}:${id}`;
const blobUrl = (id: string) => `/api/blobs/${encodeURIComponent(key(id))}`;

// Cap on raw byte buffers held in the webview. Bytes are only needed by the open
// file panel (and once, transiently, for thumbnail generation) — everything else
// renders from small cached thumbnails. Evicted entries re-fetch from the backend.
const MAX_BLOBS = 3;
function evictBlobs(): void {
	for (const k of blobs.keys()) {
		if (blobs.size <= MAX_BLOBS) break;
		blobs.delete(k);
		hydrateTried.delete(k); // allow re-fetch later
	}
}

export function putFileBlob(id: string, bytes: ArrayBuffer, mime: string, name: string): void {
	blobs.set(key(id), { bytes, mime, name });
	evictBlobs();
	void apiFetch(blobUrl(id), {
		method: "PUT",
		headers: {
			"Content-Type": mime || "application/octet-stream",
			"X-Filename": encodeURIComponent(name),
		},
		body: bytes,
	});
}

export function getFileBlob(
	id: string,
): { bytes: ArrayBuffer; mime: string; name: string } | undefined {
	return blobs.get(key(id));
}

// Drop a file's bytes + thumbnail from memory and the backend when its node is deleted.
export function deleteFileBlob(id: string): void {
	const k = key(id);
	blobs.delete(k);
	thumbs.delete(k);
	hydrateTried.delete(k);
	thumbTried.delete(k);
	void apiFetch(blobUrl(id), { method: "DELETE" }).catch(() => {});
	void apiFetch(thumbApiUrl(id), { method: "DELETE" }).catch(() => {});
}

// Negative cache: keys we already tried to hydrate. Without it, a 404'd blob stays
// "missing" forever and the Canvas hydrate effect re-fetches it on every flow.nodes
// reassignment — i.e. every drag frame and stream tick.
const hydrateTried = new Set<string>();

// Load bytes from the backend for known file node IDs so re-drops aren't needed after restart.
export async function hydrateFileBlobs(ids: string[]): Promise<void> {
	await Promise.all(
		ids.map(async (id) => {
			const k = key(id);
			if (blobs.has(k) || hydrateTried.has(k)) return;
			hydrateTried.add(k);
			try {
				const res = await apiFetch(blobUrl(id));
				if (!res.ok) return; // 404 (never stored) — stays negative-cached
				const bytes = await res.arrayBuffer();
				const mime = res.headers.get("Content-Type") ?? "";
				const name = decodeURIComponent(res.headers.get("X-Filename") ?? id);
				blobs.set(k, { bytes, mime, name });
				evictBlobs();
			} catch {
				hydrateTried.delete(k); // backend unreachable — allow a later retry
			}
		}),
	);
}

// ── Thumbnails ────────────────────────────────────────────────────────────────
// Card faces paint a small cached thumbnail instead of holding raw file bytes:
// generated once (from in-memory bytes right after a drop, or one transient
// fetch), persisted to the backend blob store under `<key>:thumb`, and cached
// in memory as a data URL. A 19-PDF canvas costs ~19 small images, not ~60MB
// of ArrayBuffers plus 19 full pdf.js parses per session.
const thumbs = new SvelteMap<string, string>();
const thumbTried = new Set<string>();
const THUMB_W = 480;
const thumbApiUrl = (id: string) => `/api/blobs/${encodeURIComponent(`${key(id)}:thumb`)}`;

export function getThumb(id: string): string | undefined {
	return thumbs.get(key(id));
}

async function makePdfThumb(bytes: ArrayBuffer): Promise<string> {
	const pdfjs = await import("pdfjs-dist");
	pdfjs.GlobalWorkerOptions.workerSrc = (
		await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
	).default;
	// slice(0): pdf.js transfers the buffer to its worker, which would detach ours.
	const task = pdfjs.getDocument({ data: bytes.slice(0) });
	const doc = await task.promise;
	try {
		const page = await doc.getPage(1);
		const vp1 = page.getViewport({ scale: 1 });
		const viewport = page.getViewport({ scale: THUMB_W / vp1.width });
		const canvas = document.createElement("canvas");
		canvas.width = Math.round(viewport.width);
		canvas.height = Math.round(viewport.height);
		await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport }).promise;
		return canvas.toDataURL("image/jpeg", 0.8);
	} finally {
		void task.destroy(); // frees the parsed doc + worker memory
	}
}

async function makeImageThumb(bytes: ArrayBuffer, mime: string): Promise<string> {
	const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
	const scale = Math.min(1, THUMB_W / bmp.width);
	const canvas = document.createElement("canvas");
	canvas.width = Math.max(1, Math.round(bmp.width * scale));
	canvas.height = Math.max(1, Math.round(bmp.height * scale));
	canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
	bmp.close();
	// PNG keeps alpha for logos/diagrams; JPEG sources compress as JPEG.
	return mime === "image/jpeg"
		? canvas.toDataURL("image/jpeg", 0.8)
		: canvas.toDataURL("image/png");
}

/** Ensure a thumbnail exists for a pdf/image file node (memory → backend → generate). */
export async function hydrateThumb(id: string, kind: FileKind): Promise<void> {
	if (kind !== "pdf" && kind !== "image") return;
	const k = key(id);
	if (thumbs.has(k) || thumbTried.has(k)) return;
	thumbTried.add(k);
	try {
		const cached = await apiFetch(thumbApiUrl(id));
		if (cached.ok) {
			thumbs.set(k, await cached.text());
			return;
		}
		let entry = blobs.get(k);
		if (!entry) {
			const res = await apiFetch(blobUrl(id));
			if (!res.ok) return; // never stored — stays negative-cached
			entry = {
				bytes: await res.arrayBuffer(),
				mime: res.headers.get("Content-Type") ?? "",
				name: "",
			};
			// Transient: bytes used for the thumbnail then dropped, not put in `blobs`.
		}
		const url =
			kind === "pdf" ? await makePdfThumb(entry.bytes) : await makeImageThumb(entry.bytes, entry.mime);
		thumbs.set(k, url);
		void apiFetch(thumbApiUrl(id), {
			method: "PUT",
			headers: { "Content-Type": "text/plain", "X-Filename": "thumb" },
			body: url,
		}).catch(() => {});
	} catch {
		thumbTried.delete(k); // transient failure — retry on next mount
	}
}

export type FileKind = "pdf" | "markdown" | "text" | "docx" | "image" | "other";

// Best-effort MIME from extension (used when Tauri drag-drop gives only a path).
export function mimeFromExt(ext: string): string {
	const m: Record<string, string> = {
		pdf: "application/pdf",
		md: "text/markdown",
		markdown: "text/markdown",
		docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		png: "image/png",
		jpg: "image/jpeg",
		jpeg: "image/jpeg",
		gif: "image/gif",
		webp: "image/webp",
		svg: "image/svg+xml",
		txt: "text/plain",
		csv: "text/csv",
		json: "application/json",
		log: "text/plain",
	};
	return m[ext.toLowerCase()] ?? "";
}

export function kindOf(name: string, mime: string): FileKind {
	const ext = name.split(".").pop()?.toLowerCase() ?? "";
	if (mime === "application/pdf" || ext === "pdf") return "pdf";
	if (ext === "md" || ext === "markdown") return "markdown";
	if (ext === "docx" || mime.includes("officedocument.wordprocessing")) return "docx";
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("text/") || ["txt", "csv", "json", "log"].includes(ext)) return "text";
	return "other";
}

// ── Desktop file IO ───────────────────────────────────────────────────────────
// read/write go to the backend HTTP API; open_path stays Tauri (OS shell open).
export const canUseFs = (): boolean =>
	typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readFile(path: string): Promise<string> {
	const { apiFetch } = await import("$lib/api");
	const res = await apiFetch(`/api/files/read?path=${encodeURIComponent(path)}`);
	if (!res.ok) throw new Error(await res.text());
	return res.text();
}
export async function writeFile(path: string, contents: string): Promise<void> {
	const { apiFetch } = await import("$lib/api");
	const res = await apiFetch("/api/files/write", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ path, contents }),
	});
	if (!res.ok) throw new Error(await res.text());
}
export async function openPath(path: string): Promise<void> {
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("open_path", { path });
}

// Plain-text extraction for preview/edit. PDFs are rendered separately (pdfjs); here
// we only handle the text-ish kinds. Returns '' for binary kinds.
export async function extractText(bytes: ArrayBuffer, kind: FileKind): Promise<string> {
	if (kind === "markdown" || kind === "text") return new TextDecoder().decode(bytes);
	if (kind === "docx") {
		const mammoth = await import("mammoth");
		const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
		return value; // HTML
	}
	return "";
}
