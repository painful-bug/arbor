// Canvas knowledge base tools: search / overview / read-source. Callbacks are
// injected so run.ts can bind them to the active canvas.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import type { GradedSearch } from "../../kb/index.ts";

const kbSchema = Type.Object({
	query: Type.String({
		description:
			"Content-topic search terms (e.g. 'TCP handshake', 'mitochondria'), NOT meta like 'pdf' or 'file'.",
	}),
});

/** KB hybrid-search AgentTool. `search` is bound to the active canvas by the caller. */
export function knowledgeBaseSearchTool(
	search: (query: string) => Promise<GradedSearch>,
): AgentTool<typeof kbSchema> {
	return {
		name: "knowledge_base_search",
		label: "knowledge_base_search",
		description:
			"Search this canvas's indexed content (files, chats, notes) by topic. Returns top matching chunks reranked by a cross-encoder, plus a relevance verdict (strong/weak/none). Use when the user references uploaded material or asks about content that may be in the KB. Search by subject keywords, not filenames. Honor the verdict: on 'weak' rewrite the query once and retry, on 'none' fall back to web_search instead of forcing an answer.",
		parameters: kbSchema,
		async execute(_id, params): Promise<AgentToolResult<{ chunks: string[]; verdict: string }>> {
			const { chunks, verdict } = await search(params.query);
			const texts = chunks.map((c) => c.text);
			if (chunks.length === 0 || verdict === "none") {
				return {
					content: [
						{
							type: "text",
							text: `Relevance verdict: none — the KB has no strong match for "${params.query}". Rewrite with broader subject terms and retry, or fall back to web_search. Do not answer from unrelated chunks.`,
						},
					],
					details: { chunks: texts, verdict: "none" },
				};
			}
			const body = chunks
				.map(
					(c, i) =>
						`[${i + 1}]${c.score >= 0 ? ` (relevance ${c.score.toFixed(2)})` : ""}\n${c.text}`,
				)
				.join("\n\n---\n\n");
			const hint =
				verdict === "weak"
					? "\n\n(Verdict: weak — these may be partial or off-target. Rewrite the query once and retry; if still weak, use web_search and separate KB claims from web claims.)"
					: "";
			return {
				content: [{ type: "text", text: `Relevance verdict: ${verdict}\n\n${body}${hint}` }],
				details: { chunks: texts, verdict },
			};
		},
	};
}

const kbOverviewSchema = Type.Object({});

/** KB overview AgentTool — lists indexed sources + total chunk count. */
export function knowledgeBaseOverviewTool(
	overview: () => Promise<{ sources: string[]; chunks: number }>,
): AgentTool<typeof kbOverviewSchema> {
	return {
		name: "knowledge_base_overview",
		label: "knowledge_base_overview",
		description:
			"List all indexed sources and total chunk count in this canvas's KB. Use for 'what's indexed?', 'what files do I have?', or as a prerequisite to knowledge_base_read_source (which needs an exact source name).",
		parameters: kbOverviewSchema,
		async execute(_id): Promise<AgentToolResult<{ sources: string[]; chunks: number }>> {
			const { sources, chunks } = await overview();
			if (!sources.length) {
				return {
					content: [{ type: "text", text: "KB is empty — no files, chats, or notes indexed yet." }],
					details: { sources: [], chunks: 0 },
				};
			}
			const text = `## Indexed sources (${chunks} chunks total)\n${sources.map((s) => `- ${s}`).join("\n")}`;
			return { content: [{ type: "text", text }], details: { sources, chunks } };
		},
	};
}

const kbReadSourceSchema = Type.Object({
	source: Type.String({
		description: "Exact source name from knowledge_base_overview (e.g. 'lecture.pdf', 'chat:n5').",
	}),
});

/** KB read-source AgentTool — returns every chunk from one source. */
export function knowledgeBaseReadSourceTool(
	readSource: (source: string) => Promise<string[]>,
): AgentTool<typeof kbReadSourceSchema> {
	return {
		name: "knowledge_base_read_source",
		label: "knowledge_base_read_source",
		description:
			"Return ALL chunks from one source — the full content, not just top matches. Use for summarize/review/explain-entire-file requests. Get the exact source name from knowledge_base_overview first. For multiple files, call this in parallel for each.",
		parameters: kbReadSourceSchema,
		async execute(_id, params): Promise<AgentToolResult<{ chunks: string[] }>> {
			const chunks = await readSource(params.source);
			if (!chunks.length) {
				return {
					content: [
						{
							type: "text",
							text: `Source "${params.source}" not found. Call knowledge_base_overview to get exact names.`,
						},
					],
					details: { chunks: [] },
				};
			}
			return {
				content: [{ type: "text", text: chunks.join("\n\n---\n\n") }],
				details: { chunks },
			};
		},
	};
}
