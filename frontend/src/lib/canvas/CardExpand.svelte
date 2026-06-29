<script lang="ts">
	// Single-click expand: a large centered dialog with the card's full chat history and
	// a composer. Jelly/watery entrance (spring scale + border-radius blob morph). Click
	// the backdrop to collapse.
	import { fade } from 'svelte/transition';
	import { flow, continueCard } from './store.svelte';
	import type { CardData } from './store.svelte';
	import ThreadView from './ThreadView.svelte';
	import Composer from './Composer.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	let { cardId, onclose }: { cardId: string; onclose: () => void } = $props();

	const node = $derived(flow.nodes.find((n) => n.id === cardId));
	const card = $derived(node?.data as CardData | undefined);

	let composer = $state<ReturnType<typeof Composer>>();
	let bodyEl = $state<HTMLElement>();

	$effect(() => {
		if (!card?.streaming) composer?.focus();
	});

	// Auto-scroll to bottom while streaming so new content stays visible.
	$effect(() => {
		card?.turns; // track turn updates
		if (card?.streaming && bodyEl) bodyEl.scrollTop = bodyEl.scrollHeight;
	});

	function send(text: string) {
		if (card?.streaming) return;
		continueCard(cardId, text);
	}

	// Esc closes too.
	function onWinKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}
</script>

<svelte:window onkeydown={onWinKey} />

<!-- backdrop: click outside the panel collapses -->
<div
	class="backdrop"
	onclick={(e) => e.target === e.currentTarget && onclose()}
	role="presentation"
	transition:fade={{ duration: reducedMotion() ? 0 : 200 }}
>
	<div
		class="panel"
		class:jelly={!reducedMotion()}
		data-card-id={cardId}
		role="dialog"
		tabindex="-1"
		aria-modal="true"
		aria-label="Card conversation"
	>
		{#if card}
			<header style="background: var(--block-{card.block})">
				<h2>{card.title}</h2>
				<button class="close" onclick={onclose} aria-label="Close">✕</button>
			</header>

			<div class="body" bind:this={bodyEl}>
				<ThreadView turns={card.turns} streaming={card.streaming} />
			</div>

			<div class="composer">
				<Composer
					bind:this={composer}
					placeholder={card.streaming ? 'Thinking…' : 'Reply to this thread…'}
					disabled={card.streaming}
					onsend={send}
				/>
			</div>
		{/if}
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--s-xl);
		background: rgba(20, 18, 16, 0.32);
		backdrop-filter: blur(4px);
	}
	.panel {
		width: min(760px, 92vw);
		max-height: 86vh;
		display: flex;
		flex-direction: column;
		background: var(--c-canvas);
		border-radius: 28px;
		box-shadow: var(--elev-3, 0 24px 80px rgba(0, 0, 0, 0.28));
		overflow: hidden;
		transform-origin: center;
	}
	/* watery, jelly, magnetic: spring-overshoot scale + a blob border-radius wobble */
	.panel.jelly {
		animation:
			jelly-in 560ms cubic-bezier(0.22, 1.4, 0.36, 1) both,
			blob 7s ease-in-out 560ms infinite;
	}
	@keyframes jelly-in {
		0% {
			transform: scale(0.7) translateY(24px);
			opacity: 0;
			border-radius: 48% 52% 60% 40% / 55% 45% 55% 45%;
		}
		60% {
			transform: scale(1.04) translateY(-4px);
			opacity: 1;
			border-radius: 30px 26px 30px 26px;
		}
		100% {
			transform: scale(1) translateY(0);
			opacity: 1;
			border-radius: 28px;
		}
	}
	@keyframes blob {
		0%,
		100% {
			border-radius: 28px;
		}
		50% {
			border-radius: 32px 26px 30px 28px;
		}
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--s-md);
		padding: var(--s-lg) var(--s-xl);
	}
	h2 {
		margin: 0;
		font-size: 22px;
		font-weight: 600;
		line-height: 1.25;
		letter-spacing: -0.3px;
	}
	.close {
		flex: none;
		width: 32px;
		height: 32px;
		border-radius: var(--r-full);
		border: none;
		background: rgba(var(--ink-rgb), 0.08);
		color: var(--c-ink);
		font-size: 14px;
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.close:active {
		transform: scale(0.88);
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: var(--s-lg) var(--s-xl);
	}
	.composer {
		display: flex;
		align-items: flex-end;
		gap: var(--s-sm);
		padding: var(--s-md) var(--s-lg);
		border-top: 1px solid var(--c-hairline);
		background: var(--c-surface-soft);
	}
	/* Expand uses slightly larger composer than the default 14px/36px. */
	.composer {
		--composer-font-size: 15px;
		--composer-btn-size: 38px;
		--composer-max-height: 120px;
	}
</style>
