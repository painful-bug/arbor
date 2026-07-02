import { describe, expect, test } from "bun:test";
import { AppError, badRequest, notFound } from "./errors.ts";
import { makeTestApp } from "./routes/test-utils.ts";

describe("AppError", () => {
	test("carries status and code", () => {
		const e = new AppError("boom", 418, "TEAPOT");
		expect(e).toBeInstanceOf(Error);
		expect(e.message).toBe("boom");
		expect(e.status).toBe(418);
		expect(e.code).toBe("TEAPOT");
	});

	test("defaults to 500 INTERNAL", () => {
		const e = new AppError("boom");
		expect(e.status).toBe(500);
		expect(e.code).toBe("INTERNAL");
	});

	test("factories set the right status/code", () => {
		expect(badRequest("x").status).toBe(400);
		expect(badRequest("x").code).toBe("BAD_REQUEST");
		expect(notFound("x").status).toBe(404);
		expect(notFound("x").code).toBe("NOT_FOUND");
	});
});

describe("app.onError boundary", () => {
	const { api } = makeTestApp("tok");

	test("AppError maps to its status with {error, code}", async () => {
		// files.ts throws badRequest("missing path") when ?path is absent.
		const res = await api("/api/files/read");
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: string; code: string };
		expect(body.error).toBe("missing path");
		expect(body.code).toBe("BAD_REQUEST");
	});

	test("generic Error maps to 500 INTERNAL", async () => {
		// Reading a nonexistent path throws a plain fs error.
		const res = await api("/api/files/read?path=/definitely/not/a/real/path.txt");
		expect(res.status).toBe(500);
		const body = (await res.json()) as { error: string; code: string };
		expect(body.code).toBe("INTERNAL");
		expect(body.error.length).toBeGreaterThan(0);
	});
});
