<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
import CardHandles from './CardHandles.svelte';
	import { flow } from './store.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import type { FileData } from './store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { getFileBlob } from '$lib/files';

	let { id, data, selected }: NodeProps = $props();
	const isSelected = $derived(flow.selected === id || selected);
	const file = $derived(data as FileData);
	const blob = $derived(getFileBlob(id));
	const label = $derived(
		file.status === 'indexing' ? 'Indexing…' : file.status === 'ready' ? 'Indexed' : 'Failed'
	);
	const icon = $derived(
		({ pdf: '📕', markdown: '📝', text: '📄', docx: '📘', image: '🖼️', other: '📄' } as const)[
			file.kind
		] ?? '📄'
	);

	// Preview body: markdown → rendered, docx → raw HTML (mammoth), text/pdf → plain.
	const previewHtml = $derived(
		file.kind === 'markdown' && file.preview
			? renderMarkdown(file.preview)
			: file.kind === 'docx'
				? file.preview ?? ''
				: ''
	);

	const imgSrc = $derived(
		file.kind === 'image' && blob
			? URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime }))
			: null
	);

	let pdfThumbCanvas = $state<HTMLCanvasElement | null>(null);

	$effect(() => {
		if (file.kind !== 'pdf' || !blob || !pdfThumbCanvas) return;
		const canvas = pdfThumbCanvas;
		const bytes = blob.bytes;
		(async () => {
			try {
				const pdfjs = await import('pdfjs-dist');
				pdfjs.GlobalWorkerOptions.workerSrc = (
					await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
				).default;
				const doc = await pdfjs.getDocument({ data: (bytes as ArrayBuffer).slice(0) }).promise;
				const page = await doc.getPage(1);
				const viewport = page.getViewport({ scale: 0.4 });
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
			} catch { /* silent — no bytes yet */ }
		})();
	});

	function select() {
		flow.selected = id;
	}

	function open() {
		window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
	}
</script>

<NodeResizer minWidth={180} minHeight={160} isVisible={isSelected} />
<CardHandles />
<div
	class="file"
	class:selected={isSelected}
	style="background: var(--block-{file.block})"
	onclick={select}
	ondblclick={open}
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 480, start: 0.6, opacity: 0, easing: backOut }}
>
	<!-- preview fills entire card -->
	<div class="preview">
		{#if imgSrc}
			<img src={imgSrc} alt={file.filename} class="fill" />
		{:else if file.kind === 'image'}
			<div class="center-icon">{icon}</div>
		{:else if file.kind === 'pdf' && blob}
			<canvas bind:this={pdfThumbCanvas} class="pdf-fill"></canvas>
		{:else if previewHtml}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="doc">{@html previewHtml}</div>
		{:else if file.preview}
			<pre class="doc">{file.preview}</pre>
		{:else}
			<div class="center-icon">{icon}</div>
		{/if}
	</div>

	<!-- filename + status overlay bar at bottom -->
	<div class="info-bar">
		<span class="bar-icon">{icon}</span>
		<span class="bar-name" title={file.filename}>{file.filename}</span>
		<span class="bar-status" class:busy={file.status === 'indexing'} class:err={file.status === 'error'}>
			{label}
		</span>
	</div>
</div>

<style>
	.file {
		width: 220px;
		min-height: 160px;
		max-height: 400px;
		position: relative;
		border-radius: var(--r-lg);
		border: 1px solid rgba(0, 0, 0, 0.06);
		overflow: hidden;
		cursor: pointer;
	}
	.file.selected {
		box-shadow: 0 0 0 2px var(--c-ink);
	}

	/* Preview fills the entire card */
	.preview {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background: var(--block-gray, #f0f0f0);
	}
	.fill {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	/* Canvas: full width, natural height — overflow clips the bottom (top of page stays visible) */
	.pdf-fill {
		display: block;
		width: 100%;
		height: auto;
	}
	.doc {
		padding: 10px 12px 48px;
		font-size: 10px;
		line-height: 1.45;
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: rgba(0, 0, 0, 0.72);
		mask-image: linear-gradient(to bottom, #000 55%, transparent 85%);
	}
	.center-icon {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 52px;
		opacity: 0.35;
		padding-bottom: 36px; /* shift up to account for info-bar */
	}

	/* Bottom overlay */
	.info-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 8px 10px 8px;
		background: linear-gradient(to top, rgba(0, 0, 0, 0.62) 0%, rgba(0, 0, 0, 0.28) 60%, transparent 100%);
		color: #fff;
		min-height: 36px;
		box-sizing: border-box;
	}
	.bar-icon {
		font-size: 13px;
		flex: none;
		filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4));
	}
	.bar-name {
		flex: 1;
		font-size: 11px;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-shadow: 0 1px 3px rgba(0,0,0,0.5);
	}
	.bar-status {
		font-size: 9px;
		font-family: var(--font-mono);
		opacity: 0.8;
		flex: none;
		text-shadow: 0 1px 2px rgba(0,0,0,0.4);
	}
	.bar-status.busy::after {
		content: '';
		animation: dots 1.2s steps(4, end) infinite;
	}
	.bar-status.err {
		color: #ff8a80;
		opacity: 1;
	}
	@keyframes dots {
		0%   { content: ''; }
		33%  { content: '.'; }
		66%  { content: '..'; }
		100% { content: '...'; }
	}
</style>
