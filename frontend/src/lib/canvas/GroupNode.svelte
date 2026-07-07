<script lang="ts">
	import { tick } from 'svelte';
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
	import { setGroupLabel } from './store.svelte';

	let { id, data, selected }: NodeProps = $props();
	const block = $derived((data as { block: string }).block ?? 'lilac');
	const label = $derived((data as { label?: string }).label);
	const isCleanup = $derived((data as { cleanup?: boolean }).cleanup);

	let editing = $state(false);
	let el: HTMLInputElement | undefined = $state();

	async function startEdit() {
		editing = true;
		await tick();
		el?.focus();
		el?.select();
	}
	function commit() {
		editing = false;
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'Escape') el?.blur();
	}

	// Triggered by the "Rename label" context-menu item (Canvas.svelte onCtxSelect).
	function onRenameEvent(e: Event) {
		if ((e as CustomEvent).detail?.nodeId !== id) return;
		void startEdit();
	}
	$effect(() => {
		window.addEventListener('arbor:rename', onRenameEvent);
		return () => window.removeEventListener('arbor:rename', onRenameEvent);
	});
</script>

<div class="group" style="background: var(--block-{block})" role="presentation">
	{#if editing}
		<input
			bind:this={el}
			class="cluster-label-input nodrag"
			value={label ?? ''}
			oninput={(e) => setGroupLabel(id, (e.currentTarget as HTMLInputElement).value)}
			onblur={commit}
			onkeydown={onKey}
			aria-label="Group label"
		/>
	{:else if label}
		<span
			class="cluster-label"
			role="button"
			tabindex="0"
			ondblclick={startEdit}
			onkeydown={(e) => e.key === 'Enter' && startEdit()}
		>
			{label}
		</span>
	{/if}
</div>
{#if !isCleanup}
	<NodeResizer isVisible={selected} minWidth={200} minHeight={200} />
{/if}

<style>
	.group {
		width: 100%;
		height: 100%;
		border-radius: 16px;
		opacity: 0.4;
		pointer-events: all;
		position: relative;
	}
	.cluster-label {
		position: absolute;
		top: 8px;
		left: 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: rgba(var(--ink-rgb), 0.45);
		pointer-events: all;
		cursor: default;
		outline: none;
	}
	.cluster-label-input {
		position: absolute;
		top: 8px;
		left: 12px;
		font-size: 11px;
		font-weight: 600;
		letter-spacing: 0.4px;
		text-transform: uppercase;
		color: rgba(var(--ink-rgb), 0.7);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.12));
		border-radius: var(--r-sm, 6px);
		padding: 1px 6px;
		outline: none;
		pointer-events: all;
	}
</style>
