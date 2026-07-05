<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
import CardHandles from './CardHandles.svelte';
	import { flow } from './store.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import type { FileData } from './store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { getThumb, hydrateThumb } from '$lib/files';
	import { searchHighlight } from './globalSearch.svelte';
	import { markHTML } from './highlights';
	import { animatedOnce } from './cards';
	import { isDocxFile, isImageFile, isMarkdownFile, isPdfFile } from './kinds';
	import { FileText, FileType, File as FileIcon, FileImage } from '@lucide/svelte';

	let { id, data, selected }: NodeProps = $props();
	const isSelected = $derived(flow.selected === id || selected);
	const file = $derived(data as FileData);
	// Card face paints a small cached thumbnail — never raw file bytes (see files.ts).
	const thumb = $derived(getThumb(id));
	// Entrance animation once per node per session: with viewport-culled rendering,
	// cards re-mount on every pan back into view — no re-bounce.
	// svelte-ignore state_referenced_locally -- mount-time check by design
	const animate = !reducedMotion() && !animatedOnce.has(id);
	// svelte-ignore state_referenced_locally
	animatedOnce.add(id);
	const label = $derived(
		file.status === 'indexing' ? 'Indexing…' : file.status === 'ready' ? 'Indexed' : 'Failed'
	);
	const Icon = $derived(
		({ pdf: FileText, markdown: FileType, text: FileIcon, docx: FileText, image: FileImage, other: FileIcon })[
			file.kind
		] ?? FileIcon
	);

	// Global-search highlight: <mark> the matched word in filename + preview when active,
	// threading the occurrence count filename→preview (segmentsOf order) so the focused
	// word (activeOrd) gets the contrast colour.
	const active = $derived(searchHighlight.nodeId === id);
	const escapeHtml = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const nameRes = $derived(
		active
			? markHTML(escapeHtml(file.filename ?? ''), searchHighlight.terms, {
					start: 0,
					active: searchHighlight.activeOrd
				})
			: null
	);
	const nameHtml = $derived(nameRes ? nameRes.html : escapeHtml(file.filename ?? ''));
	const hlPrev = (s: string) =>
		active
			? markHTML(s, searchHighlight.terms, { start: nameRes!.next, active: searchHighlight.activeOrd })
					.html
			: s;
	const plainPreviewHtml = $derived(hlPrev(escapeHtml(file.preview ?? '')));

	// Preview body: markdown → rendered, docx → raw HTML (mammoth), text/pdf → plain.
	const previewHtml = $derived(
		isMarkdownFile(file) && file.preview
			? hlPrev(renderMarkdown(file.preview))
			: isDocxFile(file)
				? hlPrev(file.preview ?? '')
				: ''
	);

	// Ensure a thumbnail exists (memory → backend cache → one-time generation).
	$effect(() => {
		if (isPdfFile(file) || isImageFile(file)) void hydrateThumb(id, file.kind);
	});

	function select() {
		flow.selected = id;
	}

	function open() {
		window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
	}

	// "Open mindmap" hover affordance — only when this file has a generated map.
	const hasMindmap = $derived(!!file.mindmapRootId);
	let hovered = $state(false);
	// ponytail: 90ms leave-intent delay so crossing the gap to the popup doesn't drop it.
	let leaveTimer: ReturnType<typeof setTimeout> | undefined;
	function enter() {
		clearTimeout(leaveTimer);
		hovered = true;
	}
	function leave() {
		leaveTimer = setTimeout(() => (hovered = false), 90);
	}

	function openMindmap() {
		window.dispatchEvent(new CustomEvent('arbor:focus-mindmap', { detail: { fileId: id } }));
	}

	// While the popup is up, Return jumps to the map (ignore when typing in a field).
	function onHoverKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		const t = e.target as HTMLElement | null;
		if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
		e.preventDefault();
		openMindmap();
	}
	$effect(() => {
		if (!(hovered && hasMindmap)) return;
		window.addEventListener('keydown', onHoverKey);
		return () => window.removeEventListener('keydown', onHoverKey);
	});
</script>

