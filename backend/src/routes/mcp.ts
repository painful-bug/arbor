// MCP server: exposes Arbor's knowledge base + canvases to any MCP client
// (Claude Desktop, Cursor, …) over the same loopback port. Mounted under
// /api/mcp, so it inherits the Bearer-token auth + CORS from server.ts — no data
// leaves the machine except to the model the caller already chose.
//
// Tools are thin, read-only wrappers over functions that already exist in
// kb/index.ts and the canvases table. Stateless streamable-HTTP: a fresh
// server+transport is built per request (cheap; avoids cross-request stream state).
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { contentsOf, readSource, searchGraded } from "../kb/index.ts";
import { db } from "../store/db.ts";
import { canvases } from "../store/schema.ts";

const asText = (data: unknown) => ({
	content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});

function buildServer(): McpServer {
	const server = new McpServer({ name: "arbor", version: "1.0.0" });

	server.registerTool(
		"kb_search",
		{
			description:
				"Search a canvas's knowledge base. Returns graded, ranked passages each with source filename + page.",
			inputSchema: {
				canvas: z.string().describe("canvas id (from list_canvases)"),
				query: z.string(),
				k: z.number().optional().describe("max passages, default 6"),
			},
		},
		async ({ canvas, query, k }) => asText(await searchGraded(canvas, query, k ?? 6)),
	);

	server.registerTool(
		"kb_overview",
		{
			description: "List the sources indexed in a canvas and the total chunk count.",
			inputSchema: { canvas: z.string().describe("canvas id") },
		},
		async ({ canvas }) => asText(await contentsOf(canvas)),
	);

	server.registerTool(
		"kb_read_source",
		{
			description: "Read the full extracted text of one source file in a canvas.",
			inputSchema: {
				canvas: z.string().describe("canvas id"),
				source: z.string().describe("source filename (from kb_overview)"),
			},
		},
		async ({ canvas, source }) => {
			const chunks = await readSource(canvas, source);
			return { content: [{ type: "text" as const, text: chunks.join("\n\n") }] };
		},
	);

	server.registerTool(
		"list_canvases",
		{ description: "List all canvases (id + name).", inputSchema: {} },
		async () => asText(db.select({ id: canvases.id, name: canvases.name }).from(canvases).all()),
	);

	server.registerTool(
		"get_canvas",
		{
			description: "Get a canvas's nodes + edges (full document) by id.",
			inputSchema: { id: z.string().describe("canvas id") },
		},
		async ({ id }) => {
			const row = db.select().from(canvases).where(eq(canvases.id, id)).get();
			if (!row) return { content: [{ type: "text" as const, text: "not found" }], isError: true };
			const doc = JSON.parse(row.doc) as { nodes: unknown[]; edges: unknown[] };
			return asText({ id: row.id, name: row.name, nodes: doc.nodes, edges: doc.edges });
		},
	);

	return server;
}

export const mcpRoutes = new Hono();

// GET/POST/DELETE all handled by the transport (initialize, tools/list, tools/call).
// Match with and without a trailing slash — MCP clients configure either.
mcpRoutes.all("*", async (c) => {
	const server = buildServer();
	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined, // stateless — no session to persist
		enableJsonResponse: true, // return JSON, not an SSE stream (simpler clients)
	});
	await server.connect(transport);
	// ponytail: stateless per-request instances; GC reclaims them, nothing to close.
	return transport.handleRequest(c.req.raw);
});
