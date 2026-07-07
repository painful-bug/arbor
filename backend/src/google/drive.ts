// Google Drive: URL parsing + Drive API file/folder resolution + content fetch.
// Google-native docs (Docs/Sheets/Slides) have no raw bytes — they're exported
// to a plain format mosaic (and the canvas) already understands; everything
// else downloads as-is. See exportPlan() for the exact mapping.
import { FETCH_BYTES_TIMEOUT_MS } from "../config.ts";
import { AppError } from "../errors.ts";
import * as oauth from "./oauth.ts";

const API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Google-native types with no raw bytes — exported to a plain format instead.
const EXPORT_TARGET: Record<string, { mime: string; ext: string; card: "text" | "file" }> = {
	"application/vnd.google-apps.document": { mime: "text/markdown", ext: "md", card: "text" },
	"application/vnd.google-apps.spreadsheet": { mime: "text/csv", ext: "csv", card: "file" },
	"application/vnd.google-apps.presentation": { mime: "application/pdf", ext: "pdf", card: "file" },
};

// Google-native types with no meaningful export for this app.
const SKIP_MIMES = new Set([
	FOLDER_MIME,
	"application/vnd.google-apps.form",
	"application/vnd.google-apps.site",
	"application/vnd.google-apps.shortcut",
	"application/vnd.google-apps.map",
	"application/vnd.google-apps.drawing",
]);

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

export interface DriveFile {
	id: string;
	name: string;
	mimeType: string;
	size?: string;
	modifiedTime: string;
}

export interface DriveDeps {
	fetchImpl: typeof fetch;
	getAccessToken: () => Promise<string>;
}

export const realDriveDeps: DriveDeps = {
	fetchImpl: fetch,
	getAccessToken: () => oauth.getAccessToken(),
};

/**
 * Recognize a Drive/Docs/Sheets/Slides URL. Returns null for anything else —
 * callers fall back to treating the pasted text as a plain web link.
 */
export function parseDriveUrl(
	raw: string,
): { kind: "file" | "folder"; id: string; resourceKey?: string } | null {
	let u: URL;
	try {
		u = new URL(raw);
	} catch {
		return null;
	}
	const resourceKey = u.searchParams.get("resourcekey") ?? undefined;

	if (u.hostname === "drive.google.com") {
		const file = u.pathname.match(/^\/file\/d\/([^/]+)/);
		if (file) return { kind: "file", id: file[1], resourceKey };
		const folder = u.pathname.match(/^\/drive(?:\/u\/\d+)?\/folders\/([^/]+)/);
		if (folder) return { kind: "folder", id: folder[1], resourceKey };
		if (u.pathname === "/open" || u.pathname === "/uc") {
			const id = u.searchParams.get("id");
			if (id) return { kind: "file", id, resourceKey };
		}
		return null;
	}
	if (u.hostname === "docs.google.com") {
		const doc = u.pathname.match(/^\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/);
		if (doc) return { kind: "file", id: doc[1], resourceKey };
		return null;
	}
	return null;
}

function authHeaders(token: string, resourceKey?: string): Record<string, string> {
	return {
		Authorization: `Bearer ${token}`,
		...(resourceKey ? { "X-Goog-Drive-Resource-Keys": resourceKey } : {}),
	};
}

async function driveJson<T>(
	url: string,
	token: string,
	resourceKey: string | undefined,
	deps: DriveDeps,
): Promise<T> {
	const res = await deps.fetchImpl(url, { headers: authHeaders(token, resourceKey) }).catch((e) => {
		throw new AppError(`Drive request failed: ${e?.message}`, 502, "UPSTREAM");
	});
	if (!res.ok)
		throw new AppError(
			`Drive API error (${res.status}): ${await res.text()}`,
			res.status === 404 ? 404 : 502,
			"DRIVE_ERROR",
		);
	return res.json() as Promise<T>;
}

export async function getFile(
	id: string,
	resourceKey?: string,
	deps: DriveDeps = realDriveDeps,
): Promise<DriveFile> {
	const token = await deps.getAccessToken();
	const url = `${API}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime&supportsAllDrives=true`;
	return driveJson<DriveFile>(url, token, resourceKey ? `${id}/${resourceKey}` : undefined, deps);
}

/**
 * Recursively list a folder's files (subfolders are walked, not returned).
 * Bounded by maxFiles/maxDepth so a huge or deeply-nested Drive tree can't
 * hang an import.
 */
