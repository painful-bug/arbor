// ── Blob registry ────────────────────────────────────────────────────────────
// In-memory Map backed by ~/.loom/blobs (via Tauri store commands) so bytes
// survive restarts without re-dropping. Falls back to no persistence in browser mode.
const blobs = new Map<string, { bytes: ArrayBuffer; mime: string; name: string }>();

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

export function putFileBlob(id: string, bytes: ArrayBuffer, mime: string, name: string): void {
	blobs.set(id, { bytes, mime, name });
	if (!isTauri()) return;
	import('@tauri-apps/api/core').then(({ invoke }) => {
		void invoke('blob_write', { id, data: arrayBufferToBase64(bytes), mime, name });
	});
}

export function getFileBlob(id: string): { bytes: ArrayBuffer; mime: string; name: string } | undefined {
	return blobs.get(id);
}

export function hasFileBlob(id: string): boolean {
	return blobs.has(id);
}

// Load bytes from ~/.loom/blobs for known file node IDs so re-drops aren't needed after restart.
export async function hydrateFileBlobs(ids: string[]): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import('@tauri-apps/api/core');
	await Promise.all(
		ids.map(async (id) => {
			if (blobs.has(id)) return;
			const [b64, metaStr] = await Promise.all([
				invoke<string | null>('blob_read', { id }),
				invoke<string | null>('store_read', { rel: `blobs/${id}.meta.json` })
			]);
			if (!b64 || !metaStr) return;
			const meta = JSON.parse(metaStr) as { mime: string; name: string };
			const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
			blobs.set(id, { bytes, mime: meta.mime, name: meta.name });
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

// ── Desktop file IO (Tauri commands; no-ops/throws in browser dev) ───────────
export const canUseFs = isTauri;

export async function readFile(path: string): Promise<string> {
	const { invoke } = await import('@tauri-apps/api/core');
	return invoke<string>('file_read', { path });
}
export async function writeFile(path: string, contents: string): Promise<void> {
	const { invoke } = await import('@tauri-apps/api/core');
	await invoke('file_write', { path, contents });
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
