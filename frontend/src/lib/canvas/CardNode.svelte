<script lang="ts">
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
import CardHandles from './CardHandles.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { flow, lastTurn, renameCard } from './store.svelte';
	import type { CardData } from './store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import { openExternal } from '$lib/web';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import AgentTimeline from './AgentTimeline.svelte';
	import { searchHighlight } from './globalSearch.svelte';
	import { markHTML } from './highlights';

	let { id, data, selected: nativeSelected }: NodeProps = $props();
	const card = $derived(data as CardData);
	const selected = $derived(flow.selected === id || !!nativeSelected);
	const turn = $derived(lastTurn(card)); // card face shows the latest exchange
	// Highlight title + answer body when this is the active global-search match. Thread
	// one running occurrence count title→answer (segmentsOf uses the same order) so the
	// focused word (searchHighlight.activeOrd) gets the contrast colour.
	const hlActive = $derived(searchHighlight.nodeId === id);
	const escapeHtml = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const hlParts = $derived.by(() => {
		if (!hlActive) return null;
		const titleRes = markHTML(escapeHtml(card.title ?? ''), searchHighlight.terms, {
			start: 0,
			active: searchHighlight.activeOrd
		});
		const answerRes = markHTML(renderMarkdown(turn?.answer ?? ''), searchHighlight.terms, {
			start: titleRes.next,
			active: searchHighlight.activeOrd
		});
		return { title: titleRes.html, answer: answerRes.html };
	});
	const answerHtml = $derived(hlParts ? hlParts.answer : renderMarkdown(turn?.answer ?? ''));
	const titleHtml = $derived(hlParts ? hlParts.title : '');
	const moreTurns = $derived((card.turns?.length ?? 0) - 1); // earlier turns hidden on the face

	// Scroll the focused occurrence into view within the scrollable answer body (the active
	// <mark> may sit below the fold). Body-only scroll — scrollIntoView would pan the canvas.
	let answerEl = $state<HTMLDivElement | null>(null);
	$effect(() => {
		if (!hlActive) return;
		searchHighlight.activeOrd; // re-run when the focused occurrence changes
		const body = answerEl;
		if (!body) return;
		requestAnimationFrame(() => {
			const mark = body.querySelector('mark.mark-active') as HTMLElement | null;
			if (!mark) return;
			const mr = mark.getBoundingClientRect();
			const br = body.getBoundingClientRect();
			const delta = mr.top - br.top - (body.clientHeight - mr.height) / 2;
			body.scrollTo({ top: body.scrollTop + delta, behavior: reducedMotion() ? 'auto' : 'smooth' });
		});
	});

	// Branch trigger: right-click an image inside this card. (Text-highlight branching
	// is handled globally in Canvas via a data-card-id host + document mouseup.)
	function onBranch(detail: { x: number; y: number; quote: string }) {
		window.dispatchEvent(new CustomEvent('arbor:branch', { detail: { parentId: id, ...detail } }));
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
			window.dispatchEvent(new CustomEvent('arbor:weburl', { detail: { url: href, parentId: id } }));
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
		window.dispatchEvent(new CustomEvent('arbor:expand', { detail: { cardId: id } }));
	}
</script>

<!-- Bouncy spring entrance (Liquid Glass motion); disabled under reduced-motion via tokens.css -->
<div
	class="card"
	class:node-glow-selected={selected}
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
	<CardHandles corners />
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
	{:else if hlActive}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<p class="prompt nodrag" ondblclick={startRename}>{@html titleHtml}</p>
	{:else}
		<p class="prompt nodrag" ondblclick={startRename}>{card.title}</p>
	{/if}
	{#if moreTurns > 0}
		<p class="more">+{moreTurns} earlier {moreTurns === 1 ? 'reply' : 'replies'} · click to expand</p>
	{/if}
	<AgentTimeline events={turn?.events ?? []} streaming={card.streaming} />
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div class="answer nodrag nowheel" bind:this={answerEl} onclick={onAnswerClick}>
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
		color: rgba(0, 0, 0, 0.85);
		--ink-rgb: 0, 0, 0;
		/* Block surfaces are always a light pastel (tokens.css), in both themes, so
		   content painted on them (caret, activity dot) must stay dark in both themes
		   too — override the theme's --c-ink instead of inheriting the white dark-mode one. */
		--c-ink: var(--c-on-block);
		color-scheme: light;
		transition:
			transform var(--ease-glass),
			box-shadow var(--ease-glass);
	}
	.card:hover {
		transform: translateY(-2px);
		box-shadow: var(--elev-2);
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
