// Web search tools: Tavily (API, needs key) and DuckDuckGo (HTML scrape, keyless).
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { fetchJson, fetchText } from "../../http.ts";

/** Which web-search backend the agent should use. */
export type WebBackend = "tavily" | "duckduckgo";

interface Hit {
	title: string;
	url: string;
	snippet: string;
}

const searchSchema = Type.Object({
	query: Type.String({ description: "The web search query." }),
	max_results: Type.Optional(Type.Number({ description: "Max results (default 5)." })),
});

async function tavily(
	query: string,
	max: number,
	apiKey: string,
): Promise<{ hits: Hit[]; answer?: string }> {
	const data = await fetchJson<{
		answer?: string;
		results?: { title: string; url: string; content: string }[];
	}>("https://api.tavily.com/search", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			max_results: max,
			search_depth: "advanced",
			include_answer: true,
		}),
	});
	const hits = (data.results ?? []).map((r) => ({
		title: r.title,
		url: r.url,
		snippet: r.content,
	}));
	return { hits, answer: data.answer };
}

// ponytail: regex scrape of DDG's HTML, not an API. Try lite as fallback. Throw on 0 results.
/** Browser-ish user agent for scrape/API requests (shared with scholar.ts). */
export const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
/** Strip HTML tags + unescape ampersands from a scraped fragment (shared with scholar.ts). */
export const strip = (s: string) =>
	s
		.replace(/<[^>]+>/g, "")
		.replace(/&amp;/g, "&")
		.trim();
const unwrap = (url: string) => {
	const ud = url.match(/uddg=([^&]+)/);
	return ud ? decodeURIComponent(ud[1]) : url;
};

async function ddgHtml(query: string, max: number): Promise<Hit[]> {
	const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
		headers: { "user-agent": UA },
	});
	const hits: Hit[] = [];
	const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) && hits.length < max) {
		hits.push({ title: strip(m[2]), url: unwrap(m[1]), snippet: "" });
	}
	return hits;
}

async function ddgLite(query: string, max: number): Promise<Hit[]> {
	const html = await fetchText(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
		headers: { "user-agent": UA },
	});
	const hits: Hit[] = [];
	const re = /<a[^>]*class="result-link"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) && hits.length < max) {
		hits.push({ title: strip(m[2]), url: unwrap(m[1]), snippet: "" });
	}
	return hits;
}

async function duckduckgo(query: string, max: number): Promise<{ hits: Hit[]; answer?: string }> {
	let hits = await ddgHtml(query, max).catch(() => [] as Hit[]);
	if (hits.length === 0) hits = await ddgLite(query, max).catch(() => [] as Hit[]);
	if (hits.length === 0)
		throw new Error(
			"DuckDuckGo returned no results (it often rate-limits automated requests). " +
				"Enable Tavily in Settings → Web Search for reliable results.",
		);
	return { hits };
}

function format(query: string, hits: Hit[], answer?: string): string {
	if (hits.length === 0 && !answer) return `No web results for "${query}".`;
	const lines: string[] = [];
	if (answer) lines.push(`Answer: ${answer}\n`);
	hits.forEach((h, i) => {
		lines.push(`[${i + 1}] ${h.title}\n${h.url}${h.snippet ? `\n${h.snippet}` : ""}`);
	});
	return lines.join("\n\n");
}

/** Web search AgentTool. Uses Tavily when selected AND a key exists, else DDG scrape. */
export function webSearchTool(
	backend: WebBackend,
	tavilyKey?: string,
): AgentTool<typeof searchSchema> {
	return {
		name: "web_search",
		label: "web_search",
		description:
			"Search the web for current information. Returns ranked results with titles, URLs, and snippets. Use for facts that may be recent or outside your training data; cite the URLs you rely on.",
		parameters: searchSchema,
		async execute(_id, params): Promise<AgentToolResult<{ hits: Hit[] }>> {
			const max = Math.min(Math.max(params.max_results ?? 5, 1), 10);
			const useTavily = backend === "tavily" && !!tavilyKey;
			try {
				const { hits, answer } = useTavily
					? await tavily(params.query, max, tavilyKey!)
					: await duckduckgo(params.query, max);
				return {
					content: [{ type: "text", text: format(params.query, hits, answer) }],
					details: { hits },
				};
			} catch (err) {
				const msg = (err as Error)?.message ?? String(err);
				return {
					content: [{ type: "text", text: `Web search failed: ${msg}` }],
					details: { hits: [] },
				};
			}
		},
	};
}
