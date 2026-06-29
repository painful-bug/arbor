<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps = $props();
	const block = $derived((data as { block: string }).block ?? 'lilac');
	const label = $derived((data as { label?: string }).label);
	const isCleanup = $derived((data as { cleanup?: boolean }).cleanup);
</script>

<div class="group" style="background: var(--block-{block})">
	{#if label}
		<span class="cluster-label">{label}</span>
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
		pointer-events: none;
		user-select: none;
	}
</style>
