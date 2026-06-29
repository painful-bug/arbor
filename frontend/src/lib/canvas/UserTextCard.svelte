<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
import CardHandles from './CardHandles.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { flow } from './store.svelte';
	import type { TextData } from './store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	let { id, data, selected: nativeSelected }: NodeProps = $props();
	const card = $derived(data as TextData);
	const selected = $derived(flow.selected === id || !!nativeSelected);
	const html = $derived(renderMarkdown(card.text ?? ''));
	const isEmpty = $derived(!card.text?.trim());

	function onClick() {
		flow.selected = id;
	}

	function onDblClick(e: MouseEvent) {
		e.stopPropagation();
		window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
	}

	function openEditor(e: MouseEvent) {
		e.stopPropagation();
		window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
	}
</script>

<div
	class="card"
	class:selected
	data-card-id={id}
	style="background: var(--block-{card.block})"
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 480, start: 0.6, opacity: 0, easing: backOut }}
	onclick={onClick}
	ondblclick={onDblClick}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && (flow.selected = id)}
>
	<NodeResizer minWidth={200} minHeight={60} isVisible={selected} />
	<CardHandles corners />

	<div class="header">
		<span class="label">Note</span>
		<button class="edit-btn" onclick={openEditor} title="Edit in side panel">Edit</button>
	</div>

	<div class="body nodrag nowheel">
		{#if isEmpty}
			<span class="placeholder">Empty note -- click Edit or double-click to open</span>
		{:else}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html html}
		{/if}
	</div>
</div>

<style>
	.card {
		width: 100%;
		min-height: 60px;
		max-height: 420px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--r-lg);
		padding: var(--s-sm) var(--s-md) var(--s-md);
		border: 1px solid rgba(0, 0, 0, 0.06);
		cursor: pointer;
		box-sizing: border-box;
		transition:
			transform var(--ease-glass),
			box-shadow var(--ease-glass);
	}
	.card:hover {
		transform: translateY(-2px);
		box-shadow: var(--elev-2);
	}
	.card.selected {
		box-shadow: 0 0 0 2px var(--c-ink);
	}
	.header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s-xs);
	}
	.label {
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		opacity: 0.45;
	}
	.edit-btn {
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		border: 1px solid rgba(0, 0, 0, 0.15);
		border-radius: var(--r-pill, 999px);
		background: rgba(255, 255, 255, 0.6);
		cursor: pointer;
		opacity: 0;
		transition: opacity 0.15s;
		color: var(--c-ink);
	}
	.card:hover .edit-btn,
	.card.selected .edit-btn {
		opacity: 1;
	}
	.nodrag {
		user-select: text;
		cursor: text;
	}
	.body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		font-size: 13px;
		line-height: 1.5;
		color: rgba(0, 0, 0, 0.82);
	}
	.body :global(p) { margin: 0 0 0.4em; }
	.body :global(h1),
	.body :global(h2),
	.body :global(h3) { margin: 0.5em 0 0.25em; font-size: 1em; }
	.body :global(ul),
	.body :global(ol) { margin: 0 0 0.4em; padding-left: 1.4em; }
	.body :global(pre) { overflow-x: auto; font-size: 11px; }
	.body :global(code) { font-size: 11px; background: rgba(0,0,0,0.06); border-radius: 3px; padding: 0 3px; }
	.placeholder {
		font-size: 12px;
		color: rgba(0, 0, 0, 0.35);
		font-style: italic;
		cursor: default;
	}
</style>
