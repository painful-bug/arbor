// Render model answers (markdown) to sanitized HTML for cards + side panel.
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import katex from 'katex';
import 'katex/dist/katex.min.css';

marked.setOptions({ breaks: true, gfm: true });

function renderLatex(src: string): string {
	// Block: $$...$$ and \[...\]
	src = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => {
		try { return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false }); }
		catch { return `$$${m}$$`; }
	});
	src = src.replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => {
		try { return katex.renderToString(m.trim(), { displayMode: true, throwOnError: false }); }
		catch { return `\\[${m}\\]`; }
	});
	// Inline: $...$ and \(...\)
	src = src.replace(/\$([^\n$]+?)\$/g, (_, m) => {
		try { return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false }); }
		catch { return `$${m}$`; }
	});
	src = src.replace(/\\\((.+?)\\\)/gs, (_, m) => {
		try { return katex.renderToString(m.trim(), { displayMode: false, throwOnError: false }); }
		catch { return `\\(${m}\\)`; }
	});
	return src;
}

export function renderMarkdown(src: string): string {
	const withLatex = renderLatex(src ?? '');
	const html = marked.parse(withLatex, { async: false }) as string;
	// ADD_ATTR: style needed for KaTeX's sizing spans
	return DOMPurify.sanitize(html, { ADD_ATTR: ['style'] });
}
