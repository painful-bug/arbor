<script lang="ts">
	import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/svelte';
	import { flow } from './store.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import type { FileData } from './store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { renderMarkdown } from '$lib/markdown';

	let { id, data, selected }: NodeProps = $props();
	const isSelected = $derived(flow.selected === id || selected);
	const file = $derived(data as FileData);
	const label = $derived(
		file.status === 'indexing' ? 'Indexing…' : file.status === 'ready' ? 'Indexed' : 'Failed'
	);
	const icon = $derived(
		({ pdf: '📕', markdown: '📝', text: '📄', docx: '📘', image: '🖼️', other: '📄' } as const)[
			file.kind
		] ?? '📄'
	);

	// Preview body: markdown → rendered, docx → raw HTML (mammoth), text → plain.
	const previewHtml = $derived(
		file.kind === 'markdown' && file.preview
			? renderMarkdown(file.preview)
			: file.kind === 'docx'
				? file.preview ?? ''
				: ''
	);

	function open() {
		window.dispatchEvent(new CustomEvent('loom:openfile', { detail: { fileId: id } }));
	}
</script>

<NodeResizer minWidth={180} minHeight={160} isVisible={isSelected} />
<!-- Side handles — same IDs as CardNode so onNodeDragStop can remap them correctly -->
<Handle type="source" position={Position.Top} id="top-s" />
<Handle type="target" position={Position.Top} id="top-t" />
<Handle type="source" position={Position.Right} id="right-s" />
<Handle type="target" position={Position.Right} id="right-t" />
<Handle type="source" position={Position.Bottom} id="bottom-s" />
<Handle type="target" position={Position.Bottom} id="bottom-t" />
<Handle type="source" position={Position.Left} id="left-s" />
<Handle type="target" position={Position.Left} id="left-t" />
<!-- Fluid drop entrance; click to open in the side-split editor/viewer. -->
<div
	class="file"
	class:selected={isSelected}
	style="background: var(--block-{file.block})"
	role="button"
	tabindex="0"
	onclick={open}
	onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && open()}
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 480, start: 0.6, opacity: 0, easing: backOut }}
>
	<header>
		<span class="icon">{icon}</span>
		<p class="name" title={file.filename}>{file.filename}</p>
	</header>

	<div class="preview">
		{#if file.kind === 'image'}
			<div class="img-poster">{icon}</div>
		{:else if previewHtml}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="doc">{@html previewHtml}</div>
		{:else if file.kind === 'text' && file.preview}
			<pre>{file.preview}</pre>
		{:else}
			<div class="big-icon">{icon}</div>
		{/if}
	</div>

	<footer>
		<span class="status" class:busy={file.status === 'indexing'} class:err={file.status === 'error'}>
			{label}
		</span>
		<span class="open">Open ↗</span>
	</footer>
</div>

<style>
	.file {
		width: 220px;
		min-height: 120px;
		max-height: 400px;
		display: flex;
		flex-direction: column;
		border-radius: var(--r-lg);
		border: 1px solid rgba(0, 0, 0, 0.06);
		overflow: hidden;
		cursor: pointer;
		text-align: left;
	}
	.file.selected {
		box-shadow: 0 0 0 2px var(--c-ink);
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--s-xs);
		padding: var(--s-sm) var(--s-md);
		border-bottom: 1px solid rgba(0, 0, 0, 0.06);
	}
	.icon {
		font-size: 18px;
		flex: none;
	}
	.name {
		margin: 0;
		font-weight: 600;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.preview {
		flex: 1;
		overflow: hidden;
		padding: var(--s-sm) var(--s-md);
		position: relative;
		mask-image: linear-gradient(to bottom, #000 70%, transparent);
	}
	.doc,
	pre {
		font-size: 11px;
		line-height: 1.4;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: rgba(0, 0, 0, 0.7);
	}
	.big-icon,
	.img-poster {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100%;
		font-size: 48px;
		opacity: 0.5;
	}
	footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px var(--s-md);
		border-top: 1px solid rgba(0, 0, 0, 0.06);
		font-family: var(--font-mono);
		font-size: 10px;
	}
	.status {
		color: rgba(0, 0, 0, 0.5);
	}
	.status.busy::after {
		content: '';
		animation: dots 1.2s steps(4, end) infinite;
	}
	.status.err {
		color: var(--c-danger, #c0392b);
	}
	.open {
		opacity: 0.6;
	}
	@keyframes dots {
		0% {
			content: '';
		}
		33% {
			content: '.';
		}
		66% {
			content: '..';
		}
		100% {
			content: '...';
		}
	}
</style>
