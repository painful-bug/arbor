import { describe, expect, it } from "bun:test";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-mcp-token");

const rpc = (body: unknown) =>
	api("/api/mcp/", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Accept: "application/json, text/event-stream",
		},
		body: JSON.stringify(body),
	});

const INIT = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-06-18",
		capabilities: {},
		clientInfo: { name: "test", version: "1.0" },
	},
};

describe("MCP route", () => {
	it("requires the Bearer token", async () => {
		const app = makeTestApp("t").app;
		const res = await app.fetch(
			new Request("http://localhost/api/mcp/", { method: "POST", body: "{}" }),
		);
		expect(res.status).toBe(401);
	});

	it("initialize → 200 with serverInfo 'arbor'", async () => {
		const res = await rpc(INIT);
		expect(res.status).toBe(200);
		const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
		expect(json.result?.serverInfo?.name).toBe("arbor");
	});

	it("tools/list → exposes kb + canvas tools", async () => {
		// Stateless: fold initialize + list into one batch is not supported; send list
		// after an initialize on the same (fresh) transport — the SDK allows a
		// notifications/initialized-free list in stateless JSON mode.
		await rpc(INIT);
		const res = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
		expect(res.status).toBe(200);
		const json = (await res.json()) as { result?: { tools?: { name: string }[] } };
		const names = (json.result?.tools ?? []).map((t) => t.name).sort();
		expect(names).toEqual([
			"get_canvas",
			"kb_overview",
			"kb_read_source",
			"kb_search",
			"list_canvases",
		]);
	});
});
