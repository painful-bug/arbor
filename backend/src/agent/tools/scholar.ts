// Scholarly search tool: OpenAlex + arXiv merged, deduped, citation-sorted.
import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { fetchJson, fetchText } from "../../http.ts";
import { strip, UA } from "./web-search.ts";

/** One scholarly result, normalized across OpenAlex and arXiv. */
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
	max_results: Type.Optional(Type.Number({ description: "Max papers (default 6)." })),
});

/** Rebuild abstract text from OpenAlex's inverted index. Exported for tests only. */
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
	const data = await fetchJson<{ results?: any[] }>(url, { headers: { "user-agent": UA } });
	return (data.results ?? []).map((w) => ({
		title: w.title ?? w.display_name ?? "(untitled)",
		authors: (w.authorships ?? [])
			.map((a: any) => a.author?.display_name)
			.filter(Boolean)
			.slice(0, 6),
		year: w.publication_year,
		venue: w.primary_location?.source?.display_name,
		citations: w.cited_by_count,
		abstract: reconstructAbstract(w.abstract_inverted_index),
		url: w.doi ? `https://doi.org/${String(w.doi).replace(/^https?:\/\/doi\.org\//, "")}` : w.id,
		pdf: w.open_access?.oa_url ?? w.best_oa_location?.pdf_url ?? undefined,
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
	const xml = await fetchText(url, { headers: { "user-agent": UA } });
	const entries = xml.split("<entry>").slice(1);
	return entries.slice(0, max).map((e) => {
		const abs = xmlTag(e, "id") ?? "";
		const pdf = (e.match(/href="([^"]*\/pdf\/[^"]*)"/) || [])[1] ?? abs.replace("/abs/", "/pdf/");
		const authors = [...e.matchAll(/<name>([\s\S]*?)<\/name>/g)]
			.map((m) => strip(m[1]))
			.slice(0, 6);
		const published = xmlTag(e, "published");
		return {
			title: (xmlTag(e, "title") ?? "(untitled)").replace(/\s+/g, " "),
			authors,
			year: published ? Number(published.slice(0, 4)) : undefined,
			venue: "arXiv",
			abstract: xmlTag(e, "summary")?.replace(/\s+/g, " "),
			url: abs,
			pdf,
		};
	});
}

/** Merge two paper lists: dedupe by lowercased title, sort by citations desc, cap at max. Exported for tests only. */
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

/** Render papers as a numbered plain-text list for the LLM. Exported for tests only. */
export function formatPapers(query: string, papers: Paper[]): string {
	if (!papers.length) return `No scholarly results for "${query}".`;
	return papers
		.map((p, i) => {
			const meta = [p.authors.join(", "), p.venue, p.year].filter(Boolean).join(" · ");
			const cited = p.citations != null ? ` · cited ${p.citations}` : "";
			const abs = p.abstract
				? `\n${p.abstract.slice(0, 400)}${p.abstract.length > 400 ? "…" : ""}`
				: "";
			const links = [p.url, p.pdf && p.pdf !== p.url ? `PDF: ${p.pdf}` : ""]
				.filter(Boolean)
				.join("  ");
			return `[${i + 1}] ${p.title}\n${meta}${cited}${abs}\n${links}`;
		})
		.join("\n\n");
}

/** Scholarly-literature search AgentTool (OpenAlex + arXiv). */
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
				arxiv(params.query, per).catch(() => [] as Paper[]),
			]);
			const papers = mergePapers(oa, ax, max);
			return {
				content: [{ type: "text", text: formatPapers(params.query, papers) }],
				details: { papers },
			};
		},
	};
}
