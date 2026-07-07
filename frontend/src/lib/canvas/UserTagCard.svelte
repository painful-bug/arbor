<script lang="ts">
	import { tick } from 'svelte';
	import { type NodeProps, useViewport } from '@xyflow/svelte';
	import { setTagText, deleteNodes, type TagData } from './store.svelte';

	let { id, data }: NodeProps = $props();
	const tag = $derived(data as TagData);
	let editing = $state(false);
	let el: HTMLInputElement | undefined = $state();

	// Counter-scale the label so it holds a constant on-screen size at any zoom
	// (1/zoom cancels the viewport transform). Floor 1 = never shrink below natural
	// when zoomed in; ceiling 16 caps it at extreme fit-view zoom-outs.
	const viewport = useViewport();
	const labelScale = $derived(Math.min(16, Math.max(1, 1 / viewport.current.zoom)));

	async function startEdit() {
		editing = true;
		await tick();
		el?.focus();
		el?.select();
	}
	function onInput(e: Event) {
		setTagText(id, (e.currentTarget as HTMLInputElement).value);
	}
	function commit() {
		editing = false;
		// Empty on blur → drop it, but only for a hand-made tag that was never
		// named. Auto tags start empty while the name request is in flight —
		// deleting those would erase every cluster tag before it gets its name.
		if (!tag.text?.trim() && !tag.auto && !tag.pending) deleteNodes([id]);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'Escape') el?.blur();
	}

	// Triggered by the "Rename" context-menu item (Canvas.svelte onCtxSelect).
	function onRenameEvent(e: Event) {
		if ((e as CustomEvent).detail?.nodeId !== id) return;
		void startEdit();
	}
	$effect(() => {
		window.addEventListener('arbor:rename', onRenameEvent);
		return () => window.removeEventListener('arbor:rename', onRenameEvent);
	});
</script>

<div
	class="tag"
	style="--tag-accent: var(--block-{tag.color ?? 'lilac'}); transform: scale({labelScale}); transform-origin: center bottom;"
>
	<span class="hash">#</span>
	{#if editing}
		<input
			bind:this={el}
			class="tag-input nodrag"
			value={tag.text ?? ''}
			placeholder="cluster…"
			style="width: {Math.max(6, (tag.text?.length ?? 0) + 1)}ch"
			oninput={onInput}
			onblur={commit}
			onkeydown={onKey}
			aria-label="Cluster tag"
		/>
	{:else}
		<span
			class="tag-text"
			role="button"
			tabindex="0"
			ondblclick={startEdit}
			onkeydown={(e) => e.key === 'Enter' && startEdit()}
		>
			{tag.pending && !tag.text ? '…' : tag.text || 'cluster…'}
		</span>
	{/if}
</div>

<style>
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 3px 10px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--tag-accent, var(--c-hairline, rgba(0, 0, 0, 0.12)));
		box-shadow: var(--elev-1, 0 2px 8px rgba(0, 0, 0, 0.1));
		font-size: 14px;
		font-weight: 700;
		white-space: nowrap;
		will-change: transform;
	}
	.hash {
		opacity: 0.4;
		font-weight: 700;
	}
	.tag-text {
		cursor: default;
		outline: none;
	}
	.tag-input {
		border: none;
		background: transparent;
		outline: none;
		font: inherit;
		color: var(--c-ink);
		min-width: 6ch;
		padding: 0;
		cursor: text;
	}
	.tag-input::placeholder {
		opacity: 0.4;
		font-weight: 500;
	}
</style>
