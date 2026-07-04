import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCachedDoc, loadDoc, newDoc, uid, writeDoc, writeIndex } from "./persistence";

const { apiJson, apiPut } = vi.hoisted(() => ({ apiJson: vi.fn(), apiPut: vi.fn() }));
vi.mock("$lib/api", () => ({ apiJson, apiPut }));

beforeEach(() => {
	apiJson.mockReset();
	apiPut.mockReset().mockResolvedValue(undefined);
});

describe("persistence", () => {
	it("uid/newDoc produce unique empty docs", () => {
		const a = newDoc("A");
		const b = newDoc("B");
		expect(a.id).not.toBe(b.id);
		expect(uid()).toMatch(/^c/);
		expect(a.nodes).toEqual([]);
		expect(a.edges).toEqual([]);
		expect(a.createdAt).toBe(a.updatedAt);
	});

	it("writeDoc PUTs the doc and caches it for sync lookup", () => {
		const doc = newDoc("Cache me");
		writeDoc(doc);
		expect(apiPut).toHaveBeenCalledWith(`/api/canvases/${doc.id}`, doc);
		expect(getCachedDoc(doc.id)).toBe(doc);
		expect(getCachedDoc("nope")).toBeNull();
	});

	it("loadDoc returns the doc and caches it; null on failure", async () => {
		const doc = newDoc("Loaded");
		apiJson.mockResolvedValueOnce(doc);
		expect(await loadDoc(doc.id)).toEqual(doc);
		expect(getCachedDoc(doc.id)).toEqual(doc);

		apiJson.mockRejectedValueOnce(new Error("404"));
		expect(await loadDoc("missing")).toBeNull();
	});

	it("fire-and-forget write failures log instead of throwing", async () => {
		const err = vi.spyOn(console, "error").mockImplementation(() => {});
		apiPut.mockRejectedValue(new Error("backend down"));
		expect(() => writeIndex("cur", [])).not.toThrow();
		expect(() => writeDoc(newDoc("X"))).not.toThrow();
		await vi.waitFor(() => expect(err).toHaveBeenCalledWith("[persist]", expect.any(Error)));
		err.mockRestore();
	});
});
