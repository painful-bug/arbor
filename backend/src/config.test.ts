// Timeout invariants: a slow LLM completion must outlast the plain-fetch default
// (it was 504ing at 15s) yet finish before the server drops its idle socket.
import { describe, expect, it } from "bun:test";
import { HTTP_TIMEOUT_MS, LLM_TIMEOUT_MS, SERVER_IDLE_TIMEOUT_S } from "./config.ts";

describe("timeout config", () => {
	it("LLM completions get a longer window than a plain fetch", () => {
		expect(LLM_TIMEOUT_MS).toBeGreaterThan(HTTP_TIMEOUT_MS);
	});

	it("server idle timeout outlasts the LLM timeout (clean upstream 504, no dropped socket)", () => {
		expect(SERVER_IDLE_TIMEOUT_S * 1000).toBeGreaterThan(LLM_TIMEOUT_MS);
	});
});
