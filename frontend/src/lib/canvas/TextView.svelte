<script lang="ts">
	// Read-only modal for UserTextCard double-click.
	// Shows rendered markdown + a text highlighter (localStorage-persisted).
	// Edit button closes modal and opens the side editor.
	import { onMount } from 'svelte';
	import { flow } from './store.svelte';
	import type { TextData } from './store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import FindBar from './FindBar.svelte';

	let { cardId, onclose }: { cardId: string; onclose: () => void } = $props();

	const node = $derived(flow.nodes.find((n) => n.id === cardId));
	const card = $derived(node?.data as TextData | undefined);
	const html = $derived(renderMarkdown(card?.text ?? ''));

	// Highlights: array of selected strings, re-applied by wrapping first match in <mark>.
	// ponytail: string-match highlight; switch to Range/offset anchoring if it needs to survive edits.
	const hlKey = $derived(`loom.highlights.${cardId}`);
	let highlights = $state<string[]>([]);
	let bodyEl = $state<HTMLDivElement>();

	$effect(() => {
		// Load persisted highlights when hlKey is ready.
		try { highlights = JSON.parse(localStorage.getItem(hlKey) || '[]'); } catch { highlights = []; }
	});

	function saveHL() {
		try { localStorage.setItem(hlKey, JSON.stringify(highlights)); } catch { /* ignore */ }
	}

	function applyHighlights(el: HTMLDivElement) {
		// Re-wrap stored strings in <mark> by modifying innerHTML.
		let src = html;
		for (const hl of highlights) {
			if (!hl) continue;
			const escaped = hl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			src = src.replace(new RegExp(escaped, 'g'), `<mark>${hl}</mark>`);
		}
		el.innerHTML = src;
	}

	$effect(() => {
		if (bodyEl) applyHighlights(bodyEl);
	});

	function onMouseUp() {
		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!text || !sel) return;
		// Only highlight if selection is inside our modal body.
		const range = sel.getRangeAt(0);
		if (!bodyEl?.contains(range.commonAncestorContainer)) return;
		highlights = [...new Set([...highlights, text])];
		saveHL();
		sel.removeAllRanges();
		if (bodyEl) applyHighlights(bodyEl);
	}

	function clearHighlights() {
		highlights = [];
		saveHL();
		if (bodyEl) applyHighlights(bodyEl);
	}

	function openEditor() {
		onclose();
		window.dispatchEvent(new CustomEvent('loom:openfile', { detail: { fileId: cardId } }));
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	onMount(() => {
		window.addEventListener('keydown', onKeydown);
		return () => window.removeEventListener('keydown', onKeydown);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="modal"
		style="background: var(--block-{card?.block ?? 'cream'})"
		onclick={(e) => e.stopPropagation()}
	>
		<FindBar target={bodyEl ?? null} />
		<header>
			<span class="title">{card?.text?.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Note'}</span>
			<div class="actions">
				{#if highlights.length}
					<button onclick={clearHighlights}>Clear marks</button>
				{/if}
				<button class="edit" onclick={openEditor}>Edit ✎</button>
				<button onclick={onclose} aria-label="Close">✕</button>
			</div>
		</header>
		<div class="hint">Select text to highlight</div>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="body"
			bind:this={bodyEl}
			onmouseup={onMouseUp}
		></div>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		background: rgba(0, 0, 0, 0.35);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--s-xl);
	}
	.modal {
		position: relative;
		width: min(780px, 90vw);
		max-height: 80vh;
		border-radius: var(--r-lg);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		box-shadow: var(--elev-3, 0 20px 60px rgba(0,0,0,0.25));
		border: 1px solid rgba(0,0,0,0.08);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-sm);
		padding: var(--s-md) var(--s-lg);
		border-bottom: 1px solid rgba(0,0,0,0.08);
		flex: none;
	}
	.title {
		font-weight: 600;
		font-size: 15px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.actions button {
		border: 1px solid rgba(0,0,0,0.15);
		background: rgba(255,255,255,0.55);
		border-radius: 8px;
		padding: 4px 10px;
		font-size: 12px;
		cursor: pointer;
		color: var(--c-ink);
	}
	.actions button.edit {
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
		border-color: transparent;
	}
	.hint {
		font-size: 11px;
		color: rgba(0,0,0,0.38);
		padding: 4px var(--s-lg) 0;
		flex: none;
	}
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
	.body :global(ul), .body :global(ol) { margin: 0 0 0.6em; padding-left: 1.6em; }
	.body :global(pre) { overflow-x: auto; font-size: 13px; background: rgba(0,0,0,0.06); border-radius: 6px; padding: var(--s-sm); }
	.body :global(code) { font-size: 12px; background: rgba(0,0,0,0.06); border-radius: 3px; padding: 0 4px; }
	.body :global(mark) { background: rgba(255, 222, 89, 0.65); border-radius: 2px; }
	.body :global(blockquote) { border-left: 3px solid rgba(0,0,0,0.2); margin: 0 0 0.6em; padding-left: 1em; color: rgba(0,0,0,0.6); }
</style>
