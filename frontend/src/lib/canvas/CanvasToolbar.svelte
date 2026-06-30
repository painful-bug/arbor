<script lang="ts">
	import { tool, settings, setClusterSpacing, addClusterTags, type Tool } from './store.svelte';

	let showSpacing = $state(false);

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

	const tools: { id: Tool; label: string; icon: string; key: string; title: string }[] = [
		{ id: 'hand',      label: 'Hand',      icon: '✋', key: 'H', title: 'Hand tool -- pan canvas (H)' },
		{ id: 'select',    label: 'Select',    icon: '↖',  key: 'V', title: 'Select -- click or drag to select cards (V)' },
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
				class:secondary={t.id === 'duplicate' || t.id === 'connect' || t.id === 'color'}
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
		<button class="action" onclick={onRedo} title="Redo (R)">
			<span class="icon">↪</span>
			<span class="label">Redo</span>
			<span class="key">R</span>
		</button>
		<button class="action" onclick={onFit} title="Zoom to fit all cards (F)">
			<span class="icon">⊡</span>
			<span class="label">Fit</span>
			<span class="key">F</span>
		</button>
		<button class="action secondary" onclick={onCleanUp} title="Clean Up — arrange cards into semantic clusters (CC)">
			<span class="icon">✦</span>
			<span class="label">Clean Up</span>
			<span class="key">CC</span>
		</button>
		<div class="spacing-wrap">
			<button
				class="action secondary spacing-btn"
				class:active={showSpacing}
				onclick={() => (showSpacing = !showSpacing)}
				title="Cluster spacing — drag to space the Clean Up clusters apart"
				aria-label="Cluster spacing"
				aria-pressed={showSpacing}
			>
				<span class="icon">↔</span>
			</button>
			{#if showSpacing}
				<div class="spacing-pop">
					<input
						type="range"
						min="0"
						max="24"
						step="1"
						value={settings.clusterSpacing}
						oninput={(e) => setClusterSpacing(+e.currentTarget.value)}
						aria-label="Cluster spacing"
					/>
					<span class="spacing-val">{settings.clusterSpacing}</span>
				</div>
			{/if}
		</div>
		<button
			class="action secondary spacing-btn"
			onclick={addClusterTags}
			title="Label clusters — drop an editable tag on each Clean Up cluster"
			aria-label="Label clusters"
		>
			<span class="icon">🏷</span>
		</button>
		<button class="action secondary" onclick={onDeepResearch} title="Deep Research -- plan and search real papers">
			<span class="icon">🔬</span>
			<span class="label">Research</span>
		</button>
		<button class="action secondary" onclick={onKB} title="Knowledge Base -- view and clear indexed content">
			<span class="icon">⬡</span>
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
	.spacing-wrap {
		position: relative;
		display: inline-flex;
	}
	.spacing-btn.active {
		background: rgba(var(--ink-rgb), 0.1);
	}
	/* Popover hangs below the toolbar pill, holding a native range slider. */
	.spacing-pop {
		position: absolute;
		top: calc(100% + 8px);
		right: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		z-index: 10;
	}
	.spacing-pop input[type='range'] {
		width: 140px;
		accent-color: var(--c-ink);
		cursor: pointer;
	}
	.spacing-val {
		font-size: 11px;
		font-family: var(--font-mono);
		opacity: 0.6;
		min-width: 16px;
		text-align: right;
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
	/* Progressive squeeze driven by the canvas area width (shrinks as the chat
	   panel widens). Container query — not viewport — so it tracks the live drag. */
	@container canvasarea (max-width: 1040px) {
		.label, .key { display: none; }
		.tool, .action { padding: 6px 8px; }
	}
	@container canvasarea (max-width: 760px) {
		.secondary { display: none; }
		.sep { display: none; }
	}
</style>
