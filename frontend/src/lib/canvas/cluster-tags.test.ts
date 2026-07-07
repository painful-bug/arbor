import { describe, expect, it } from "vitest";
import { BLOCKS } from "./cards";
import { clusterColor, clusterKey, matchCluster } from "./cluster-tags";

describe("clusterKey", () => {
	it("is insensitive to member order", () => {
		expect(clusterKey(["b", "a", "c"])).toBe(clusterKey(["c", "b", "a"]));
	});

	it("differs for different membership", () => {
		expect(clusterKey(["a", "b"])).not.toBe(clusterKey(["a", "c"]));
	});
});

describe("matchCluster", () => {
	const old = [
		{ key: clusterKey(["a", "b", "c"]), ids: ["a", "b", "c"] },
		{ key: clusterKey(["x", "y"]), ids: ["x", "y"] },
	];

	it("matches an exact membership", () => {
		expect(matchCluster(["a", "b", "c"], old)).toBe(0);
	});

	it("matches at >=50% overlap", () => {
		expect(matchCluster(["a", "b", "d"], old)).toBe(0);
	});

	it("returns -1 below the overlap threshold", () => {
		expect(matchCluster(["a", "d", "e", "f"], old)).toBe(-1);
	});

	it("returns -1 for no overlap at all", () => {
		expect(matchCluster(["p", "q"], old)).toBe(-1);
	});
});

describe("clusterColor", () => {
	it("cycles through the shared block palette", () => {
		expect(clusterColor(0)).toBe(BLOCKS[0]);
		expect(clusterColor(BLOCKS.length)).toBe(BLOCKS[0]);
		expect(clusterColor(BLOCKS.length + 1)).toBe(BLOCKS[1]);
	});
});
