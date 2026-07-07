import { beforeEach, describe, expect, it } from "vitest";
import {
	finishIndexing,
	indexing,
	indexingActive,
	indexingPercent,
	startIndexing,
} from "./indexing.svelte";

// Drain any leftover in-flight ids between tests (module state is shared), then zero
// the counts so each test starts from a clean, idle wave.
beforeEach(() => {
	for (const id of ["a", "b", "c", "d"]) finishIndexing(id);
	indexing.total = 0;
	indexing.done = 0;
	indexing.activeCount = 0;
});

describe("indexing store", () => {
	it("tracks a wave: start raises total, finish raises done", () => {
		startIndexing("a");
		startIndexing("b");
		expect(indexing.total).toBe(2);
		expect(indexingActive()).toBe(true);
		expect(indexingPercent()).toBe(0);

		finishIndexing("a");
		expect(indexing.done).toBe(1);
		expect(indexingPercent()).toBe(50);

		finishIndexing("b");
		expect(indexingActive()).toBe(false);
		expect(indexingPercent()).toBe(100); // holds at 100% on the final frame
	});

	it("dropping more mid-wave raises total and recomputes percent", () => {
		startIndexing("a");
		startIndexing("b");
		finishIndexing("a"); // 1/2 = 50%
		expect(indexingPercent()).toBe(50);
		startIndexing("c"); // wave grows to 3 (still active — no reset)
		expect(indexing.total).toBe(3);
		expect(indexingPercent()).toBe(33);
	});

	it("resets lazily: a new start after drain opens a fresh wave", () => {
		startIndexing("a");
		finishIndexing("a");
		expect(indexingPercent()).toBe(100);
		startIndexing("b"); // fresh wave
		expect(indexing.total).toBe(1);
		expect(indexing.done).toBe(0);
		expect(indexingPercent()).toBe(0);
	});

	it("dedupes repeat starts and finishes", () => {
		startIndexing("a");
		startIndexing("a"); // ignored
		expect(indexing.total).toBe(1);
		finishIndexing("a");
		finishIndexing("a"); // ignored
		expect(indexing.done).toBe(1);
	});
});