export async function listFolder(
	id: string,
	opts: { maxFiles?: number; maxDepth?: number } = {},
	deps: DriveDeps = realDriveDeps,
): Promise<{ files: DriveFile[]; folderName: string }> {
	const maxFiles = opts.maxFiles ?? 200;
	const maxDepth = opts.maxDepth ?? 3;
	const token = await deps.getAccessToken();
	const folderMeta = await getFile(id, undefined, deps);
	const files: DriveFile[] = [];

	async function walk(folderId: string, depth: number): Promise<void> {
		if (depth > maxDepth || files.length >= maxFiles) return;
		let pageToken: string | undefined;
		do {
			const params = new URLSearchParams({
				q: `'${folderId}' in parents and trashed = false`,
				fields: "nextPageToken, files(id,name,mimeType,size,modifiedTime)",
				pageSize: "100",
				supportsAllDrives: "true",
				includeItemsFromAllDrives: "true",
				...(pageToken ? { pageToken } : {}),
			});
			const page = await driveJson<{ files: DriveFile[]; nextPageToken?: string }>(
				`${API}/files?${params}`,
				token,
				undefined,
				deps,
			);
			for (const f of page.files) {
				if (files.length >= maxFiles) break;
				if (f.mimeType === FOLDER_MIME) await walk(f.id, depth + 1);
				else files.push(f);
			}
			pageToken = page.nextPageToken;
		} while (pageToken && files.length < maxFiles);
	}

	await walk(id, 0);
	return { files, folderName: folderMeta.name };
}

export type ExportPlan =
	| { mode: "export"; mime: string; ext: string; card: "text" | "file" }
	| { mode: "download"; card: "file" }
	| { mode: "skip"; reason: string };

/** What to do with a Drive file: export (Google-native), download as-is, or skip. */
export function exportPlan(f: DriveFile): ExportPlan {
	const target = EXPORT_TARGET[f.mimeType];
	if (target) return { mode: "export", ...target };
	if (SKIP_MIMES.has(f.mimeType))
		return { mode: "skip", reason: `unsupported type: ${f.mimeType}` };
	const size = f.size ? Number(f.size) : 0;
	if (size > MAX_DOWNLOAD_BYTES) {
		return { mode: "skip", reason: `file too large (${Math.round(size / 1024 / 1024)}MB > 50MB)` };
	}
	return { mode: "download", card: "file" };
}

async function fetchDriveBytes(
	url: string,
	token: string,
	resourceKey: string | undefined,
	deps: DriveDeps,
): Promise<Uint8Array> {
	const res = await deps
		.fetchImpl(url, {
			headers: authHeaders(token, resourceKey),
			signal: AbortSignal.timeout(FETCH_BYTES_TIMEOUT_MS),
		})
		.catch((e) => {
			throw e?.name === "TimeoutError"
				? new AppError(`Drive request timed out: ${url}`, 504, "UPSTREAM_TIMEOUT")
				: new AppError(`Drive request failed: ${e?.message}`, 502, "UPSTREAM");
		});
	if (!res.ok) {
		const text = await res.text().catch(() => "");
		if (res.status === 403 && text.includes("exportSizeLimitExceeded")) {
			throw new AppError(
				"Drive export exceeds Google's size cap for native documents",
				413,
				"DRIVE_EXPORT_TOO_LARGE",
			);
		}
		throw new AppError(
			`Drive download failed (${res.status}): ${text || res.statusText}`,
			502,
			"DRIVE_ERROR",
		);
	}
	return new Uint8Array(await res.arrayBuffer());
}

/** Fetch the actual bytes for a file, per its exportPlan(). Throws on "skip". */
export async function fetchContent(
	f: DriveFile,
	resourceKey?: string,
	deps: DriveDeps = realDriveDeps,
): Promise<Uint8Array> {
	const plan = exportPlan(f);
	if (plan.mode === "skip")
		throw new AppError(`Drive file skipped: ${plan.reason}`, 415, "DRIVE_SKIP");
	const token = await deps.getAccessToken();
	const rk = resourceKey ? `${f.id}/${resourceKey}` : undefined;
	const url =
		plan.mode === "export"
			? `${API}/files/${encodeURIComponent(f.id)}/export?mimeType=${encodeURIComponent(plan.mime)}`
			: `${API}/files/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`;
	return fetchDriveBytes(url, token, rk, deps);
}
