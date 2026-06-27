<script lang="ts">
	// Right collapsible sidebar in the tiled split layout: canvas | FilePanel | ChatPanel.
	// Bound `open` is lifted to Canvas.svelte so the parent controls the flex column.
	import { flow, continueCard } from './store.svelte';
	import type { CardData } from './store.svelte';
	import ThreadView from './ThreadView.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	let chatWidth = $state(340);

	const node = $derived(flow.nodes.find((n) => n.id === flow.selected && n.type === 'card'));
	const card = $derived(node?.data as CardData | undefined);
	const cardId = $derived(node?.id);

	const plan = $derived.by(() => {
		for (const turn of card?.turns ?? []) {
			for (const e of turn.events ?? []) {
				if (e.type === 'tool_start' && e.name === 'research_plan') {
					const topics = (e.args as { topics?: string[] })?.topics;
					if (Array.isArray(topics) && topics.length) return topics;
				}
			}
		}
		return null;
	});

	let draft = $state('');
	let scroller = $state<HTMLDivElement>();

	function send() {
		const t = draft.trim();
		if (!t || !cardId || card?.streaming) return;
		continueCard(cardId, t);
		draft = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	$effect(() => {
		card?.turns?.length;
		card?.turns?.[card.turns.length - 1]?.answer;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	// Drag-resize from the left grip.
	function startResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = chatWidth;
		const move = (ev: PointerEvent) =>
			(chatWidth = Math.max(260, Math.min(640, startW + startX - ev.clientX)));
		const up = () => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
</script>

<!-- pull-tab always visible; panel slides in when open -->
<div class="col" class:open>
	<button class="tab" onclick={() => (open = !open)} aria-label="Toggle chat panel">
		<span class="chev">{open ? '›' : '‹'}</span>
		<span class="tab-label">Chat</span>
	</button>

	{#if open}
		<aside class="panel" style="width: {chatWidth}px">
			<div class="grip" onpointerdown={startResize} role="separator" aria-label="Resize panel" tabindex="-1"></div>

			{#if card && cardId}
				<header>
					<span class="dot" style="background: var(--block-{card.block})"></span>
					<h3>{card.title}</h3>
				</header>
				<div class="body" bind:this={scroller}>
					{#if plan}
						<div class="plan">
							<p class="plan-title">🔬 Research Plan</p>
							<ol>
								{#each plan as topic}
									<li>{topic}</li>
								{/each}
							</ol>
						</div>
					{/if}
					<ThreadView turns={card.turns} streaming={card.streaming} />
				</div>
				<div class="composer">
					<textarea
						bind:value={draft}
						{onkeydown}
						rows="1"
						placeholder={card.streaming ? 'Thinking…' : 'Message this card…'}
						disabled={card.streaming}
					></textarea>
					<button class="send" onclick={send} disabled={!draft.trim() || card.streaming}>↵</button>
				</div>
			{:else}
				<div class="empty">Select a card to chat with it.</div>
			{/if}
		</aside>
	{/if}
</div>

<style>
	.col {
		flex: none;
		height: 100%;
		display: flex;
		flex-direction: row;
	}
	/* pull-tab: magnetic squish on hover/press */
	.tab {
		flex: none;
		width: 28px;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
		padding: 0;
		border: none;
		border-left: 1px solid var(--c-hairline);
		background: var(--c-ink);
		color: var(--c-on-primary);
		cursor: pointer;
		transition:
			transform 320ms cubic-bezier(0.22, 1.4, 0.36, 1),
			width 320ms cubic-bezier(0.22, 1.4, 0.36, 1);
	}
	.tab:hover {
		transform: translateX(-3px) scaleX(1.1);
		width: 32px;
	}
	.tab:active {
		transform: scaleX(0.94) scaleY(0.97);
	}
	.chev {
		font-size: 18px;
		line-height: 1;
	}
	.tab-label {
		writing-mode: vertical-rl;
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 1px;
	}
	.panel {
		position: relative;
		flex: none;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--c-canvas);
		border-left: 1px solid var(--c-hairline);
		box-shadow: -12px 0 40px rgba(0, 0, 0, 0.08);
		overflow: hidden;
	}
	.grip {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
		z-index: 2;
	}
	header {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		padding: var(--s-md) var(--s-lg);
		border-bottom: 1px solid var(--c-hairline);
		flex: none;
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: var(--r-full);
		flex: none;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: var(--s-lg);
		min-height: 0;
	}
	.plan {
		margin: 0 0 var(--s-md);
		padding: var(--s-sm) var(--s-md);
		border-radius: var(--r-md, 10px);
		background: var(--c-surface-soft, rgba(0, 0, 0, 0.04));
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
	}
	.plan-title {
		margin: 0 0 4px;
		font-size: 12px;
		font-weight: 600;
	}
	.plan ol {
		margin: 0;
		padding-left: 18px;
		font-size: 13px;
		line-height: 1.5;
	}
	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--s-xl);
		text-align: center;
		font-size: 13px;
		color: rgba(0, 0, 0, 0.4);
	}
	.composer {
		display: flex;
		align-items: flex-end;
		gap: var(--s-sm);
		padding: var(--s-md);
		border-top: 1px solid var(--c-hairline);
		background: var(--c-surface-soft);
		flex: none;
	}
	textarea {
		flex: 1;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 14px;
		line-height: 1.4;
		max-height: 110px;
		padding: 8px 0;
		color: var(--c-ink);
	}
	textarea:disabled {
		opacity: 0.5;
	}
	.send {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: var(--r-full);
		border: none;
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 15px;
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.send:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.send:not(:disabled):active {
		transform: scale(0.9);
	}
</style>
