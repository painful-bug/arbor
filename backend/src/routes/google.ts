// Google integration endpoints, namespaced /api/google/* so future Google
// products (Calendar, Gmail, ...) can hang off the same OAuth connection.
import { Hono } from "hono";
import { HEARTBEAT_MS } from "../config.ts";
import { badRequest } from "../errors.ts";
import {
	type DriveDeps,
	exportPlan,
	fetchContent,
	getFile,
	listFolder,
	parseDriveUrl,
} from "../google/drive.ts";
import * as oauth from "../google/oauth.ts";
import { addFile, contentsOf, removeFile } from "../kb/index.ts";
import { writeBlob } from "./blobs.ts";

interface ImportItem {
	driveId: string;
	resourceKey?: string;
	/** Blob storage key, `${canvasId}:${nodeId}` — chosen by the frontend so the
	 *  existing hydrate/thumbnail machinery works unchanged. */
	blobKey: string;
	filename: string;
	/** Re-sync: drop the old KB entry before re-adding under the same name. */
	kbRemoveFirst?: boolean;
}

// filename collision → " (2)", " (3)", ... against this canvas's existing KB sources.
async function dedupeFilename(canvas: string, filename: string): Promise<string> {
	const { sources } = await contentsOf(canvas);
	if (!sources.includes(filename)) return filename;
	const dot = filename.lastIndexOf(".");
	const base = dot > 0 ? filename.slice(0, dot) : filename;
	const ext = dot > 0 ? filename.slice(dot) : "";
	for (let n = 2; ; n++) {
		const candidate = `${base} (${n})${ext}`;
		if (!sources.includes(candidate)) return candidate;
	}
}

// Factory (not a bare `new Hono()` singleton like other route modules) so
// tests can inject a fake OAuthDeps instead of hitting the real OS keychain —
// same reason oauth.ts itself takes an optional `deps` on every export. The
// module-level `googleRoutes` below is the production wiring (real deps).
// `driveDeps` re-derives drive.ts's separate DriveDeps shape from the same
// injected oauth deps, so a test's fake token store also governs Drive calls.
export function createGoogleRoutes(deps: oauth.OAuthDeps = oauth.realDeps) {
	const routes = new Hono();
	const driveDeps: DriveDeps = {
		fetchImpl: deps.fetchImpl,
		getAccessToken: () => oauth.getAccessToken(deps),
	};

	routes.post("/auth/start", async (c) => {
		const { authUrl } = await oauth.startAuth(deps);
		return c.json({ authUrl });
	});

	routes.get("/auth/status", async (c) => {
		return c.json(await oauth.authStatus(deps));
	});

	routes.delete("/auth", async (c) => {
		await oauth.logout(deps);
		return c.json({ ok: true });
	});

	routes.put("/client", async (c) => {
		const body = (await c.req.json()) as { clientId?: string; clientSecret?: string };
		if (!body.clientId?.trim()) throw badRequest("clientId required");
		await oauth.setClientOverride(
			body.clientId.trim(),
			body.clientSecret?.trim() || undefined,
			deps,
		);
		return c.json({ ok: true });
	});

	routes.post("/drive/resolve", async (c) => {
		const { url } = (await c.req.json().catch(() => ({}))) as { url?: string };
		const parsed = parseDriveUrl(url ?? "");
		if (!parsed) throw badRequest("not a Drive URL");
		if (parsed.kind === "file") {
			const f = await getFile(parsed.id, parsed.resourceKey, driveDeps);
			return c.json({ kind: "file", files: [{ ...f, plan: exportPlan(f) }] });
		}
		const { files, folderName } = await listFolder(parsed.id, {}, driveDeps);
		return c.json({
			kind: "folder",
			folderName,
			files: files.map((f) => ({ ...f, plan: exportPlan(f) })),
		});
	});

	// Server-side import: bytes never cross to the webview. Sequential per item so
	// a stuck/huge file doesn't starve the others; each item's failure is reported
	// and the loop continues.
	routes.post("/drive/import", async (c) => {
		const { canvas, items } = (await c.req.json()) as { canvas: string; items: ImportItem[] };

		const { readable, writable } = new TransformStream<Uint8Array>();
		const writer = writable.getWriter();
		const enc = new TextEncoder();
		const emit = (ev: object) =>
			writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});

		const hb = setInterval(() => {
			writer.write(enc.encode(": ping\n\n")).catch(() => {});
		}, HEARTBEAT_MS);
		let aborted = false;
		c.req.raw.signal.addEventListener("abort", () => {
			aborted = true;
		});

		(async () => {
			for (const item of items ?? []) {
				if (aborted) break;
				emit({ type: "start", driveId: item.driveId });
				try {
					const f = await getFile(item.driveId, item.resourceKey, driveDeps);
					const plan = exportPlan(f);
					if (plan.mode === "skip") {
						emit({ type: "error", driveId: item.driveId, message: plan.reason });
						continue;
					}
					const bytes = await fetchContent(f, item.resourceKey, driveDeps);
					const mime = plan.mode === "export" ? plan.mime : f.mimeType;
					const filename = item.kbRemoveFirst
						? item.filename
						: await dedupeFilename(canvas, item.filename);

					if (plan.card === "text") {
						emit({
							type: "text",
							driveId: item.driveId,
							markdown: new TextDecoder().decode(bytes),
						});
					}
					await writeBlob(item.blobKey, bytes, mime, filename);
					if (item.kbRemoveFirst) await removeFile(canvas, filename);
					const chunks = await addFile(canvas, filename, mime, bytes);
					emit({
						type: "done",
						driveId: item.driveId,
						chunks,
						filename,
						drive: { fileId: f.id, mimeType: f.mimeType, modifiedTime: f.modifiedTime },
					});
				} catch (err) {
					emit({
						type: "error",
						driveId: item.driveId,
						message: String((err as Error)?.message ?? err),
					});
				}
			}
			emit({ type: "complete" });
		})().finally(() => {
			clearInterval(hb);
			writer.close().catch(() => {});
		});

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	return routes;
}

export const googleRoutes = createGoogleRoutes();
