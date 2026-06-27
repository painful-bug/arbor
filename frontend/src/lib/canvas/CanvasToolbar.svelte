<script lang="ts">
	import { tool, type Tool } from './store.svelte';

	let {
		onDeepResearch,
		onFit,
		onUndo
	}: {
		onDeepResearch: () => void;
		onFit: () => void;
		onUndo: () => void;
	} = $props();

	const tools: { id: Tool; label: string; icon: string; key: string; title: string }[] = [
		{ id: 'hand',      label: 'Hand',      icon: '✋', key: 'H', title: 'Hand tool -- pan canvas (H)' },
		{ id: 'text',      label: 'Text',      icon: 'T',  key: 'T', title: 'Text tool -- click to place a note (T)' },
		{ id: 'duplicate', label: 'Duplicate', icon: '⧉',  key: 'D', title: 'Duplicate -- click a card to copy it (D)' },
		{ id: 'connect',   label: 'Connect',   icon: '↗',  key: 'C', title: 'Connect -- click two cards to draw an edge (C)' },
		{ id: 'color',     label: 'Color',     icon: '◐',  key: '',  title: 'Color -- click a card to cycle its color' }
	];

	function select(t: Tool) {
		tool.active = t;
		if (t !== 'connect') tool.connectFrom = null;
	}
</script>

<div class="toolbar">
	<div class="tools">
		{#each tools as t (t.id)}
			<button
				class="tool"
				class:active={tool.active === t.id}
				onclick={() => select(t.id)}
				title={t.title}
				aria-pressed={tool.active === t.id}
			>
				<span class="icon">{t.icon}</span>
				<span class="label">{t.label}</span>
				{#if t.key}<span class="key">{t.key}</span>{/if}
			</button>
		{/each}
	</div>

	<div class="sep"></div>

	<div class="actions">
		<button class="action" onclick={onUndo} title="Undo last action (U)">
			<span class="icon">↩</span>
			<span class="label">Undo</span>
			<span class="key">U</span>
		</button>
		<button class="action" onclick={onFit} title="Zoom to fit all cards (F)">
			<span class="icon">⊡</span>
			<span class="label">Fit</span>
			<span class="key">F</span>
		</button>
		<button class="action" onclick={onDeepResearch} title="Deep Research -- plan and search real papers">
			<span class="icon">🔬</span>
			<span class="label">Research</span>
		</button>
	</div>
</div>

<style>
	.toolbar {
		position: absolute;
		top: 14px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		user-select: none;
	}
	.tools, .actions {
		display: flex;
		gap: 2px;
	}
	.sep {
		width: 1px;
		height: 20px;
		background: var(--c-hairline, rgba(0,0,0,0.1));
		margin: 0 4px;
		flex: none;
	}
	.tool, .action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 5px 10px;
		border: none;
		border-radius: var(--r-pill, 999px);
		background: transparent;
		font-size: 12px;
		font-weight: 500;
		cursor: pointer;
		color: var(--c-ink);
		transition: background 0.12s, color 0.12s;
		white-space: nowrap;
	}
	.tool:hover, .action:hover {
		background: rgba(0, 0, 0, 0.06);
	}
	.tool.active {
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
	}
	.icon {
		font-size: 13px;
		line-height: 1;
	}
	.key {
		font-size: 10px;
		font-family: var(--font-mono);
		opacity: 0.55;
		margin-left: 1px;
	}
	.tool.active .key {
		opacity: 0.65;
	}
	/* Hide labels at narrow widths */
	@media (max-width: 640px) {
		.label { display: none; }
		.tool, .action { padding: 6px 8px; }
	}
</style>
