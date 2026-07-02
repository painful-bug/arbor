import { describe, expect, it } from "vitest";
import {
	isDocxFile,
	isEditableFile,
	isImageFile,
	isMarkdownFile,
	isPdfFile,
	isTextFile,
} from "./kinds";

describe("file kind guards", () => {
	it("matches exactly their literal", () => {
		expect(isPdfFile({ kind: "pdf" })).toBe(true);
		expect(isImageFile({ kind: "image" })).toBe(true);
		expect(isDocxFile({ kind: "docx" })).toBe(true);
		expect(isMarkdownFile({ kind: "markdown" })).toBe(true);
		expect(isTextFile({ kind: "text" })).toBe(true);
		expect(isPdfFile({ kind: "image" })).toBe(false);
	});

	it("handles null/undefined/absent kind", () => {
		expect(isPdfFile(null)).toBe(false);
		expect(isPdfFile(undefined)).toBe(false);
		expect(isPdfFile({})).toBe(false);
	});

	it("isEditableFile covers text-based formats only", () => {
		expect(isEditableFile({ kind: "markdown" })).toBe(true);
		expect(isEditableFile({ kind: "text" })).toBe(true);
		expect(isEditableFile({ kind: "docx" })).toBe(true);
		expect(isEditableFile({ kind: "pdf" })).toBe(false);
		expect(isEditableFile({ kind: "image" })).toBe(false);
	});
});
