<script lang="ts">
	// Bezier edge that glows when it touches the selected node. Props-driven
	// (not a DOM query against a separate $effect), so it can't race SvelteFlow's
	// own render cycle — the highlight is just as reactive as the edge itself.
	import { getBezierPath } from '@xyflow/system';
	import { BaseEdge, type EdgeProps } from '@xyflow/svelte';
	import { flow } from './store.svelte';

	let {
		source,
		target,
		interactionWidth,
		label,
		labelStyle,
		markerEnd,
		markerStart,
		sourcePosition,
		sourceX,
		sourceY,
		style,
		targetPosition,
		targetX,
		targetY
	}: EdgeProps = $props();

	const connected = $derived(
		!!flow.selected && (source === flow.selected || target === flow.selected)
	);

	const [path, labelX, labelY] = $derived(
		getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
	);
</script>

<BaseEdge
	{path}
	{labelX}
	{labelY}
	{label}
	{labelStyle}
	{markerStart}
	{markerEnd}
	{interactionWidth}
	{style}
	class={connected ? 'connected' : undefined}
/>
