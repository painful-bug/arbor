// completeText: per-provider request shape + text extraction, against a local
// Bun.serve stub. No real provider is contacted.
import { afterAll, describe, expect, it } from "bun:test";
import { AppError } from "../errors.ts";
import { completeText } from "./llm.ts";

interface Seen {
	path: string;
	headers: Record<string, string>;
	body: any;
}
let seen: Seen | null = null;

const server = Bun.serve({
	port: 0,
	async fetch(req) {
		const url = new URL(req.url);
		seen = {
			path: url.pathname + url.search,
			headers: Object.fromEntries(req.headers.entries()),
			body: await req.json(),
		};
		if (url.pathname === "/v1/messages") {
			return Response.json({ content: [{ type: "text", text: "anthropic says hi" }] });
		}
		if (url.pathname.startsWith("/v1beta/models/")) {
			return Response.json({
				candidates: [{ content: { parts: [{ text: "google says hi" }] } }],
			});
		}
		if (url.pathname === "/chat/completions") {
			return Response.json({ choices: [{ message: { content: "openai says hi" } }] });
		}
		return new Response("boom", { status: 500 });
	},
});
const base = `http://127.0.0.1:${server.port}`;

afterAll(() => {
	server.stop(true);
});

describe("completeText", () => {
	it("anthropic: x-api-key header, model + max_tokens in body, extracts text", async () => {
		const text = await completeText({
			provider: "anthropic",
			baseUrl: base,
			model: "claude-haiku-4-5-20251001",
			apiKey: "sk-ant-test",
			prompt: "hello",
			maxTokens: 200,
		});
		expect(text).toBe("anthropic says hi");
		expect(seen!.headers["x-api-key"]).toBe("sk-ant-test");
		expect(seen!.body.model).toBe("claude-haiku-4-5-20251001");
		expect(seen!.body.max_tokens).toBe(200);
		expect(seen!.body.messages).toEqual([{ role: "user", content: "hello" }]);
	});

	it("google: key in query param, prompt in contents, extracts text", async () => {
		const text = await completeText({
			provider: "google",
			baseUrl: base,
			model: "gemini-2.0-flash",
			apiKey: "g-key",
			prompt: "hello",
		});
		expect(text).toBe("google says hi");
		expect(seen!.path).toContain("/v1beta/models/gemini-2.0-flash:generateContent");
		expect(seen!.path).toContain("key=g-key");
		expect(seen!.body.contents).toEqual([{ parts: [{ text: "hello" }] }]);
	});

	it("openai-compat: bearer auth, system message prepended, extracts text", async () => {
		const text = await completeText({
			provider: "openai-compat",
			baseUrl: base,
			model: "gpt-4o-mini",
			apiKey: "sk-test",
			system: "be terse",
			prompt: "hello",
		});
		expect(text).toBe("openai says hi");
		expect(seen!.headers.authorization).toBe("Bearer sk-test");
		expect(seen!.body.model).toBe("gpt-4o-mini");
		expect(seen!.body.messages).toEqual([
			{ role: "system", content: "be terse" },
			{ role: "user", content: "hello" },
		]);
	});

	it("json:true sets response_format on openai-compat, omitted otherwise", async () => {
		await completeText({ provider: "openai-compat", baseUrl: base, model: "m", apiKey: "k", prompt: "p", json: true });
		expect(seen!.body.response_format).toEqual({ type: "json_object" });
		await completeText({ provider: "openai-compat", baseUrl: base, model: "m", apiKey: "k", prompt: "p" });
		expect(seen!.body.response_format).toBeUndefined();
	});

	it("json:true sets responseMimeType on google", async () => {
		await completeText({ provider: "google", baseUrl: base, model: "gemini-2.0-flash", apiKey: "g", prompt: "p", json: true });
		expect(seen!.body.generationConfig).toEqual({ responseMimeType: "application/json" });
	});

	it("openai-compat: empty apiKey sends no authorization header (ollama)", async () => {
		await completeText({
			provider: "openai-compat",
			baseUrl: base,
			model: "llama3",
			apiKey: "",
			prompt: "hello",
		});
		expect(seen!.headers.authorization).toBeUndefined();
	});

	it("openai-compat without baseUrl throws BAD_REQUEST", async () => {
		expect(
			completeText({ provider: "openai-compat", model: "m", apiKey: "k", prompt: "p" }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("upstream 500 → AppError UPSTREAM", async () => {
		const p = completeText({
			provider: "openai-compat",
			baseUrl: `${base}/nope`,
			model: "m",
			apiKey: "k",
			prompt: "p",
		});
		expect(p).rejects.toBeInstanceOf(AppError);
		await p.catch((e) => {
			expect((e as AppError).code).toBe("UPSTREAM");
			expect((e as AppError).status).toBe(502);
		});
	});
});
