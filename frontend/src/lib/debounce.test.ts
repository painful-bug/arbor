import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

describe("debounce", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("coalesces rapid calls into one trailing call with last args", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d("a");
		d("b");
		d("c");
		vi.advanceTimersByTime(99);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("c");
	});

	it("fires again for calls after the wait", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d(1);
		vi.advanceTimersByTime(100);
		d(2);
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(2);
		expect(fn).toHaveBeenLastCalledWith(2);
	});

	it("cancel prevents the pending call", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d("x");
		d.cancel();
		vi.advanceTimersByTime(200);
		expect(fn).not.toHaveBeenCalled();
	});

	it("flush fires the pending call immediately", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d("y");
		d.flush();
		expect(fn).toHaveBeenCalledTimes(1);
		expect(fn).toHaveBeenCalledWith("y");
		// Nothing left pending.
		vi.advanceTimersByTime(200);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("flush with nothing pending is a no-op", () => {
		const fn = vi.fn();
		const d = debounce(fn, 100);
		d.flush();
		expect(fn).not.toHaveBeenCalled();
	});
});
