// Agent tools: web search (Tavily/DDG), scholar search (OpenAlex+arXiv),
// research plan, and canvas RAG search (in-process via rag/index.ts).
import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";

export type WebBackend = "tavily" | "duckduckgo";

interface Hit {
	title: string;
	url: string;
	snippet: string;
}

const searchSchema = Type.Object({
	query: Type.String({ description: "The web search query." }),
	max_results: Type.Optional(Type.Number({ description: "Max results (default 5)." }))
});

async function tavily(query: string, max: number, apiKey: string): Promise<{ hits: Hit[]; answer?: string }> {
	const res = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			api_key: apiKey,
			query,
			max_results: max,
			search_depth: "advanced",
			include_answer: true
		})
	});
	if (!res.ok) throw new Error(`Tavily ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const data = (await res.json()) as {
		answer?: string;
		results?: { title: string; url: string; content: string }[];
	};
	const hits = (data.results ?? []).map((r) => ({ title: r.title, url: r.url, snippet: r.content }));
	return { hits, answer: data.answer };
}

// ponytail: regex scrape of DDG's HTML, not an API. Try lite as fallback. Throw on 0 results.
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const strip = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
const unwrap = (url: string) => {
	const ud = url.match(/uddg=([^&]+)/);
	return ud ? decodeURIComponent(ud[1]) : url;
};

async function ddgHtml(query: string, max: number): Promise<Hit[]> {
	const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
		headers: { "user-agent": UA }
	});
	if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
	const html = await res.text();
	const hits: Hit[] = [];
	const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) && hits.length < max) {
		hits.push({ title: strip(m[2]), url: unwrap(m[1]), snippet: "" });
	}
	return hits;
}

async function ddgLite(query: string, max: number): Promise<Hit[]> {
	const res = await fetch("https://lite.duckduckgo.com/lite/?q=" + encodeURIComponent(query), {
		headers: { "user-agent": UA }
	});
	if (!res.ok) throw new Error(`DuckDuckGo lite ${res.status}`);
	const html = await res.text();
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
				"Enable Tavily in Settings → Web Search for reliable results."
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

// ── Scholarly search ────────────────────────────────────────────────────────
export interface Paper {
	title: string;
	authors: string[];
	year?: number;
	venue?: string;
	citations?: number;
	abstract?: string;
	url: string;
	pdf?: string;
}

const scholarSchema = Type.Object({
	query: Type.String({ description: "Search query — keywords or a research question." }),
	max_results: Type.Optional(Type.Number({ description: "Max papers (default 6)." }))
});

export function reconstructAbstract(inv?: Record<string, number[]>): string | undefined {
	if (!inv) return undefined;
	const words: string[] = [];
	for (const [word, positions] of Object.entries(inv)) {
		for (const p of positions) words[p] = word;
	}
	const text = words.join(" ").replace(/\s+/g, " ").trim();
	return text || undefined;
}

async function openAlex(query: string, max: number): Promise<Paper[]> {
	const url =
		"https://api.openalex.org/works?search=" +
		encodeURIComponent(query) +
		`&per_page=${max}&mailto=loom-app@example.com`;
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`OpenAlex ${res.status}`);
	const data = (await res.json()) as { results?: any[] };
	return (data.results ?? []).map((w) => ({
		title: w.title ?? w.display_name ?? "(untitled)",
		authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean).slice(0, 6),
		year: w.publication_year,
		venue: w.primary_location?.source?.display_name,
		citations: w.cited_by_count,
		abstract: reconstructAbstract(w.abstract_inverted_index),
		url: w.doi ? `https://doi.org/${String(w.doi).replace(/^https?:\/\/doi\.org\//, "")}` : w.id,
		pdf: w.open_access?.oa_url ?? w.best_oa_location?.pdf_url ?? undefined
	}));
}

const xmlTag = (block: string, tag: string) => {
	const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
	return m ? strip(m[1]) : undefined;
};

