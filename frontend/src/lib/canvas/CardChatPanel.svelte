<script lang="ts">
	import { flow, continueCard, session, runSession } from './store.svelte';
	import { resizable } from '$lib/actions/resizable';
	import type { CardData } from './store.svelte';
	import ThreadView from './ThreadView.svelte';
	import Composer from './Composer.svelte';

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

	let scroller = $state<HTMLDivElement>();

	function send(text: string) {
		if (!cardId || card?.streaming) return;
		continueCard(cardId, text);
	}

	let hubScroller = $state<HTMLDivElement>();

	$effect(() => {
		card?.turns?.length;
		card?.turns?.[card.turns.length - 1]?.answer;
		if (scroller) scroller.scrollTop = scroller.scrollHeight;
	});

	$effect(() => {
		session.turns.length;
		session.turns[session.turns.length - 1]?.answer;
		if (hubScroller) hubScroller.scrollTop = hubScroller.scrollHeight;
	});

</script>

<!-- Always mounted; animates width 0↔chatWidth like the sidebar. Inner stays
     fixed-width so content is clipped (not reflowed) during the slide. -->
<aside class="panel" class:open style:width={open ? `${chatWidth}px` : '0px'}>
	<div class="inner" style:width="{chatWidth}px">
		<div class="grip" use:resizable={{ min: 260, max: 720, getWidth: () => chatWidth, onwidth: (w) => (chatWidth = w) }} role="separator" aria-label="Resize panel" tabindex="-1"></div>

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
				<Composer
					placeholder={card.streaming ? 'Thinking…' : 'Message this card…'}
					disabled={card.streaming}
					onsend={send}
				/>
			</div>
		{:else}
			<header>
				<span class="dot" style="background: var(--c-ink)"></span>
				<h3>Canvas</h3>
			</header>
			<div class="body" bind:this={hubScroller}>
				{#if session.turns.length === 0}
					<div class="hub-empty">
						<p>Ask anything about this canvas, or say <em>"save as a card"</em> to create one.</p>
					</div>
				{:else}
					<ThreadView turns={session.turns} streaming={session.streaming} />
				{/if}
			</div>
			<div class="composer">
				<Composer
					placeholder={session.streaming ? 'Thinking…' : 'Message the canvas…'}
					disabled={session.streaming}
					onsend={(text) => runSession(text)}
				/>
			</div>
		{/if}
	</div>
</aside>

<style>
	/* outer animates width like the sidebar; clips the fixed-width inner */
	.panel {
		flex: none;
		height: 100%;
		overflow: hidden;
		transition: width var(--spring-snappy);
	}
	.inner {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--c-canvas);
		border-left: 1px solid var(--c-hairline);
		border-radius: var(--r-lg) 0 0 var(--r-lg);
		box-shadow: -12px 0 40px rgba(var(--ink-rgb), 0.08);
		box-sizing: border-box;
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
		height: 56px;
		padding: 0 var(--s-md);
		box-sizing: border-box;
		border-bottom: 1px solid var(--c-hairline);
		flex: none;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: var(--r-full);
		flex: none;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
		line-height: 1.3;
		/* leave room for the fixed chat-toggle that sits over the header's right edge */
		flex: 1;
		padding-right: 40px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.composer {
		display: flex;
		align-items: flex-end;
		gap: var(--s-sm);
		padding: var(--s-md);
		border-top: 1px solid var(--c-hairline);
		background: var(--c-surface-soft);
		flex: none;
	}
	.hub-empty {
		padding: var(--s-lg);
		font-size: 13px;
		color: rgba(var(--ink-rgb), 0.45);
		line-height: 1.5;
	}
</style>
