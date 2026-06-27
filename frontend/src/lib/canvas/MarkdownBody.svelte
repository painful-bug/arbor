<script lang="ts">
	import { renderMarkdown } from '$lib/markdown';
	import { applyTextHL } from './highlights';

	let {
		text,
		highlights = $bindable<string[]>([]),
		onhighlight
	}: {
		text: string;
		highlights?: string[];
		onhighlight?: (updated: string[]) => void;
	} = $props();

	let bodyEl = $state<HTMLDivElement>();
	const html = $derived(renderMarkdown(text));

	$effect(() => {
		if (bodyEl) bodyEl.innerHTML = applyTextHL(html, highlights);
	});

	function onMouseUp() {
		if (!onhighlight) return;
		const sel = window.getSelection();
		const selected = sel?.toString().trim();
		if (!selected || !sel) return;
		const range = sel.getRangeAt(0);
		if (!bodyEl?.contains(range.commonAncestorContainer)) return;
		const updated = [...new Set([...highlights, selected])];
		highlights = updated;
		sel.removeAllRanges();
		if (bodyEl) bodyEl.innerHTML = applyTextHL(html, highlights);
		onhighlight(updated);
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="body" bind:this={bodyEl} onmouseup={onMouseUp}></div>

<style>
	.body {
		flex: 1;
		overflow-y: auto;
		padding: var(--s-lg) var(--s-xl);
		font-size: 15px;
		line-height: 1.6;
		user-select: text;
		cursor: text;
	}
	.body :global(p) { margin: 0 0 0.6em; }
	.body :global(h1) { font-size: 1.4em; margin: 0.6em 0 0.3em; }
	.body :global(h2) { font-size: 1.2em; margin: 0.6em 0 0.3em; }
	.body :global(h3) { font-size: 1.05em; margin: 0.5em 0 0.25em; }
	.body :global(ul),
	.body :global(ol) { margin: 0 0 0.6em; padding-left: 1.6em; }
	.body :global(pre) { overflow-x: auto; font-size: 13px; background: rgba(0, 0, 0, 0.06); border-radius: 6px; padding: var(--s-sm); }
	.body :global(code) { font-size: 12px; background: rgba(0, 0, 0, 0.06); border-radius: 3px; padding: 0 4px; }
	.body :global(mark) { background: rgba(255, 222, 89, 0.65); border-radius: 2px; }
	.body :global(blockquote) { border-left: 3px solid rgba(0, 0, 0, 0.2); margin: 0 0 0.6em; padding-left: 1em; color: rgba(0, 0, 0, 0.6); }
</style>
