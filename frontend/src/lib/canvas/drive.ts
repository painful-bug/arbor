// Google Drive paste-a-link import. URL recognition is a quick host check —
// the backend (routes/google.ts, google/drive.ts) does the real parsing,
// resolution, and content fetch, so Drive bytes never round-trip through the
// frontend. This module: recognize the link, create placeholder cards, stream
// the import's progress onto them.
import type { XYPosition } from "@xyflow/svelte";
import { apiFetch } from "$lib/api";
import { kindOf } from "$lib/files";
import { scheduleAutolink } from "./autolink";
import type { DriveRef, FileData, TextData } from "./cards";
import {
	addFileCard,
	addTextCard,
	currentCanvasId,
	flow,
	groupNodes,
	setCardText,
	setFileDrive,
	setFileStatus,
	setGroupLabel,
} from "./store.svelte";

export function isDriveUrl(text: string): boolean {
	let u: URL;
	try {
		u = new URL(text.trim());
	} catch {
		return false;
	}
	return u.hostname === "drive.google.com" || u.hostname === "docs.google.com";
}

interface DrivePlan {
	mode: "export" | "download" | "skip";
	mime?: string;
	ext?: string;
	card?: "text" | "file";
	reason?: string;
}

interface ResolvedDriveFile {
	id: string;
	name: string;
	mimeType: string;
	modifiedTime: string;
	plan: DrivePlan;
}

interface ResolveResponse {
	kind: "file" | "folder";
	folderName?: string;
	files: ResolvedDriveFile[];
}

/** The filename this import will be stored under (export mode appends the target extension). */
function displayName(f: ResolvedDriveFile): string {
	if (f.plan.mode !== "export" || !f.plan.ext) return f.name;
	const suffix = `.${f.plan.ext}`;
	return f.name.toLowerCase().endsWith(suffix) ? f.name : `${f.name}${suffix}`;
}

function effectiveMime(f: ResolvedDriveFile): string {
	return f.plan.mode === "export" ? (f.plan.mime ?? f.mimeType) : f.mimeType;
}

export async function checkDriveConnected(): Promise<boolean> {
	try {
		const res = await apiFetch("/api/google/auth/status");
		if (!res.ok) return false;
		const body = (await res.json()) as { connected: boolean };
		return body.connected;
	} catch {
		return false;
	}
}

export async function startDriveConnect(): Promise<string> {
	const res = await apiFetch("/api/google/auth/start", { method: "POST" });
	if (!res.ok) throw new Error(`could not start Google auth (${res.status})`);
	const body = (await res.json()) as { authUrl: string };
	return body.authUrl;
}

/** Poll auth/status until connected or the timeout elapses. */
export async function pollDriveConnected(timeoutMs = 120_000, intervalMs = 1500): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await checkDriveConnected()) return true;
		await new Promise((r) => setTimeout(r, intervalMs));
	}
	return false;
}

type ImportEvent =
	| { type: "start"; driveId: string }
	| { type: "text"; driveId: string; markdown: string }
	| { type: "error"; driveId: string; message: string }
	| {
			type: "done";
			driveId: string;
			chunks: number;
			filename: string;
			drive: Omit<DriveRef, "filename">;
	  }
	| { type: "complete" };

export interface ImportCtx {
	nodeIdByDriveId: Record<string, string>;
	isTextNode: (nodeId: string) => boolean;
	setCardText: typeof setCardText;
	setFileStatus: typeof setFileStatus;
	setFileDrive: typeof setFileDrive;
	scheduleAutolink: typeof scheduleAutolink;
}

/** Pure-ish reducer: one SSE event → the store calls it implies. Exported for testing with spy deps. */
export function applyImportEvent(ev: ImportEvent, ctx: ImportCtx): void {
	if (ev.type === "text") {
		const nodeId = ctx.nodeIdByDriveId[ev.driveId];
		if (nodeId) ctx.setCardText(nodeId, ev.markdown);
		return;
	}
	if (ev.type === "done") {
		const nodeId = ctx.nodeIdByDriveId[ev.driveId];
		if (!nodeId) return;
		ctx.setFileDrive(nodeId, { ...ev.drive, filename: ev.filename });
		if (!ctx.isTextNode(nodeId)) ctx.setFileStatus(nodeId, ev.chunks > 0 ? "ready" : "error");
		if (ev.chunks > 0) ctx.scheduleAutolink(nodeId);
		return;
	}
	if (ev.type === "error") {
		const nodeId = ctx.nodeIdByDriveId[ev.driveId];
		if (nodeId && !ctx.isTextNode(nodeId)) ctx.setFileStatus(nodeId, "error");
	}
}

