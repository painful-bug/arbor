import { describe, expect, it, vi } from "vitest";
import { applyImportEvent, type ImportCtx, isDriveUrl } from "./drive";

describe("isDriveUrl", () => {
	it("recognizes drive.google.com and docs.google.com links", () => {
		expect(isDriveUrl("https://drive.google.com/file/d/abc/view")).toBe(true);
		expect(isDriveUrl("https://drive.google.com/drive/folders/xyz")).toBe(true);
		expect(isDriveUrl("https://docs.google.com/document/d/d1/edit")).toBe(true);
		expect(isDriveUrl("https://docs.google.com/spreadsheets/d/s1/edit")).toBe(true);
	});
	it("rejects other hosts and malformed input", () => {
		expect(isDriveUrl("https://example.com/file/d/abc")).toBe(false);
		expect(isDriveUrl("not a url")).toBe(false);
		expect(isDriveUrl("")).toBe(false);
	});
});

function ctx(textIds: string[] = []) {
	const setCardText = vi.fn();
	const setFileStatus = vi.fn();
	const setFileDrive = vi.fn();
	const scheduleAutolink = vi.fn();
	const c: ImportCtx = {
		nodeIdByDriveId: { d1: "n1" },
		isTextNode: (id) => textIds.includes(id),
		setCardText,
		setFileStatus,
		setFileDrive,
		scheduleAutolink,
	};
	return { c, setCardText, setFileStatus, setFileDrive, scheduleAutolink };
}

describe("applyImportEvent", () => {
	it("sets card text for a text event, on the mapped node", () => {
		const { c, setCardText } = ctx();
		applyImportEvent({ type: "text", driveId: "d1", markdown: "# hi" }, c);
		expect(setCardText).toHaveBeenCalledWith("n1", "# hi");
	});

	it("ignores events for an unknown driveId", () => {
		const { c, setCardText } = ctx();
		applyImportEvent({ type: "text", driveId: "unknown", markdown: "x" }, c);
		expect(setCardText).not.toHaveBeenCalled();
	});

	it("on done: records drive provenance, sets file status for file nodes, schedules autolink", () => {
		const { c, setFileDrive, setFileStatus, scheduleAutolink } = ctx();
		applyImportEvent(
			{
				type: "done",
				driveId: "d1",
				chunks: 3,
				filename: "doc.txt",
				drive: { fileId: "d1", mimeType: "text/plain", modifiedTime: "t" },
			},
			c,
		);
		expect(setFileDrive).toHaveBeenCalledWith("n1", {
			fileId: "d1",
			mimeType: "text/plain",
			modifiedTime: "t",
			filename: "doc.txt",
		});
		expect(setFileStatus).toHaveBeenCalledWith("n1", "ready");
		expect(scheduleAutolink).toHaveBeenCalledWith("n1");
	});

	it("on done with zero chunks: file status is error, no autolink", () => {
		const { c, setFileStatus, scheduleAutolink } = ctx();
		applyImportEvent(
			{
				type: "done",
				driveId: "d1",
				chunks: 0,
				filename: "doc.txt",
				drive: { fileId: "d1", mimeType: "x", modifiedTime: "t" },
			},
			c,
		);
		expect(setFileStatus).toHaveBeenCalledWith("n1", "error");
		expect(scheduleAutolink).not.toHaveBeenCalled();
	});

	it("on done for a text node: skips setFileStatus (text cards have no status field)", () => {
		const { c, setFileDrive, setFileStatus, scheduleAutolink } = ctx(["n1"]);
		applyImportEvent(
			{
				type: "done",
				driveId: "d1",
				chunks: 2,
				filename: "doc.md",
				drive: { fileId: "d1", mimeType: "x", modifiedTime: "t" },
			},
			c,
		);
		expect(setFileDrive).toHaveBeenCalled();
		expect(setFileStatus).not.toHaveBeenCalled();
		expect(scheduleAutolink).toHaveBeenCalledWith("n1");
	});

	it("on error: marks the file node as errored", () => {
		const { c, setFileStatus } = ctx();
		applyImportEvent({ type: "error", driveId: "d1", message: "boom" }, c);
		expect(setFileStatus).toHaveBeenCalledWith("n1", "error");
	});

	it("on error for a text node: does not touch file status", () => {
		const { c, setFileStatus } = ctx(["n1"]);
		applyImportEvent({ type: "error", driveId: "d1", message: "boom" }, c);
		expect(setFileStatus).not.toHaveBeenCalled();
	});
});