<NodeResizer minWidth={180} minHeight={160} isVisible={isSelected} />
<CardHandles />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="file-wrap" onmouseenter={enter} onmouseleave={leave}>
{#if hovered && hasMindmap}
	<button
		class="mm-pop glass"
		onclick={(e) => { e.stopPropagation(); openMindmap(); }}
		onpointerdown={(e) => e.stopPropagation()}
		onmouseenter={enter}
		onmouseleave={leave}
		in:scale={reducedMotion() ? { duration: 0 } : { duration: 420, start: 0.5, opacity: 0, easing: backOut }}
	>Open mindmap ↵</button>
{/if}
<div
	class="file"
	class:node-glow-selected={isSelected}
	style="background: var(--block-{file.block})"
	data-file-id={id}
	onclick={select}
	ondblclick={open}
	in:scale={animate ? { duration: 480, start: 0.6, opacity: 0, easing: backOut } : { duration: 0 }}
>
	<!-- preview fills entire card -->
	<div class="preview">
		{#if thumb && isImageFile(file)}
			<img src={thumb} alt={file.filename} class="fill" />
		{:else if thumb && isPdfFile(file)}
			<img src={thumb} alt={file.filename} class="pdf-fill" />
		{:else if isImageFile(file) || isPdfFile(file)}
			<div class="center-icon"><Icon size={44} strokeWidth={1.5} /></div>
		{:else if previewHtml}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<div class="doc">{@html previewHtml}</div>
		{:else if file.preview}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<pre class="doc">{@html plainPreviewHtml}</pre>
		{:else}
			<div class="center-icon"><Icon size={44} strokeWidth={1.5} /></div>
		{/if}
	</div>

	<!-- indexing progress bar — eases toward ~90% then vanishes when indexed -->
	{#if file.status === 'indexing'}
		<div class="progress"><div class="progress-fill"></div></div>
	{/if}

	<!-- filename + status overlay bar at bottom -->
	<div class="info-bar">
		<span class="bar-icon"><Icon size={13} /></span>
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<span class="bar-name" title={file.filename}>{@html nameHtml}</span>
		<span class="bar-status" class:busy={file.status === 'indexing'} class:err={file.status === 'error'}>
			{label}
		</span>
	</div>
</div>
</div>

<style>
	.file-wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}
	/* "Open mindmap" pill — floats above the card, same entrance as the Follow Up button. */
	.mm-pop {
		position: absolute;
		left: 50%;
		bottom: 100%;
		transform: translateX(-50%);
		margin-bottom: 8px;
		padding: 7px 14px;
		border-radius: var(--r-pill);
		border: none;
		font-family: var(--font-sans);
		font-size: 12px;
		font-weight: 500;
		color: var(--c-ink);
		white-space: nowrap;
		cursor: pointer;
		z-index: 30;
		transition: transform 180ms var(--ease-glass), opacity 180ms ease;
	}
	.mm-pop:hover {
		transform: translateX(-50%) translateY(-1px);
	}
	.mm-pop:active {
		transform: translateX(-50%) scale(0.93);
	}
	.file {
		width: 100%;
		min-height: 160px;
		max-height: 400px;
		position: relative;
		border-radius: var(--r-lg);
		border: 1px solid rgba(0, 0, 0, 0.06);
		overflow: hidden;
		cursor: pointer;
		/* See CardNode.svelte: isolate paint. (content-visibility trialled + removed.) */
		contain: layout paint;
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

	/* ponytail: estimated progress — real per-stage % needs backend SSE, but the
	   long pole (OCR/extract) is one opaque await, so an eased bar reads better.
	   Sits just above the info-bar; unmounts when status leaves 'indexing'. */
	.progress {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 36px;
		height: 3px;
		background: rgba(255, 255, 255, 0.25);
		z-index: 1;
	}
	.progress-fill {
		height: 100%;
		width: 8%;
		background: var(--c-ink, #2563eb);
		animation: index-progress 12s cubic-bezier(0.15, 0.85, 0.3, 1) forwards;
	}
	@keyframes index-progress {
		0%   { width: 8%; }
		100% { width: 90%; }
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
		/* Show the whole filename — wrap instead of truncating with an ellipsis. */
		white-space: normal;
		overflow-wrap: anywhere;
		word-break: break-word;
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
