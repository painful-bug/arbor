// Render model answers (markdown) to sanitized HTML for cards + side panel.

import DOMPurify from "dompurify";
import katex from "katex";
import { marked } from "marked";
import "katex/dist/katex.min.css";

marked.setOptions({ breaks: true, gfm: true });

function renderLatex(src: string): string {
	// Block: $$...$$ and \[...\]
	src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
		try {
			return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false });
		} catch {
			return `$$${m}$$`;
		}
	});
	src = src.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
		try {
			return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false });
		} catch {
			return `\\[${m}\\]`;
		}
	});
	// Inline: $...$ and \(...\)
	src = src.replace(/\$([^\n$]+?)\$/g, (_, m) => {
		try {
			return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false });
		} catch {
			return `$${m}$`;
		}
	});
	src = src.replace(/\\\((.+?)\\\)/gs, (_, m) => {
		try {
			return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false });
		} catch {
			return `\\(${m}\\)`;
		}
	});
	return src;
}

// Memo cache: the same source string always renders to the same HTML, so a card
// that re-mounts (viewport culling, undo, canvas switch) or re-renders shouldn't
// re-run marked + DOMPurify (+ KaTeX). Bounded, oldest-evicted. This makes node
// mounting cheap, which is what keeps pan/zoom smooth on large canvases.
const CACHE_MAX = 400;
const cache = new Map<string, string>();

export function renderMarkdown(src: string): string {
	const raw = src ?? "";
	const hit = cache.get(raw);
	if (hit !== undefined) {
		// Refresh recency: re-insert so it's the newest (Map preserves insertion order).
		cache.delete(raw);
		cache.set(raw, hit);
		return hit;
	}
	// Fast path: no $ or \ anywhere → skip the four LaTeX regex passes.
	const withLatex = /[$\\]/.test(raw) ? renderLatex(raw) : raw;
	const html = marked.parse(withLatex, { async: false }) as string;
	// ADD_ATTR: style needed for KaTeX's sizing spans
	const clean = DOMPurify.sanitize(html, { ADD_ATTR: ["style"] });
	cache.set(raw, clean);
	if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
	return clean;
}
