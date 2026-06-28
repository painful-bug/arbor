<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';

	let { data, selected }: NodeProps = $props();
	const block = $derived((data as { block: string }).block ?? 'lilac');
</script>

<div class="group" style="background: var(--block-{block})">
</div>
<NodeResizer isVisible={selected} minWidth={200} minHeight={200} />

<style>
	.group {
		width: 100%;
		height: 100%;
		border-radius: 16px;
		border: 2px dashed rgba(0, 0, 0, 0.15);
		opacity: 0.4;
		pointer-events: all;
	}
</style>
