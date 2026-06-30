<script lang="ts">
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { searchState, rebuild, next, prev, closeSearch } from './globalSearch.svelte';
	import { flow } from './store.svelte';

	let inputEl = $state<HTMLInputElement | null>(null);
	let barEl = $state<HTMLDivElement | null>(null);

	// Focus the field whenever the bar opens.
	$effect(() => {
		if (searchState.open && inputEl) inputEl.focus();
	});

	// Dismiss on a pointer-down anywhere outside the bar (i.e. on the canvas).
	$effect(() => {
		function onDown(e: PointerEvent) {
			if (!searchState.open) return;
			if (barEl && !barEl.contains(e.target as Node)) closeSearch();
		}
		window.addEventListener('pointerdown', onDown, true);
		return () => window.removeEventListener('pointerdown', onDown, true);
	});

	function onInput(e: Event) {
		rebuild((e.currentTarget as HTMLInputElement).value);
	}

	// Cmd+Enter (mac) / Ctrl+Enter (win/linux) — expand the focused card or open the
	// focused file's preview, without leaving the search field.
	function onKeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			const m = searchState.matches[searchState.cursor];
			if (!m) return;
			const node = flow.nodes.find((n) => n.id === m.nodeId);
			if (!node) return;
			if (node.type === 'card') {
				window.dispatchEvent(new CustomEvent('arbor:expand', { detail: { cardId: node.id } }));
			} else {
				window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: node.id } }));
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (searchState.matches.length) (e.shiftKey ? prev : next)();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			closeSearch();
		}
	}

	const total = $derived(searchState.matches.length);
</script>

{#if searchState.open}
	<div
		bind:this={barEl}
		class="search-bar"
		transition:scale={{ duration: reducedMotion() ? 0 : 220, start: 0.94, easing: backOut, opacity: 0 }}
	>
		<svg class="icon" width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
			<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2" />
			<path d="m20 20-3.5-3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
		</svg>
		<input
			bind:this={inputEl}
			class="field"
			type="text"
			placeholder="Search canvas…"
			value={searchState.query}
			oninput={onInput}
			onkeydown={onKeydown}
			aria-label="Search canvas"
			spellcheck="false"
			autocomplete="off"
		/>
		<span class="count" class:dim={!searchState.query.trim()}>
			{#if searchState.query.trim() && total === 0 && !searchState.ragLoading}
				No results
			{:else if total > 0}
				{searchState.cursor + 1} of {total}{searchState.ragLoading ? '…' : ''}
			{:else if searchState.ragLoading}
				…
			{/if}
		</span>
		<button class="nav" onclick={prev} disabled={total === 0} aria-label="Previous match" title="Previous (⇧⏎)">⌃</button>
		<button class="nav" onclick={next} disabled={total === 0} aria-label="Next match" title="Next (⏎)">⌄</button>
		<button class="nav close" onclick={closeSearch} aria-label="Close search" title="Close (Esc)">✕</button>
	</div>
{/if}

<style>
	.search-bar {
		position: fixed;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 150;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px 5px 12px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		pointer-events: auto;
	}
	.icon {
		color: var(--c-ink);
		opacity: 0.55;
		flex: none;
	}
	.field {
		border: none;
		outline: none;
		background: transparent;
		font-size: 13px;
		color: var(--c-ink);
		width: 240px;
	}
	.field::placeholder {
		color: var(--c-ink);
		opacity: 0.4;
	}
	.count {
		font-size: 11px;
		font-family: var(--font-mono);
		color: var(--c-ink);
		opacity: 0.6;
		white-space: nowrap;
		min-width: 48px;
		text-align: right;
	}
	.count.dim {
		min-width: 0;
	}
	.nav {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-pill, 999px);
		background: transparent;
		color: var(--c-ink);
		font-size: 13px;
		cursor: pointer;
		transition: background 0.12s;
	}
	.nav:hover:not(:disabled) {
		background: rgba(var(--ink-rgb), 0.08);
	}
	.nav:disabled {
		opacity: 0.3;
		cursor: default;
	}
	.close {
		font-size: 11px;
	}
</style>
