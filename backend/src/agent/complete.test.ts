// pickModel: two-tier model routing, and catalog-coverage guard vs PROVIDERS.
import { describe, expect, it } from "bun:test";
import { pickModel, SMALL_MODELS } from "./complete.ts";
import { PROVIDERS } from "./providers.ts";

describe("pickModel", () => {
	it("small tier ignores the user's model", () => {
		expect(pickModel("anthropic", "claude-opus-x", "small")).toBe("claude-haiku-4-5");
	});

	it("user tier uses the user's model when set", () => {
		expect(pickModel("anthropic", "claude-opus-x", "user")).toBe("claude-opus-x");
	});

	it("user tier falls back to the small catalog when unset", () => {
		expect(pickModel("google", undefined, "user")).toBe("gemini-2.0-flash");
	});

	it("returns empty string for an unknown provider with no user model", () => {
		expect(pickModel("unknown", undefined, "user")).toBe("");
	});
});

describe("SMALL_MODELS coverage", () => {
	it("has an entry for every known provider", () => {
		for (const provider of Object.keys(PROVIDERS)) {
			expect(SMALL_MODELS[provider]).toBeTruthy();
		}
	});
});
