import { describe, expect, it } from "bun:test";
import {
	type DriveDeps,
	type DriveFile,
	exportPlan,
	fetchContent,
	getFile,
	listFolder,
	parseDriveUrl,
} from "./drive.ts";

function fakeDeps(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>): DriveDeps {
	return {
		fetchImpl: fetchImpl as unknown as DriveDeps["fetchImpl"],
		getAccessToken: async () => "test-token",
	};
}

const file = (over: Partial<DriveFile> = {}): DriveFile => ({
	id: "f1",
	name: "doc.txt",
	mimeType: "text/plain",
	modifiedTime: "2026-01-01T00:00:00Z",
	...over,
});

describe("parseDriveUrl", () => {
	it("parses a file link", () => {
		expect(parseDriveUrl("https://drive.google.com/file/d/abc123/view?usp=sharing")).toEqual({
			kind: "file",
			id: "abc123",
			resourceKey: undefined,
		});
	});
	it("parses a folder link, with or without /u/N", () => {
		expect(parseDriveUrl("https://drive.google.com/drive/folders/xyz")).toEqual({
			kind: "folder",
			id: "xyz",
			resourceKey: undefined,
		});
		expect(parseDriveUrl("https://drive.google.com/drive/u/0/folders/xyz")).toEqual({
			kind: "folder",
			id: "xyz",
			resourceKey: undefined,
		});
	});
	it("parses open?id= and uc?id=", () => {
		expect(parseDriveUrl("https://drive.google.com/open?id=q1")).toEqual({
			kind: "file",
			id: "q1",
			resourceKey: undefined,
		});
		expect(parseDriveUrl("https://drive.google.com/uc?id=q2&export=download")).toEqual({
			kind: "file",
			id: "q2",
			resourceKey: undefined,
		});
	});
	it("parses Docs/Sheets/Slides links", () => {
		expect(parseDriveUrl("https://docs.google.com/document/d/d1/edit")).toEqual({
			kind: "file",
			id: "d1",
			resourceKey: undefined,
		});
		expect(parseDriveUrl("https://docs.google.com/spreadsheets/d/s1/edit#gid=0")).toEqual({
			kind: "file",
			id: "s1",
			resourceKey: undefined,
		});
		expect(parseDriveUrl("https://docs.google.com/presentation/d/p1/edit")).toEqual({
			kind: "file",
			id: "p1",
			resourceKey: undefined,
		});
	});
	it("carries a resourcekey when present", () => {
		expect(parseDriveUrl("https://drive.google.com/file/d/abc/view?resourcekey=rk1")).toEqual({
			kind: "file",
			id: "abc",
			resourceKey: "rk1",
		});
	});
	it("returns null for non-Drive URLs and malformed input", () => {
		expect(parseDriveUrl("https://example.com/file/d/abc")).toBeNull();
		expect(parseDriveUrl("not a url")).toBeNull();
		expect(parseDriveUrl("https://drive.google.com/drive/my-drive")).toBeNull();
	});
});

describe("exportPlan", () => {
	it("exports Docs to markdown as a text card", () => {
		expect(exportPlan(file({ mimeType: "application/vnd.google-apps.document" }))).toEqual({
			mode: "export",
			mime: "text/markdown",
			ext: "md",
			card: "text",
		});
	});
	it("exports Sheets to CSV as a file card", () => {
		expect(exportPlan(file({ mimeType: "application/vnd.google-apps.spreadsheet" }))).toEqual({
			mode: "export",
			mime: "text/csv",
			ext: "csv",
			card: "file",
		});
	});
	it("exports Slides to PDF as a file card", () => {
		expect(exportPlan(file({ mimeType: "application/vnd.google-apps.presentation" }))).toEqual({
			mode: "export",
			mime: "application/pdf",
			ext: "pdf",
			card: "file",
		});
	});
	it("skips folders, forms, sites, shortcuts, drawings", () => {
		for (const mimeType of [
			"application/vnd.google-apps.folder",
			"application/vnd.google-apps.form",
			"application/vnd.google-apps.site",
			"application/vnd.google-apps.shortcut",
			"application/vnd.google-apps.drawing",
		]) {
			expect(exportPlan(file({ mimeType })).mode).toBe("skip");
		}
	});
	it("skips binaries over the 50MB download cap", () => {
		const plan = exportPlan(file({ mimeType: "application/pdf", size: String(60 * 1024 * 1024) }));
		expect(plan).toMatchObject({ mode: "skip" });
	});
	it("downloads ordinary binaries as-is", () => {
		expect(exportPlan(file({ mimeType: "application/pdf", size: "1000" }))).toEqual({
			mode: "download",
			card: "file",
		});
	});
});