async function arxiv(query: string, max: number): Promise<Paper[]> {
	const url =
		"http://export.arxiv.org/api/query?search_query=all:" +
		encodeURIComponent(query) +
		`&start=0&max_results=${max}`;
	const res = await fetch(url, { headers: { "user-agent": UA } });
	if (!res.ok) throw new Error(`arXiv ${res.status}`);
	const xml = await res.text();
	const entries = xml.split("<entry>").slice(1);
	return entries.slice(0, max).map((e) => {
		const abs = xmlTag(e, "id") ?? "";
		const pdf = (e.match(/href="([^"]*\/pdf\/[^"]*)"/) || [])[1] ?? abs.replace("/abs/", "/pdf/");
		const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => strip(m[1])).slice(0, 6);
		const published = xmlTag(e, "published");
		return {
			title: (xmlTag(e, "title") ?? "(untitled)").replace(/\s+/g, " "),
			authors,
			year: published ? Number(published.slice(0, 4)) : undefined,
			venue: "arXiv",
			abstract: xmlTag(e, "summary")?.replace(/\s+/g, " "),
			url: abs,
			pdf
		};
	});
}

export function mergePapers(a: Paper[], b: Paper[], max: number): Paper[] {
	const seen = new Set<string>();
	const all = [...a, ...b].filter((p) => {
		const k = p.title.toLowerCase().trim();
		if (!k || seen.has(k)) return false;
		seen.add(k);
		return true;
	});
	all.sort((x, y) => (y.citations ?? -1) - (x.citations ?? -1));
	return all.slice(0, max);
}

export function formatPapers(query: string, papers: Paper[]): string {
	if (!papers.length) return `No scholarly results for "${query}".`;
	return papers
		.map((p, i) => {
			const meta = [p.authors.join(", "), p.venue, p.year].filter(Boolean).join(" · ");
			const cited = p.citations != null ? ` · cited ${p.citations}` : "";
			const abs = p.abstract ? `\n${p.abstract.slice(0, 400)}${p.abstract.length > 400 ? "…" : ""}` : "";
			const links = [p.url, p.pdf && p.pdf !== p.url ? `PDF: ${p.pdf}` : ""].filter(Boolean).join("  ");
			return `[${i + 1}] ${p.title}\n${meta}${cited}${abs}\n${links}`;
		})
		.join("\n\n");
}

export function scholarSearchTool(): AgentTool<typeof scholarSchema> {
	return {
		name: "scholar_search",
		label: "scholar_search",
		description:
			"Search academic literature (OpenAlex + arXiv) for real research papers. Returns titles, authors, venue, year, citation counts, abstracts, and clickable URLs/PDF links. Use for literature reviews and deep research; cite each paper's URL so the user can open or embed it.",
		parameters: scholarSchema,
		async execute(_id, params): Promise<AgentToolResult<{ papers: Paper[] }>> {
			const max = Math.min(Math.max(params.max_results ?? 6, 1), 12);
			const per = Math.ceil(max / 2) + 2;
			const [oa, ax] = await Promise.all([
				openAlex(params.query, per).catch(() => [] as Paper[]),
				arxiv(params.query, per).catch(() => [] as Paper[])
			]);
			const papers = mergePapers(oa, ax, max);
			return { content: [{ type: "text", text: formatPapers(params.query, papers) }], details: { papers } };
		}
	};
}

const planSchema = Type.Object({
	topics: Type.Array(Type.String(), { description: "3–6 concrete sub-topics / search angles to investigate." }),
	rationale: Type.Optional(Type.String({ description: "One line on the overall strategy." }))
});

export function researchPlanTool(): AgentTool<typeof planSchema> {
	return {
		name: "research_plan",
		label: "research_plan",
		description:
			"Record your research plan BEFORE searching. Pass the sub-topics you will investigate. Call this first in deep research so the plan is shown to the user.",
		parameters: planSchema,
		async execute(_id, params): Promise<AgentToolResult<{ topics: string[] }>> {
			const text = "Plan:\n" + params.topics.map((t, i) => `${i + 1}. ${t}`).join("\n");
			return { content: [{ type: "text", text }], details: { topics: params.topics } };
		}
	};
}

// ── Canvas RAG search (in-process) ─────────────────────────────────────────
// In Phase 3 the agent runs inside the backend, so rag/index.ts search() is called
// directly — no stdio duplex, no HTTP bridge. Images are [] until Phase 4 adds
// the vision blob path.
const ragSchema = Type.Object({
	query: Type.String({ description: "What to look for in the user's dropped files." })
});

