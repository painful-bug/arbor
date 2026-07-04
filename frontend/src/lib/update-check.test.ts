import { beforeEach, describe, expect, it, vi } from "vitest";
import { maybeCheckUpdates, resetUpdateCheckGate } from "./update-check";

beforeEach(() => resetUpdateCheckGate());

describe("maybeCheckUpdates", () => {
	it("runs on first call", async () => {
		const check = vi.fn().mockResolvedValue(undefined);
		await maybeCheckUpdates(() => 0, check);
		expect(check).toHaveBeenCalledTimes(1);
	});

	it("is a no-op within the 6h window", async () => {
		const check = vi.fn().mockResolvedValue(undefined);
		await maybeCheckUpdates(() => 0, check);
		await maybeCheckUpdates(() => 6 * 60 * 60 * 1000 - 1, check);
		expect(check).toHaveBeenCalledTimes(1);
	});

	it("fires again once 6h have elapsed", async () => {
		const check = vi.fn().mockResolvedValue(undefined);
		await maybeCheckUpdates(() => 0, check);
		await maybeCheckUpdates(() => 6 * 60 * 60 * 1000 + 1, check);
		expect(check).toHaveBeenCalledTimes(2);
	});
});
