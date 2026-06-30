<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { setTagText, deleteNodes, type TagData } from './store.svelte';

	let { id, data }: NodeProps = $props();
	const tag = $derived(data as TagData);
	let el: HTMLInputElement | undefined = $state();

	function onInput(e: Event) {
		setTagText(id, (e.currentTarget as HTMLInputElement).value);
	}
	// Empty on blur → the tag was never named, so drop it (keeps the canvas tidy).
	function onBlur() {
		if (!tag.text?.trim()) deleteNodes([id]);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'Escape') el?.blur();
	}
</script>

<div class="tag nodrag nowheel">
	<span class="hash">#</span>
	<input
		bind:this={el}
		class="tag-input"
		value={tag.text ?? ''}
		placeholder="cluster…"
		style="width: {Math.max(6, (tag.text?.length ?? 0) + 1)}ch"
		oninput={onInput}
		onblur={onBlur}
		onkeydown={onKey}
		aria-label="Cluster tag"
	/>
</div>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 3px 10px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.12));
		box-shadow: var(--elev-1, 0 2px 8px rgba(0, 0, 0, 0.1));
		font-size: 12px;
		font-weight: 600;
		white-space: nowrap;
		cursor: text;
	}
	.hash {
		opacity: 0.4;
		font-weight: 700;
	}
	.tag-input {
		border: none;
		background: transparent;
		outline: none;
		font: inherit;
		color: var(--c-ink);
		min-width: 6ch;
		padding: 0;
	}
	.tag-input::placeholder {
		opacity: 0.4;
		font-weight: 500;
	}
</style>
