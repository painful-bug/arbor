<script lang="ts">
	import { Handle, Position } from '@xyflow/svelte';
	// corners: add 4 corner pairs in addition to the 4 side handles.
	// CardNode and UserTextCard use corners; FileCard and WebCard use side-only.
	let { corners = false }: { corners?: boolean } = $props();
</script>

<!-- Side handles (center of each edge) — IDs must match SIDE_HANDLE_RE in Canvas.svelte -->
<Handle type="source" position={Position.Top} id="top-s" />
<Handle type="target" position={Position.Top} id="top-t" />
<Handle type="source" position={Position.Right} id="right-s" />
<Handle type="target" position={Position.Right} id="right-t" />
<Handle type="source" position={Position.Bottom} id="bottom-s" />
<Handle type="target" position={Position.Bottom} id="bottom-t" />
<Handle type="source" position={Position.Left} id="left-s" />
<Handle type="target" position={Position.Left} id="left-t" />
{#if corners}
	<Handle type="source" position={Position.Top} id="tl-s" style="left: 0%" />
	<Handle type="target" position={Position.Top} id="tl-t" style="left: 0%" />
	<Handle type="source" position={Position.Top} id="tr-s" style="left: 100%" />
	<Handle type="target" position={Position.Top} id="tr-t" style="left: 100%" />
	<Handle type="source" position={Position.Bottom} id="bl-s" style="left: 0%" />
	<Handle type="target" position={Position.Bottom} id="bl-t" style="left: 0%" />
	<Handle type="source" position={Position.Bottom} id="br-s" style="left: 100%" />
	<Handle type="target" position={Position.Bottom} id="br-t" style="left: 100%" />
{/if}

<style>
	/* Connection handles: hidden by default, revealed on hover/select/connect.
	   Lives here (global) so all 4 card types share one declaration. */
	:global(.svelte-flow__handle) {
		opacity: 0;
		transition: opacity 0.15s;
		width: 10px;
		height: 10px;
	}
	:global(.svelte-flow__node:hover .svelte-flow__handle),
	:global(.svelte-flow__node.selected .svelte-flow__handle),
	:global(.svelte-flow__handle.svelte-flow__handle-valid),
	:global(.svelte-flow__handle.svelte-flow__handle-connecting) {
		opacity: 1;
	}
</style>
