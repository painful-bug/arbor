<script lang="ts">
	import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { flow, lastTurn, renameCard } from './store.svelte';
	import type { CardData } from './store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { openExternal } from '$lib/web';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import AgentTimeline from './AgentTimeline.svelte';

	let { id, data }: NodeProps = $props();
	const card = $derived(data as CardData);
	const selected = $derived(flow.selected === id);
	const turn = $derived(lastTurn(card)); // card face shows the latest exchange
	const answerHtml = $derived(renderMarkdown(turn?.answer ?? ''));
	const moreTurns = $derived((card.turns?.length ?? 0) - 1); // earlier turns hidden on the face

	// Branch trigger: right-click an image inside this card. (Text-highlight branching
	// is handled globally in Canvas via a data-card-id host + document mouseup.)
	function onBranch(detail: { x: number; y: number; quote: string }) {
		window.dispatchEvent(new CustomEvent('loom:branch', { detail: { parentId: id, ...detail } }));
	}

	// Click a link in the answer → embed it as a web card next to this one (default),
	// or Cmd/Ctrl-click → open externally. Delegated from the answer container.
	function onAnswerClick(e: MouseEvent) {
		const a = (e.target as HTMLElement)?.closest('a');
		if (!a) return;
		const href = (a as HTMLAnchorElement).href;
		if (!/^https?:/.test(href)) return;
		e.preventDefault();
		e.stopPropagation();
		if (e.metaKey || e.ctrlKey) {
			openExternal(href);
		} else {
			window.dispatchEvent(new CustomEvent('loom:weburl', { detail: { url: href, parentId: id } }));
		}
	}

	function onContextMenu(e: MouseEvent) {
		const t = e.target as HTMLElement;
		if (t.tagName !== 'IMG') return;
		e.preventDefault();
		const src = (t as HTMLImageElement).src;
		onBranch({ x: e.clientX, y: e.clientY, quote: `image: ${src}` });
	}

	// Inline title rename.
	let renaming = $state(false);
	let titleDraft = $state('');
	let titleInput = $state<HTMLInputElement>();

	$effect(() => {
		if (renaming && titleInput) titleInput.focus();
	});

	function startRename(e: MouseEvent) {
		e.stopPropagation();
		renaming = true;
		titleDraft = card.title;
	}

	function commitRename() {
		renaming = false;
		if (titleDraft.trim() && titleDraft.trim() !== card.title) renameCard(id, titleDraft);
	}

	// Single-click → select; double-click → expand modal.
	function onClick() {
		flow.selected = id;
	}

	function onDblClick(e: MouseEvent) {
		e.stopPropagation();
		window.dispatchEvent(new CustomEvent('loom:expand', { detail: { cardId: id } }));
	}
</script>

<!-- Bouncy spring entrance (Liquid Glass motion); disabled under reduced-motion via tokens.css -->
<div
	class="card"
	class:selected
	data-card-id={id}
	style="background: var(--block-{card.block})"
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 480, start: 0.6, opacity: 0, easing: backOut }}
	onclick={onClick}
	ondblclick={onDblClick}
	oncontextmenu={onContextMenu}
	onmousedown={(e) => { if ((e.target as HTMLElement).closest('.nodrag')) e.stopPropagation(); }}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && (flow.selected = id)}
