<script lang="ts">
	// Custom right-click menu for file cards. Replaces the native WKWebView menu
	// (suppressed in +layout.svelte). Floating panel at pointer x/y, clamped to the
	// viewport. Visual style mirrors FilePanel's old .split-menu.
	import type { Component } from 'svelte';
	import { popScale } from '$lib/theme/animations';

	export interface MenuItem {
		id: string;
		label: string;
		icon: Component;
		disabled?: boolean;
	}

	let { x, y, items, onselect, onclose }:
		{ x: number; y: number; items: MenuItem[]; onselect: (id: string) => void; onclose: () => void } = $props();

	// Clamp so the menu never spills off-screen (assume ~220x measured after mount).
	let menuEl = $state<HTMLDivElement>();
	// svelte-ignore state_referenced_locally -- initial pointer coords; effect re-clamps after mount
	let pos = $state({ x, y });
	$effect(() => {
		if (!menuEl) return;
		const r = menuEl.getBoundingClientRect();
		pos = {
			x: Math.min(x, window.innerWidth - r.width - 8),
			y: Math.min(y, window.innerHeight - r.height - 8),
		};
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); onclose(); }
	}
</script>

<svelte:window onkeydown={onKey} onpointerdown={onclose} onwheel={onclose} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="ctx-menu"
	bind:this={menuEl}
	style="left: {pos.x}px; top: {pos.y}px"
	transition:popScale={{ duration: 150, start: 0.96 }}
	onpointerdown={(e) => e.stopPropagation()}
>
	{#each items as item (item.id)}
		<button
			class="ctx-item"
			disabled={item.disabled}
			onclick={() => { onselect(item.id); onclose(); }}
		>
			<item.icon size={15} />
			<span>{item.label}</span>
		</button>
	{/each}
</div>

<style>
	.ctx-menu {
		position: fixed;
		z-index: 250;
		min-width: 200px;
		background: var(--c-surface, var(--c-canvas, #fff));
		border: 1px solid var(--c-hairline);
		border-radius: 10px;
		box-shadow: var(--elev-float, 0 6px 20px rgba(0, 0, 0, 0.2));
		padding: 4px;
	}
	.ctx-item {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		text-align: left;
		border: none;
		background: transparent;
		padding: 8px 10px;
		border-radius: 7px;
		font-size: 13px;
		color: var(--c-ink);
		cursor: pointer;
	}
	.ctx-item:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.07); }
	.ctx-item:disabled { opacity: 0.38; cursor: default; }
</style>
