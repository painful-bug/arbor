<script lang="ts">
	// Dumb renderer for a card's conversation: one block per turn (prompt + activity
	// timeline + markdown answer). Reused by the expand modal and the chat sidebar.
	import type { Turn } from './store.svelte';
	import { renderMarkdown } from '$lib/markdown';
	import AgentTimeline from './AgentTimeline.svelte';

	let { turns, streaming = false }: { turns: Turn[]; streaming?: boolean } = $props();
</script>

<div class="thread">
	{#each turns as turn, i (i)}
		<div class="turn">
			<p class="prompt">{turn.prompt}</p>
			<AgentTimeline events={turn.events ?? []} streaming={streaming && i === turns.length - 1} />
			<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by DOMPurify -->
			<div class="answer">
				{@html renderMarkdown(turn.answer)}{#if streaming && i === turns.length - 1}<span
						class="caret"
					></span>{/if}
			</div>
		</div>
	{/each}
</div>

<style>
	.thread {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
	}
	.turn {
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
	}
	.turn + .turn {
		padding-top: var(--s-lg);
		border-top: 1px solid rgba(0, 0, 0, 0.08);
	}
	.prompt {
		margin: 0;
		font-weight: 600;
		font-size: 15px;
		line-height: 1.35;
	}
	.answer {
		margin: 0;
		font-size: 14px;
		line-height: 1.55;
		color: rgba(0, 0, 0, 0.82);
	}
	.answer :global(p) {
		margin: 0 0 0.5em;
	}
	.answer :global(img) {
		max-width: 100%;
		border-radius: var(--r-sm);
	}
	.answer :global(pre) {
		overflow-x: auto;
		font-size: 12px;
		background: rgba(0, 0, 0, 0.05);
		padding: var(--s-sm);
		border-radius: var(--r-sm);
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
