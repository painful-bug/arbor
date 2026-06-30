// ── Blob registry ────────────────────────────────────────────────────────────
// In-memory Map backed by the backend (~/.arbor/blobs) so bytes survive restarts
// without re-dropping. Bytes go over the wire raw; filename rides in X-Filename
// (URI-encoded so non-ASCII names stay header-safe).
import { apiFetch } from '$lib/api';
import { currentCanvasId } from '$lib/canvas/store.svelte';
import { SvelteMap } from 'svelte/reactivity';

// Reactive map: FileCard reads getFileBlob() inside a $derived, so writes here
// (putFileBlob / hydrateFileBlobs, both async/late) must trigger a re-render.
const blobs = new SvelteMap<string, { bytes: ArrayBuffer; mime: string; name: string }>();

// Blobs are keyed by canvas so per-canvas-reused node IDs (n1, n2, …) can't collide
// across canvases — both in memory and on the backend (~/.arbor/blobs/<key>).
const key = (id: string) => `${currentCanvasId()}:${id}`;
const blobUrl = (id: string) => `/api/blobs/${encodeURIComponent(key(id))}`;

export function putFileBlob(id: string, bytes: ArrayBuffer, mime: string, name: string): void {
	blobs.set(key(id), { bytes, mime, name });
	void apiFetch(blobUrl(id), {
		method: 'PUT',
		headers: { 'Content-Type': mime || 'application/octet-stream', 'X-Filename': encodeURIComponent(name) },
		body: bytes
	});
}

export function getFileBlob(id: string): { bytes: ArrayBuffer; mime: string; name: string } | undefined {
	return blobs.get(key(id));
}

// Drop a file's bytes from memory and the backend when its node is deleted.
export function deleteFileBlob(id: string): void {
	blobs.delete(key(id));
	void apiFetch(blobUrl(id), { method: 'DELETE' }).catch(() => {});
}

// Load bytes from the backend for known file node IDs so re-drops aren't needed after restart.
export async function hydrateFileBlobs(ids: string[]): Promise<void> {
	await Promise.all(
		ids.map(async (id) => {
			if (blobs.has(key(id))) return;
			const res = await apiFetch(blobUrl(id));
			if (!res.ok) return; // 404 (never stored) or backend unreachable
			const bytes = await res.arrayBuffer();
			const mime = res.headers.get('Content-Type') ?? '';
			const name = decodeURIComponent(res.headers.get('X-Filename') ?? id);
			blobs.set(key(id), { bytes, mime, name });
		})
	);
}

export type FileKind = 'pdf' | 'markdown' | 'text' | 'docx' | 'image' | 'other';

// Best-effort MIME from extension (used when Tauri drag-drop gives only a path).
export function mimeFromExt(ext: string): string {
	const m: Record<string, string> = {
		pdf: 'application/pdf',
		md: 'text/markdown', markdown: 'text/markdown',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
		gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
		txt: 'text/plain', csv: 'text/csv', json: 'application/json', log: 'text/plain',
	};
	return m[ext.toLowerCase()] ?? '';
}

export function kindOf(name: string, mime: string): FileKind {
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
	if (ext === 'md' || ext === 'markdown') return 'markdown';
	if (ext === 'docx' || mime.includes('officedocument.wordprocessing')) return 'docx';
	if (mime.startsWith('image/')) return 'image';
	if (mime.startsWith('text/') || ['txt', 'csv', 'json', 'log'].includes(ext)) return 'text';
	return 'other';
}

// ── Desktop file IO ───────────────────────────────────────────────────────────
// read/write go to the backend HTTP API; open_path stays Tauri (OS shell open).
export const canUseFs = (): boolean =>
	typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function readFile(path: string): Promise<string> {
	const { apiFetch } = await import('$lib/api');
	const res = await apiFetch(`/api/files/read?path=${encodeURIComponent(path)}`);
	if (!res.ok) throw new Error(await res.text());
	return res.text();
}
export async function writeFile(path: string, contents: string): Promise<void> {
	const { apiFetch } = await import('$lib/api');
	const res = await apiFetch('/api/files/write', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path, contents })
	});
	if (!res.ok) throw new Error(await res.text());
}
export async function openPath(path: string): Promise<void> {
	const { invoke } = await import('@tauri-apps/api/core');
	await invoke('open_path', { path });
}

// Plain-text extraction for preview/edit. PDFs are rendered separately (pdfjs); here
// we only handle the text-ish kinds. Returns '' for binary kinds.
export async function extractText(bytes: ArrayBuffer, kind: FileKind): Promise<string> {
	if (kind === 'markdown' || kind === 'text') return new TextDecoder().decode(bytes);
	if (kind === 'docx') {
		const mammoth = await import('mammoth');
		const { value } = await mammoth.convertToHtml({ arrayBuffer: bytes });
		return value; // HTML
	}
	return '';
}