interface ImportItem {
	driveId: string;
	blobKey: string;
	filename: string;
	kbRemoveFirst?: boolean;
}

async function streamImport(canvas: string, items: ImportItem[], ctx: ImportCtx): Promise<void> {
	const res = await apiFetch("/api/google/drive/import", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ canvas, items }),
	});
	if (!res.ok || !res.body) return;

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		const parts = buf.split("\n\n");
		buf = parts.pop() ?? "";
		for (const part of parts) {
			if (!part.startsWith("data: ")) continue;
			const line = part.slice("data: ".length).trim();
			if (!line) continue;
			applyImportEvent(JSON.parse(line) as ImportEvent, ctx);
		}
	}
}

/**
 * Resolve a pasted Drive/Docs/Sheets/Slides URL and stream its import onto the
 * canvas. Returns "needs-connect" without side effects if Drive isn't
 * connected yet — the caller shows DriveConnectDialog and retries after connecting.
 */
export async function importDriveUrl(
	url: string,
	at: XYPosition,
): Promise<"imported" | "needs-connect"> {
	if (!(await checkDriveConnected())) return "needs-connect";

	const res = await apiFetch("/api/google/drive/resolve", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.statusText }))).error);
	const resolved = (await res.json()) as ResolveResponse;

	const canvas = currentCanvasId() || "default";
	const nodeIdByDriveId: Record<string, string> = {};
	const textNodeIds = new Set<string>();
	const items: ImportItem[] = [];

	let pos = at;
	for (const f of resolved.files) {
		if (f.plan.mode === "skip") continue;
		const name = displayName(f);
		const mime = effectiveMime(f);
		let nodeId: string;
		if (f.plan.card === "text") {
			nodeId = addTextCard(pos, "");
			textNodeIds.add(nodeId);
		} else {
			nodeId = addFileCard(pos, name, { mime, kind: kindOf(name, mime) });
		}
		nodeIdByDriveId[f.id] = nodeId;
		items.push({ driveId: f.id, blobKey: `${canvas}:${nodeId}`, filename: name });
		pos = { x: pos.x + 30, y: pos.y + 30 };
	}

	if (resolved.kind === "folder" && Object.keys(nodeIdByDriveId).length >= 2) {
		const gid = groupNodes(Object.values(nodeIdByDriveId));
		if (resolved.folderName) setGroupLabel(gid, resolved.folderName);
	}

	if (!items.length) return "imported";

	const ctx: ImportCtx = {
		nodeIdByDriveId,
		isTextNode: (id) => textNodeIds.has(id),
		setCardText,
		setFileStatus,
		setFileDrive,
		scheduleAutolink,
	};
	await streamImport(canvas, items, ctx);
	return "imported";
}

/** Re-fetch a previously-imported node from Drive, replacing its content + KB entry in place. */
export async function resyncDriveNode(nodeId: string): Promise<void> {
	const node = flow.nodes.find((n) => n.id === nodeId);
	const drive = (node?.data as (FileData | TextData) | undefined)?.drive;
	if (!node || !drive) return;

	const canvas = currentCanvasId() || "default";
	const isText = node.type === "text";
	const filename = drive.filename;
	const ctx: ImportCtx = {
		nodeIdByDriveId: { [drive.fileId]: nodeId },
		isTextNode: () => isText,
		setCardText,
		setFileStatus,
		setFileDrive,
		scheduleAutolink,
	};
	await streamImport(
		canvas,
		[{ driveId: drive.fileId, blobKey: `${canvas}:${nodeId}`, filename, kbRemoveFirst: true }],
		ctx,
	);
}
