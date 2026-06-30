import { type Block } from "../ast.ts";

// Plain text / markdown → blocks. Blank lines separate blocks; `#` lines become
// headings so markdown structure survives into the AST. readingOrder is assigned
// globally by the orchestrator.
export function parseText(text: string): Block[] {
	const out: Block[] = [];
	for (const part of text.split(/\n{2,}/)) {
		const t = part.trim();
		if (!t) continue;
		const h = t.match(/^(#{1,6})\s+(.*)$/);
		if (h) {
			out.push({ type: "heading", page: 1, readingOrder: 0, method: "native", confidence: 1, level: h[1].length, text: h[2].trim() });
		} else {
			out.push({ type: "paragraph", page: 1, readingOrder: 0, method: "native", confidence: 1, text: t });
		}
	}
	return out;
}

export function parseHtml(html: string): Block[] {
	const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
	return text ? [{ type: "paragraph", page: 1, readingOrder: 0, method: "native", confidence: 1, text }] : [];
}
