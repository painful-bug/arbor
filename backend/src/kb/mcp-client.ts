// Thin client over the Graphiti MCP server (HTTP/StreamableHTTP transport).
// Everything is namespaced by group_id = canvas id, which gives each canvas an
// isolated knowledge base inside one shared FalkorDB instance.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { MCP_ENDPOINT } from "./server-process.ts";

let client: Client | null = null;

async function getClient(): Promise<Client> {
	if (client) return client;
	const c = new Client({ name: "loom", version: "1.0.0" });
	await c.connect(new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT)));
	client = c;
	return c;
}

// Drop the cached connection (call after the MCP server restarts).
export function resetClient(): void {
	try {
		client?.close();
	} catch {
		/* ignore */
	}
	client = null;
}

type ToolResult = { content?: Array<{ type: string; text?: string }>; structuredContent?: unknown; isError?: boolean };

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
	const c = await getClient();
	return (await c.callTool({ name, arguments: args })) as ToolResult;
}

function textOf(r: ToolResult): string {
	return (r.content ?? [])
		.filter((p) => p.type === "text" && p.text)
		.map((p) => p.text)
		.join("\n")
		.trim();
}

// Add one episode to a canvas's graph. Returns once the server has *queued* it
// (Graphiti extracts entities/edges asynchronously in the background).
export async function addMemory(
	groupId: string,
	name: string,
	content: string,
	source: "text" | "json" | "message" = "text",
	sourceDescription = "",
): Promise<void> {
	await call("add_memory", {
		name,
		episode_body: content,
		group_id: groupId,
		source,
		source_description: sourceDescription,
	});
}

// Unwrap a tool response into its payload object. The MCP SDK exposes the tool's
// pydantic return value as structuredContent wrapped under a "result" key
// (e.g. {result:{nodes:[…]}}); the text content carries the same object unwrapped.
function payload(r: ToolResult): Record<string, unknown> {
	const sc = r.structuredContent as Record<string, unknown> | undefined;
	if (sc && typeof sc === "object") {
		const inner = sc.result;
		return (inner && typeof inner === "object" ? inner : sc) as Record<string, unknown>;
	}
	try {
		return JSON.parse(textOf(r)) as Record<string, unknown>;
	} catch {
		return {};
	}
}

// Search facts (entity edges) in a canvas's graph.
export async function searchFacts(groupId: string, query: string, maxFacts = 10): Promise<string[]> {
	const r = await call("search_memory_facts", { query, group_ids: [groupId], max_facts: maxFacts });
	const facts = (payload(r).facts as Array<{ fact?: string }> | undefined) ?? [];
	return facts.map((f) => f.fact ?? "").filter(Boolean);
}

// Search nodes (entities) in a canvas's graph.
export async function searchNodes(groupId: string, query: string, maxNodes = 10): Promise<string[]> {
	const r = await call("search_nodes", { query, group_ids: [groupId], max_nodes: maxNodes });
	const nodes = (payload(r).nodes as Array<{ name?: string; summary?: string }> | undefined) ?? [];
	return nodes.map((n) => [n.name, n.summary].filter(Boolean).join(": ")).filter(Boolean);
}

// Wipe a canvas's graph (called when a canvas is deleted).
export async function clearGraph(groupId: string): Promise<void> {
	await call("clear_graph", { group_ids: [groupId] });
}

export async function status(): Promise<string> {
	return textOf(await call("get_status", {}));
}

// Debug helper — raw tool call (used by the Phase-1 proof to inspect responses).
export async function rawCall(name: string, args: Record<string, unknown>): Promise<unknown> {
	const r = await call(name, args);
	return r.structuredContent ?? textOf(r);
}
