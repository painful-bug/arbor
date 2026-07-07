<script lang="ts">
	import type { Component } from 'svelte';
	import {
		Hand, MousePointer2, Type, Copy, Spline, Palette,
		Undo2, Redo2, Maximize, Sparkles, Microscope, Hexagon
	} from '@lucide/svelte';
	import { tool, type Tool } from './store.svelte';

	let {
		onDeepResearch,
		onFit,
		onUndo,
		onRedo,
		onKB,
		onCleanUp
	}: {
		onDeepResearch: () => void;
		onFit: () => void;
		onUndo: () => void;
		onRedo: () => void;
		onKB: () => void;
		onCleanUp: () => void;
	} = $props();

	const tools: { id: Tool; label: string; icon: Component; key: string; title: string }[] = [
		{ id: 'hand',      label: 'Hand',      icon: Hand,          key: 'H', title: 'Hand tool -- pan canvas (H)' },
		{ id: 'select',    label: 'Select',    icon: MousePointer2, key: 'V', title: 'Select -- click or drag to select cards (V)' },
		{ id: 'text',      label: 'Text',      icon: Type,          key: 'T', title: 'Text tool -- click to place a note (T)' },
		{ id: 'duplicate', label: 'Duplicate', icon: Copy,          key: 'D', title: 'Duplicate -- click a card to copy it (D)' },
		{ id: 'connect',   label: 'Connect',   icon: Spline,        key: 'C', title: 'Connect -- click two cards to draw an edge (C)' },
		{ id: 'color',     label: 'Color',     icon: Palette,       key: '',  title: 'Color -- click a card to cycle its color' }
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
				class:secondary={t.id === 'duplicate' || t.id === 'connect' || t.id === 'color'}
				onclick={() => select(t.id)}
				title={t.title}
				aria-pressed={tool.active === t.id}
			>
				<span class="icon"><t.icon size={15} /></span>
				<span class="label">{t.label}</span>
				{#if t.key}<span class="key">{t.key}</span>{/if}
			</button>
		{/each}
	</div>

	<div class="sep"></div>

	<div class="actions">
		<button class="action" onclick={onUndo} title="Undo last action (U)">
			<span class="icon"><Undo2 size={15} /></span>
			<span class="label">Undo</span>
			<span class="key">U</span>
		</button>
		<button class="action" onclick={onRedo} title="Redo (R)">
			<span class="icon"><Redo2 size={15} /></span>
			<span class="label">Redo</span>
			<span class="key">R</span>
		</button>
		<button class="action" onclick={onFit} title="Zoom to fit all cards (F)">
			<span class="icon"><Maximize size={15} /></span>
			<span class="label">Fit</span>
			<span class="key">F</span>
		</button>
		<button class="action secondary" onclick={onCleanUp} title="Clean Up — arrange cards into semantic clusters (CC)">
			<span class="icon"><Sparkles size={15} /></span>
			<span class="label">Clean Up</span>
			<span class="key">CC</span>
		</button>
		<button class="action secondary" onclick={onDeepResearch} title="Deep Research -- plan and search real papers">
			<span class="icon"><Microscope size={15} /></span>
			<span class="label">Research</span>
		</button>
		<button class="action secondary" onclick={onKB} title="Knowledge Base -- view and clear indexed content">
			<span class="icon"><Hexagon size={15} /></span>
			<span class="label">KB</span>
		</button>
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 6px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		user-select: none;
		pointer-events: auto; /* parent topbar has pointer-events:none */
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
		transition: background 0.12s, color 0.12s, padding var(--spring-snappy);
		white-space: nowrap;
	}
	.tool:hover, .action:hover {
		background: rgba(var(--ink-rgb), 0.06);
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
	/* Safety net so the pill never clips a button — squeezes via container
	   queries first, then scrolls horizontally as a last resort. */
	.toolbar {
		max-width: min(100%, calc(100cqw - 24px));
		overflow-x: auto;
		scrollbar-width: none;
	}
	.toolbar::-webkit-scrollbar {
		display: none;
	}
	/* Progressive squeeze driven by the canvas area width (shrinks as the chat
	   panel widens). Container query — not viewport — so it tracks the live drag. */
	@container canvasarea (max-width: 1040px) {
		.label, .key { display: none; }
		.tool, .action { padding: 6px 8px; }
	}
	@container canvasarea (max-width: 760px) {
		.sep { display: none; }
		.toolbar { gap: 2px; padding: 3px 4px; }
	}
	@container canvasarea (max-width: 520px) {
		.secondary { display: none; }
	}
</style>