export function ragSearchTool(
	search: (query: string) => Promise<string[]>
): AgentTool<typeof ragSchema> {
	return {
		name: "rag_search",
		label: "rag_search",
		description:
			"Search the files the user dropped onto THIS canvas (PDFs, docx, markdown, notes, images). Returns the most relevant text chunks. This is the ONLY way to read the user's uploaded files — call it FIRST whenever they mention 'the pdf', 'the file', 'the document', 'my notes', 'the attachment', or any uploaded material, instead of asking them for a path.",
		parameters: ragSchema,
		async execute(_id, params): Promise<AgentToolResult<{ chunks: string[] }>> {
			const chunks = await search(params.query);
			const content =
				chunks.length > 0
					? [{ type: "text", text: chunks.join("\n\n---\n\n") }]
					: [
							{
								type: "text",
								text: `No indexed file content matched "${params.query}". The user may not have dropped any files on this canvas yet, or none are relevant to this query.`
							}
						];
			return { content, details: { chunks } };
		}
	};
}

// ── Canvas card tools ──────────────────────────────────────────────────────
// execute() is a no-op confirmation to the LLM; the real mutation happens
// frontend-side off the tool_start args (args flow via SSE to the store).

const createNoteSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Short title for the note." })),
	content: Type.String({ description: "The COMPLETE markdown content to save in the note." })
});

export function createNoteTool(): AgentTool<typeof createNoteSchema> {
	return {
		name: "create_note",
		label: "create_note",
		description:
			"Create a standalone markdown note card on the canvas. Use for saving drafted prose, summaries, emails, outlines, or any authored content the user wants to keep. Unlike create_card (a Q&A thread), notes are pure editable text with no conversation history.",
		parameters: createNoteSchema,
		async execute(_id, params): Promise<AgentToolResult<{ title?: string; content: string }>> {
			return {
				content: [{ type: "text", text: `Note "${params.title ?? "Untitled"}" created on the canvas.` }],
				details: { title: params.title, content: params.content }
			};
		}
	};
}

const createCardSchema = Type.Object({
	title: Type.String({ description: "Short title — the question or topic this card captures." }),
	content: Type.String({ description: "The COMPLETE answer in markdown to save into the new card body." })
});

export function createCardTool(): AgentTool<typeof createCardSchema> {
	return {
		name: "create_card",
		label: "create_card",
		description:
			"Create a new Q&A card on the canvas. Call this when the user asks to 'save as a card', 'create a card', 'add a card', or 'save the answer'. Pass the topic as title and the full markdown response as content. The card appears immediately on the canvas.",
		parameters: createCardSchema,
		async execute(_id, params): Promise<AgentToolResult<{ title: string; content: string }>> {
			return {
				content: [{ type: "text", text: `Card "${params.title}" created on the canvas.` }],
				details: { title: params.title, content: params.content }
			};
		}
	};
}

const updateCardSchema = Type.Object({
	card: Type.String({ description: "The card id (e.g. n3) from the canvas threads list, or the card's title. Prefer id when available." }),
	content: Type.String({ description: "New markdown content — fully replaces the card's current body." })
});

export function updateCardTool(): AgentTool<typeof updateCardSchema> {
	return {
		name: "update_card",
		label: "update_card",
		description:
			"Replace the content of an existing canvas card. Use the card id (e.g. n3) from the '## Other threads on this canvas' list when available, otherwise match by title. Call when the user says 'update', 'edit', 'change', or 'modify' a card.",
		parameters: updateCardSchema,
		async execute(_id, params): Promise<AgentToolResult<{ card: string; content: string }>> {
			return {
				content: [{ type: "text", text: `Card "${params.card}" updated.` }],
				details: { card: params.card, content: params.content }
			};
		}
	};
}

export function webSearchTool(backend: WebBackend, tavilyKey?: string): AgentTool<typeof searchSchema> {
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
					details: { hits }
				};
			} catch (err) {
				const msg = (err as Error)?.message ?? String(err);
				return {
					content: [{ type: "text", text: `Web search failed: ${msg}` }],
					details: { hits: [] }
				};
			}
		}
	};
}