>
	<NodeResizer minWidth={280} minHeight={80} isVisible={selected} />
	<!-- Side handles (center of each edge) -->
	<Handle type="source" position={Position.Top} id="top-s" />
	<Handle type="target" position={Position.Top} id="top-t" />
	<Handle type="source" position={Position.Right} id="right-s" />
	<Handle type="target" position={Position.Right} id="right-t" />
	<Handle type="source" position={Position.Bottom} id="bottom-s" />
	<Handle type="target" position={Position.Bottom} id="bottom-t" />
	<Handle type="source" position={Position.Left} id="left-s" />
	<Handle type="target" position={Position.Left} id="left-t" />
	<!-- Corner handles -->
	<Handle type="source" position={Position.Top} id="tl-s" style="left: 0%" />
	<Handle type="target" position={Position.Top} id="tl-t" style="left: 0%" />
	<Handle type="source" position={Position.Top} id="tr-s" style="left: 100%" />
	<Handle type="target" position={Position.Top} id="tr-t" style="left: 100%" />
	<Handle type="source" position={Position.Bottom} id="bl-s" style="left: 0%" />
	<Handle type="target" position={Position.Bottom} id="bl-t" style="left: 0%" />
	<Handle type="source" position={Position.Bottom} id="br-s" style="left: 100%" />
	<Handle type="target" position={Position.Bottom} id="br-t" style="left: 100%" />
	{#if card.quote}
		<p class="quote nodrag">{card.quote}</p>
	{/if}
	{#if renaming}
		<input
			class="title-input nodrag"
			bind:value={titleDraft}
			bind:this={titleInput}
			onblur={commitRename}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') renaming = false; }}
			onclick={(e) => e.stopPropagation()}
		/>
	{:else}
		<p class="prompt nodrag" ondblclick={startRename}>{card.title}</p>
	{/if}
	{#if moreTurns > 0}
		<p class="more">+{moreTurns} earlier {moreTurns === 1 ? 'reply' : 'replies'} · click to expand</p>
	{/if}
	<AgentTimeline events={turn?.events ?? []} streaming={card.streaming} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="answer nodrag nowheel" onclick={onAnswerClick}>
		{@html answerHtml}{#if card.streaming}<span class="caret"></span>{/if}
	</div>
</div>

<style>
	.card {
		width: 100%;
		min-height: 80px;
		max-height: 480px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--r-lg);
		padding: var(--s-md);
		border: 1px solid rgba(0, 0, 0, 0.06);
		cursor: pointer;
		box-sizing: border-box;
		transition:
			transform var(--ease-glass),
			box-shadow var(--ease-glass);
	}
	/* Connection handles: hidden by default, revealed on hover/select/connect */
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
	.card:hover {
		transform: translateY(-2px);
		box-shadow: var(--elev-2);
	}
	.card.selected {
		box-shadow: 0 0 0 2px var(--c-ink);
	}
	/* nodrag elements: let the user select text (to branch) instead of dragging the node */
	/* -webkit- prefix needed: base.css sets -webkit-user-select:none on .svelte-flow__node,
	   no autoprefixer in this project, so unprefixed override alone doesn't win in WKWebView */
	.nodrag {
		-webkit-user-select: text;
		user-select: text;
		cursor: text;
	}
	.quote {
		margin: 0 0 var(--s-xs);
		padding-left: var(--s-xs);
		border-left: 3px solid rgba(0, 0, 0, 0.25);
		font-size: 12px;
		font-style: italic;
		color: rgba(0, 0, 0, 0.6);
	}
	.prompt {
		margin: 0 0 var(--s-xs);
		font-weight: 600;
		font-size: 15px;
		line-height: 1.35;
	}
	.more {
		margin: 0 0 var(--s-xs);
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(0, 0, 0, 0.4);
	}
	.answer {
		margin: 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		font-size: 13px;
		line-height: 1.45;
		color: rgba(0, 0, 0, 0.78);
	}
	.title-input {
		margin: 0 0 var(--s-xs);
		font-weight: 600;
		font-size: 15px;
		line-height: 1.35;
		font-family: var(--font-sans);
		border: none;
		outline: 2px solid var(--c-primary, #6366f1);
		border-radius: 4px;
		background: transparent;
		width: 100%;
		padding: 1px 4px;
		color: var(--c-ink);
		box-sizing: border-box;
	}
	.answer :global(p) {
		margin: 0 0 0.4em;
	}
	.answer :global(img) {
		max-width: 100%;
		border-radius: var(--r-sm);
		cursor: context-menu;
	}
	.answer :global(pre) {
		overflow-x: auto;
		font-size: 11px;
	}
	.caret {
		display: inline-block;
		width: 7px;
		height: 14px;
		margin-left: 1px;
		vertical-align: text-bottom;
		background: var(--c-ink);
		animation: blink 1s steps(2, start) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
</style>