describe("getFile", () => {
	it("sends the bearer token and a resource-key header when provided", async () => {
		let seenHeaders: Headers | undefined;
		const deps = fakeDeps(async (_url, init) => {
			seenHeaders = new Headers(init?.headers);
			return new Response(JSON.stringify(file()), { status: 200 });
		});
		const f = await getFile("f1", "rk9", deps);
		expect(f.id).toBe("f1");
		expect(seenHeaders?.get("Authorization")).toBe("Bearer test-token");
		expect(seenHeaders?.get("X-Goog-Drive-Resource-Keys")).toBe("f1/rk9");
	});

	it("throws a 404 AppError when Drive reports not found", async () => {
		const deps = fakeDeps(async () => new Response("nope", { status: 404 }));
		await expect(getFile("missing", undefined, deps)).rejects.toMatchObject({ status: 404 });
	});
});

describe("listFolder", () => {
	it("recurses into subfolders and paginates, stopping at maxFiles", async () => {
		const deps = fakeDeps(async (url) => {
			const u = new URL(String(url));
			if (u.pathname.endsWith("/files") === false) {
				// getFile(folderId) call for the folder's own name
				return new Response(JSON.stringify(file({ id: "root", name: "My Folder" })), {
					status: 200,
				});
			}
			const q = u.searchParams.get("q") ?? "";
			if (q.includes("'root'")) {
				if (!u.searchParams.get("pageToken")) {
					return new Response(
						JSON.stringify({
							files: [file({ id: "a", name: "a.txt" })],
							nextPageToken: "p2",
						}),
						{ status: 200 },
					);
				}
				return new Response(
					JSON.stringify({
						files: [{ id: "sub", name: "sub", mimeType: "application/vnd.google-apps.folder" }],
					}),
					{ status: 200 },
				);
			}
			if (q.includes("'sub'")) {
				return new Response(JSON.stringify({ files: [file({ id: "b", name: "b.txt" })] }), {
					status: 200,
				});
			}
			return new Response(JSON.stringify({ files: [] }), { status: 200 });
		});
		const { files, folderName } = await listFolder("root", {}, deps);
		expect(folderName).toBe("My Folder");
		expect(files.map((f) => f.id).sort()).toEqual(["a", "b"]);
	});

	it("stops walking past maxDepth", async () => {
		let depthReached = 0;
		const deps = fakeDeps(async (url) => {
			const u = new URL(String(url));
			if (!u.pathname.endsWith("/files"))
				return new Response(JSON.stringify(file({ name: "root" })), { status: 200 });
			depthReached++;
			return new Response(
				JSON.stringify({
					files: [
						{ id: `d${depthReached}`, name: "d", mimeType: "application/vnd.google-apps.folder" },
					],
				}),
				{ status: 200 },
			);
		});
		await listFolder("root", { maxDepth: 1 }, deps);
		// depth 0 (root) + depth 1 = 2 folder-listing calls; depth 2 never walked.
		expect(depthReached).toBe(2);
	});
});

describe("fetchContent", () => {
	it("hits the export endpoint for Google-native docs", async () => {
		let seenUrl = "";
		const deps = fakeDeps(async (url) => {
			seenUrl = String(url);
			return new Response("# hello", { status: 200 });
		});
		const bytes = await fetchContent(
			file({ mimeType: "application/vnd.google-apps.document" }),
			undefined,
			deps,
		);
		expect(new TextDecoder().decode(bytes)).toBe("# hello");
		expect(seenUrl).toContain("/export?mimeType=text%2Fmarkdown");
	});

	it("hits alt=media for ordinary downloads", async () => {
		let seenUrl = "";
		const deps = fakeDeps(async (url) => {
			seenUrl = String(url);
			return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
		});
		const bytes = await fetchContent(
			file({ mimeType: "application/pdf", size: "3" }),
			undefined,
			deps,
		);
		expect([...bytes]).toEqual([1, 2, 3]);
		expect(seenUrl).toContain("alt=media");
	});

	it("throws DRIVE_SKIP without a network call for skipped files", async () => {
		let called = false;
		const deps = fakeDeps(async () => {
			called = true;
			return new Response("", { status: 200 });
		});
		await expect(
			fetchContent(file({ mimeType: "application/vnd.google-apps.form" }), undefined, deps),
		).rejects.toMatchObject({
			code: "DRIVE_SKIP",
		});
		expect(called).toBe(false);
	});

	it("maps a 403 exportSizeLimitExceeded to a 413 AppError", async () => {
		const deps = fakeDeps(async () => new Response("exportSizeLimitExceeded", { status: 403 }));
		await expect(
			fetchContent(file({ mimeType: "application/vnd.google-apps.document" }), undefined, deps),
		).rejects.toMatchObject({ status: 413, code: "DRIVE_EXPORT_TOO_LARGE" });
	});
});
