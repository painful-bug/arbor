import { describe, expect, it } from "vitest";
import { type MenuCtx, type MenuSurface, menuItemsFor } from "./menu-items";

const base: MenuCtx = { selectionCount: 1 };
const flat = (surface: MenuSurface, ctx: MenuCtx = base) => menuItemsFor(surface, ctx).flat();
const ids = (surface: MenuSurface, ctx: MenuCtx = base) => flat(surface, ctx).map((e) => e.id);

describe("menuItemsFor: destructive-last invariant", () => {
	for (const surface of [
		"card",
		"web",
		"file",
		"text",
		"tag",
		"mindmap",
		"group",
		"multi",
	] as const) {
		it(`${surface}: delete is last and alone in its section`, () => {
			const sections = menuItemsFor(surface, { ...base, selectionCount: 2 });
			const last = sections[sections.length - 1];
			expect(last).toHaveLength(1);
			expect(last[0].danger).toBe(true);
			expect(last[0].id).toMatch(/delete/);
		});
	}
});

describe("card", () => {
	it("orders Continue before Retry, omits clipboard/zorder without caps", () => {
		expect(ids("card")).toEqual([
			"continue",
			"retry",
			"copy-answer",
			"duplicate",
			"rename",
			"delete",
		]);
	});
	it("disables Retry while streaming", () => {
		const [, retry] = flat("card", { ...base, streaming: true });
		expect(retry.id).toBe("retry");
		expect(retry.disabled).toBe(true);
	});
	it("adds copy/cut when clipboard cap is on", () => {
		const list = ids("card", { ...base, caps: { clipboard: true } });
		expect(list).toContain("copy");
		expect(list).toContain("cut");
	});
});

describe("file", () => {
	it("omits Split View without an open file", () => {
		expect(ids("file")).not.toContain("split");
	});
	it("omits Split View when this node IS the open file", () => {
		expect(ids("file", { ...base, hasOpenFile: true, isOpenFile: true })).not.toContain("split");
	});
	it("shows Split View when another file is open", () => {
		expect(ids("file", { ...base, hasOpenFile: true, isOpenFile: false })).toContain("split");
	});
	it("shows Re-sync only when drive-linked", () => {
		expect(ids("file")).not.toContain("resync");
		expect(ids("file", { ...base, isDriveLinked: true })).toContain("resync");
	});
});

describe("text", () => {
	it("shows Re-sync only when drive-linked", () => {
		expect(ids("text")).not.toContain("resync");
		expect(ids("text", { ...base, isDriveLinked: true })).toContain("resync");
	});
});

describe("mindmap", () => {
	it("omits Pin branch without a branchId", () => {
		expect(ids("mindmap")).not.toContain("pin-branch");
	});
	it("shows Pin branch when a branch was clicked", () => {
		expect(ids("mindmap", { ...base, branchId: "b1" })).toContain("pin-branch");
	});
});

describe("multi (selection)", () => {
	it("omits align section without the cap", () => {
		expect(ids("multi", { ...base, selectionCount: 3 })).not.toContain("align-left");
	});
	it("shows align but not distribute at 2 selected", () => {
		const list = ids("multi", { ...base, selectionCount: 2, caps: { align: true } });
		expect(list).toContain("align-left");
		expect(list).not.toContain("distribute-h");
	});
	it("shows distribute at 3+ selected", () => {
		const list = ids("multi", { ...base, selectionCount: 3, caps: { align: true } });
		expect(list).toContain("distribute-h");
		expect(list).toContain("distribute-v");
	});
});

describe("pane", () => {
	it("omits Select all / Clean up / Fit / Export on an empty canvas", () => {
		const list = ids("pane", { ...base, hasNodes: false });
		expect(list).not.toContain("select-all");
		expect(list).not.toContain("cleanup");
		expect(list).not.toContain("fit");
		expect(list).not.toContain("export-png");
	});
	it("shows them once the canvas has nodes", () => {
		const list = ids("pane", { ...base, hasNodes: true });
		expect(list).toContain("select-all");
		expect(list).toContain("cleanup");
		expect(list).toContain("fit");
		expect(list).toContain("export-png");
		expect(list).toContain("export-pdf");
	});
	it("omits Paste without clipboard content", () => {
		expect(ids("pane", { ...base, caps: { clipboard: true }, canPaste: false })).not.toContain(
			"paste",
		);
		expect(ids("pane", { ...base, caps: { clipboard: true }, canPaste: true })).toContain("paste");
	});
	it("includes Export Markdown alongside PNG/PDF (backend already supports it)", () => {
		expect(ids("pane", { ...base, hasNodes: true })).toContain("export-md");
	});
	it("disables Undo/Redo when unavailable", () => {
		const list = flat("pane", { ...base, hasNodes: true, canUndo: false, canRedo: false });
		expect(list.find((e) => e.id === "undo")?.disabled).toBe(true);
		expect(list.find((e) => e.id === "redo")?.disabled).toBe(true);
	});
});

describe("group", () => {
	it("has Ungroup with its shortcut hint", () => {
		const entry = flat("group").find((e) => e.id === "ungroup");
		expect(entry?.hint).toBe("⇧G");
	});
});

describe("move to cluster", () => {
	for (const surface of ["card", "file", "text", "multi"] as const) {
		it(`${surface}: shown only when clusters exist`, () => {
			expect(ids(surface, { ...base, selectionCount: 2 })).not.toContain("move-to-cluster");
			expect(ids(surface, { ...base, selectionCount: 2, hasClusters: true })).toContain(
				"move-to-cluster",
			);
		});
	}
	it("never offered on the pane surface", () => {
		expect(ids("pane", { ...base, hasNodes: true, hasClusters: true })).not.toContain(
			"move-to-cluster",
		);
	});
});
