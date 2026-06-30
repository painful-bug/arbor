<script lang="ts">
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	// Reusable find-in-view bar (⌘F) for any overlay's scroll container. Uses the
	// native CSS Custom Highlight API so it never mutates the DOM — safe over the
	// contenteditable editors in FilePanel. One overlay is open at a time, so the
	// document-wide 'find'/'find-active' highlight registry can't collide.
	let { target }: { target: HTMLElement | null } = $props();

	let open = $state(false);
	let query = $state('');
	let cursor = $state(0);
	let ranges: Range[] = [];
	let total = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);
	let barEl = $state<HTMLDivElement | null>(null);

	const supported = typeof CSS !== 'undefined' && 'highlights' in CSS;

	function buildRanges(q: string): Range[] {
		const out: Range[] = [];
		if (!target || !q) return out;
		const needle = q.toLowerCase();
		const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const text = (node.textContent ?? '').toLowerCase();
			let i = 0;
			while ((i = text.indexOf(needle, i)) !== -1) {
				const r = document.createRange();
				r.setStart(node, i);
				r.setEnd(node, i + needle.length);
				out.push(r);
				i += needle.length;
			}
		}
		return out;
	}

	function paint() {
		if (!supported) return;
		CSS.highlights.delete('find');
		CSS.highlights.delete('find-active');
		if (!ranges.length) return;
		const active = ranges[cursor];
		const rest = ranges.filter((_, i) => i !== cursor);
		if (rest.length) CSS.highlights.set('find', new Highlight(...rest));
		if (active) CSS.highlights.set('find-active', new Highlight(active));
	}

	function scrollToCursor() {
		const r = ranges[cursor];
		const el = r?.startContainer.parentElement;
		el?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
	}

	function run() {
		ranges = buildRanges(query.trim());
		total = ranges.length;
		cursor = 0;
		paint();
		if (ranges.length) scrollToCursor();
	}

	function step(delta: number) {
		if (!ranges.length) return;
		cursor = (cursor + delta + ranges.length) % ranges.length;
		paint();
		scrollToCursor();
	}

	function clear() {
		ranges = [];
		total = 0;
		cursor = 0;
		if (supported) {
			CSS.highlights.delete('find');
			CSS.highlights.delete('find-active');
		}
	}

	function close() {
		open = false;
		query = '';
		clear();
	}

	function onWinKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'f' || e.key === 'F')) {
			e.preventDefault();
			open = true;
			queueMicrotask(() => inputEl?.focus());
		}
	}

	function onFieldKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			e.stopPropagation();
			step(e.shiftKey ? -1 : 1);
		} else if (e.key === 'Escape') {
			// Don't let the host overlay's own Esc-to-close fire — close the find bar first.
			e.preventDefault();
			e.stopPropagation();
			close();
		}
	}

	function onDown(e: PointerEvent) {
		if (!open) return;
		if (barEl && !barEl.contains(e.target as Node)) close();
	}

	$effect(() => {
		window.addEventListener('keydown', onWinKey);
		window.addEventListener('pointerdown', onDown, true);
		return () => {
			window.removeEventListener('keydown', onWinKey);
			window.removeEventListener('pointerdown', onDown, true);
			clear();
		};
	});
</script>

{#if open}
	<div
		bind:this={barEl}
		class="find-bar"
		transition:scale={{ duration: reducedMotion() ? 0 : 200, start: 0.94, easing: backOut, opacity: 0 }}
	>
		<input
			bind:this={inputEl}
			class="field"
			type="text"
			placeholder="Find…"
			bind:value={query}
			oninput={run}
			onkeydown={onFieldKey}
			aria-label="Find in view"
			spellcheck="false"
			autocomplete="off"
		/>
		<span class="count">
			{#if query.trim() && total === 0}No results{:else if total > 0}{cursor + 1} of {total}{/if}
		</span>
		<button class="nav" onclick={() => step(-1)} disabled={total === 0} aria-label="Previous" title="Previous (⇧⏎)">⌃</button>
		<button class="nav" onclick={() => step(1)} disabled={total === 0} aria-label="Next" title="Next (⏎)">⌄</button>
		<button class="nav close" onclick={close} aria-label="Close find" title="Close (Esc)">✕</button>
	</div>
{/if}

<style>
	.find-bar {
		position: absolute;
		top: 12px;
		right: 16px;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 8px 5px 12px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
	}
	.field {
		border: none;
		outline: none;
		background: transparent;
		font-size: 13px;
		color: var(--c-ink);
		width: 180px;
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
		min-width: 44px;
		text-align: right;
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
