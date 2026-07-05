<script lang="ts">
	// SplitFileView top toolbar: file-editing tools that drive the focused pane via
	// its PaneController. Replaces CanvasToolbar while split mode is active. Same
	// top-center pill chrome as CanvasToolbar.
	import {
		Highlighter, Minus, Plus, MoveHorizontal, Maximize, Square,
		ChevronLeft, ChevronRight, Bold, Italic, Underline,
		Columns2, X
	} from '@lucide/svelte';
	import type { PaneController } from './pane-controller.svelte';

	let { controller, onSwap, onCloseSplit }:
		{ controller: PaneController; onSwap: () => void; onCloseSplit: () => void } = $props();

	let showColors = $state(false);
</script>

<div class="toolbar">
	{#if controller.kind === 'pdf'}
		<div class="group">
			<button class="tool" class:active={controller.highlightOn} onclick={() => controller.toggleHighlight()} title="Highlight" aria-pressed={controller.highlightOn}>
				<Highlighter size={15} />
			</button>
			{#if controller.highlightOn}
				<div class="swatches">
					{#each controller.colors as c (c.value)}
						<button
							class="swatch"
							class:selected={controller.activeColor === c.value}
							style="background: {c.value}"
							onclick={() => controller.setColor(c.value)}
							title={c.label}
							aria-label={c.label}
						></button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="sep"></div>

		<div class="group">
			<button class="tool" onclick={() => controller.zoomOut()} title="Zoom out" aria-label="Zoom out"><Minus size={15} /></button>
			<span class="pct">{controller.zoomPct}%</span>
			<button class="tool" onclick={() => controller.zoomIn()} title="Zoom in" aria-label="Zoom in"><Plus size={15} /></button>
		</div>

		<div class="sep"></div>

		<div class="group">
			<button class="tool" class:active={controller.fitMode === 'width'} onclick={() => controller.setFit('width')} title="Fit width"><MoveHorizontal size={15} /></button>
			<button class="tool" class:active={controller.fitMode === 'page'} onclick={() => controller.setFit('page')} title="Fit page"><Maximize size={15} /></button>
			<button class="tool" class:active={controller.fitMode === 'actual'} onclick={() => controller.setFit('actual')} title="Actual size"><Square size={15} /></button>
		</div>

		<div class="sep"></div>

		<div class="group">
			<button class="tool" onclick={() => controller.prevPage()} disabled={controller.currentPage <= 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
			<span class="pct">{controller.currentPage} / {controller.totalPages}</span>
			<button class="tool" onclick={() => controller.nextPage()} disabled={controller.currentPage >= controller.totalPages} aria-label="Next page"><ChevronRight size={15} /></button>
		</div>

		<div class="sep"></div>

		<div class="group">
			<input class="find" type="search" placeholder="Find…" value={controller.query} oninput={(e) => controller.setQuery(e.currentTarget.value)} />
		</div>
	{:else if controller.kind === 'text'}
		<div class="group">
			<button class="tool" onclick={() => controller.bold?.()} title="Bold"><Bold size={15} /></button>
			<button class="tool" onclick={() => controller.italic?.()} title="Italic"><Italic size={15} /></button>
			<button class="tool" onclick={() => controller.underline?.()} title="Underline"><Underline size={15} /></button>
		</div>
		<div class="sep"></div>
		<div class="group">
			<input class="find" type="search" placeholder="Find…" value={controller.query} oninput={(e) => controller.setQuery(e.currentTarget.value)} />
		</div>
	{/if}

	<div class="sep"></div>

	<div class="group">
		<button class="tool" onclick={onSwap} title="Swap panes" aria-label="Swap panes"><Columns2 size={15} /></button>
		<button class="tool" onclick={onCloseSplit} title="Close split view" aria-label="Close split view"><X size={15} /></button>
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
		pointer-events: auto;
	}
	.group { display: inline-flex; align-items: center; gap: 2px; }
	.sep { width: 1px; height: 20px; background: var(--c-hairline, rgba(0, 0, 0, 0.1)); margin: 0 4px; flex: none; }
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 6px 8px;
		border: none;
		border-radius: var(--r-pill, 999px);
		background: transparent;
		color: var(--c-ink);
		cursor: pointer;
		transition: background 0.12s, color 0.12s;
	}
	.tool:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.06); }
	.tool.active { background: var(--c-ink); color: var(--c-on-primary, #fff); }
	.tool:disabled { opacity: 0.35; cursor: default; }
	.pct {
		font-size: 11px;
		font-family: var(--font-mono);
		opacity: 0.7;
		min-width: 30px;
		text-align: center;
		white-space: nowrap;
	}
	.swatches { display: inline-flex; gap: 3px; padding: 0 4px; }
	.swatch {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid transparent;
		cursor: pointer;
		padding: 0;
	}
	.swatch.selected { border-color: var(--c-ink); }
	.find {
		width: 120px;
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-pill, 999px);
		background: var(--c-surface-soft, transparent);
		padding: 4px 10px;
		font-size: 12px;
		color: var(--c-ink);
		outline: none;
	}
</style>
