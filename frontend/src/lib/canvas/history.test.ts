import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistory } from "./history";

describe("createHistory", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("push/undo/redo round-trips deep-cloned snapshots", () => {
		const h = createHistory<{ v: number[] }>(10);
		h.push({ v: [1] });
		h.push({ v: [1, 2] });
		const back = h.undo();
		expect(back).toEqual({ v: [1] });
		back!.v.push(99); // mutating the returned clone must not corrupt the stack
		expect(h.redo()).toEqual({ v: [1, 2] });
	});

	it("returns null at the ends", () => {
		const h = createHistory<number>(10);
		expect(h.undo()).toBeNull();
		h.push(1);
		expect(h.undo()).toBeNull(); // only one snapshot — nothing earlier
		expect(h.redo()).toBeNull();
	});

	it("skips consecutive identical snapshots", () => {
		const h = createHistory<number>(10);
		h.push(1);
		h.push(1);
		h.push(2);
		expect(h.undo()).toBe(1);
		expect(h.undo()).toBeNull(); // the duplicate was never stored
	});

	it("evicts oldest beyond the limit", () => {
		const h = createHistory<number>(3);
		for (const n of [1, 2, 3, 4]) h.push(n);
		h.undo();
		h.undo();
		expect(h.undo()).toBeNull(); // 1 was evicted; stack bottom is 2
	});

	it("new push after undo drops the redo tail", () => {
		const h = createHistory<number>(10);
		h.push(1);
		h.push(2);
		h.undo();
		h.push(3);
		expect(h.redo()).toBeNull();
		expect(h.undo()).toBe(1);
	});

	it("lock suppresses pushes and auto-unlocks after ms", () => {
		const h = createHistory<number>(10);
		h.push(1);
		h.lock(500);
		h.push(2); // swallowed
		expect(h.locked()).toBe(true);
		vi.advanceTimersByTime(500);
		expect(h.locked()).toBe(false);
		h.push(3);
		expect(h.undo()).toBe(1); // 2 never recorded
	});

	it("reset clears everything", () => {
		const h = createHistory<number>(10);
		h.push(1);
		h.reset();
		expect(h.undo()).toBeNull();
		expect(h.redo()).toBeNull();
	});
});
