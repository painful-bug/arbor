<script lang="ts">
	// Full-screen grid of saved canvases. Click a card → open it (swoop handled by
	// the parent); ＋ creates a new one. Names are inline-editable; ✕ deletes.
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import {
		library,
		getCachedDoc,
		newCanvas,
		switchCanvas,
		renameCanvas,
		deleteCanvas,
		saveCanvas,
		currentCanvasId,
		ui
	} from './store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import type { CardData } from './store.svelte';

	// Sort newest-edited first; recompute when the list changes.
	const sorted = $derived([...library.list].sort((a, b) => b.updatedAt - a.updatedAt));

	// Cheap preview: card count + the block colors on the canvas.
	function preview(id: string): { count: number; blocks: string[] } {
		const doc = getCachedDoc(id);
		const cards = (doc?.nodes ?? []).filter((n) => n.type === 'card');
		const blocks = cards.slice(0, 6).map((n) => (n.data as CardData).block ?? 'lime');
		return { count: cards.length, blocks };
	}

	function open(id: string) {
		switchCanvas(id);
		ui.view = 'canvas';
	}

	function create() {
		newCanvas();
		ui.view = 'canvas';
	}

	function onRename(id: string, e: Event) {
		renameCanvas(id, (e.target as HTMLInputElement).value);
	}

	function onDelete(id: string, e: MouseEvent) {
		e.stopPropagation();
		deleteCanvas(id);
	}

	const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

	// Persist any in-flight canvas edits so previews are fresh on entry.
	saveCanvas();
</script>

<div class="library">
	<header>
		<h1>Library</h1>
		<button class="new" onclick={create}>＋ New canvas</button>
	</header>

	<div class="grid">
		{#each sorted as c, i (c.id)}
			{@const p = preview(c.id)}
			<div
				class="card"
				class:current={c.id === currentCanvasId()}
				role="button"
				tabindex="0"
				onclick={() => open(c.id)}
				onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && open(c.id)}
				in:fly={reducedMotion() ? { duration: 0 } : { y: 16, duration: 360, delay: i * 30, easing: backOut }}
			>
				<div class="thumb">
					{#each p.blocks as b}
						<span class="chip" style="background: var(--block-{b})"></span>
					{/each}
					{#if p.count === 0}<span class="empty-thumb">empty</span>{/if}
				</div>
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<input
					class="name"
					value={c.name}
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
					onchange={(e) => onRename(c.id, e)}
				/>
				<div class="meta">
					<span>{p.count} card{p.count === 1 ? '' : 's'}</span>
					<span>{fmt(c.updatedAt)}</span>
				</div>
				<button class="del" onclick={(e) => onDelete(c.id, e)} aria-label="Delete canvas">✕</button>
			</div>
		{/each}
	</div>
</div>

<style>
	.library {
		height: 100%;
		overflow-y: auto;
		padding: var(--s-xl);
		background: var(--c-canvas);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s-xl);
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.5px;
	}
	.new {
		border: none;
		border-radius: var(--r-pill);
		padding: 10px 18px;
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 14px;
		font-weight: 600;
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.new:active {
		transform: scale(0.94);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: var(--s-lg);
	}
	.card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--s-sm);
		padding: var(--s-md);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
		background: var(--c-surface-soft);
		text-align: left;
		cursor: pointer;
		transition:
			transform var(--ease-glass),
			box-shadow var(--ease-glass);
	}
	.card:hover {
		transform: translateY(-3px);
		box-shadow: var(--elev-2);
	}
	.card.current {
		box-shadow: 0 0 0 2px var(--c-ink);
	}
	.thumb {
		display: flex;
		flex-wrap: wrap;
		align-content: flex-start;
		gap: 6px;
		height: 96px;
		padding: var(--s-sm);
		border-radius: var(--r-md);
		background: var(--c-canvas);
		overflow: hidden;
	}
	.chip {
		width: 40px;
		height: 26px;
		border-radius: var(--r-sm);
	}
	.empty-thumb {
		margin: auto;
		font-family: var(--font-mono);
		font-size: 12px;
		color: rgba(var(--ink-rgb), 0.3);
	}
	.name {
		border: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 15px;
		font-weight: 600;
		color: var(--c-ink);
		padding: 2px 4px;
		border-radius: var(--r-sm);
		outline: none;
	}
	.name:hover,
	.name:focus {
		background: var(--c-hairline-soft);
	}
	.meta {
		display: flex;
		justify-content: space-between;
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.45);
		padding: 0 4px;
	}
	.del {
		position: absolute;
		top: 8px;
		right: 8px;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-full);
		background: rgba(var(--ink-rgb), 0.06);
		color: var(--c-ink);
		font-size: 11px;
		cursor: pointer;
		opacity: 0;
		transition: opacity var(--ease-glass);
	}
	.card:hover .del {
		opacity: 1;
	}
	.del:hover {
		background: rgba(220, 60, 60, 0.18);
	}
</style>
