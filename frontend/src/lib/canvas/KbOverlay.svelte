<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { kbClear, kbContents, kbSearch } from '$lib/ai/client';
	import { debounce } from '$lib/debounce';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { currentCanvasId } from './store.svelte';

	// Knowledge-base overlay: indexed sources + live chunk search for the active
	// canvas. Same dialog language as CommandPalette (scrim + centered panel).
	let { open = $bindable(false) }: { open: boolean } = $props();

	let inputEl = $state<HTMLInputElement | null>(null);
	let data = $state<{ sources: string[]; chunks: number } | null>(null);
	let loading = $state(false);
	let clearing = $state(false);
	let clearConfirm = $state(false);
	let query = $state('');
	let results = $state<string[] | null>(null);
	let searching = $state(false);

	const searchDebounced = debounce(async (q: string) => {
		const r = await kbSearch(currentCanvasId() || 'default', q);
		if (query === q) { results = r; searching = false; }
	}, 250);

	/** Focus + select the search field (⌘F while open). */
	export function focusSearch() {
		inputEl?.focus();
		inputEl?.select();
	}

	async function refresh() {
		data = null;
		loading = true;
		clearConfirm = false;
		query = '';
		results = null;
		data = await kbContents(currentCanvasId() || 'default');
		loading = false;
	}

	// Load contents each time the overlay opens.
	$effect(() => {
		if (open) void refresh();
	});

	function onQueryInput() {
		const q = query;
		if (!q.trim()) { searchDebounced.cancel(); results = null; searching = false; return; }
		searching = true;
		searchDebounced(q);
	}

	async function doClear() {
		if (!clearConfirm) { clearConfirm = true; return; }
		clearing = true;
		await kbClear(currentCanvasId() || 'default');
		clearConfirm = false;
		data = await kbContents(currentCanvasId() || 'default');
		clearing = false;
	}

	function close() {
		open = false;
		clearConfirm = false;
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="kb-backdrop"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onpointerdown={close}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="kb-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Knowledge base"
			tabindex="-1"
			transition:scale={{ duration: reducedMotion() ? 0 : 220, start: 0.96, easing: backOut, opacity: 0 }}
			onpointerdown={(e) => e.stopPropagation()}
		>
			<header class="kb-header">
				<span class="kb-title">Knowledge Base</span>
				<div class="kb-actions">
					<input
						bind:this={inputEl}
						class="kb-search"
						type="text"
						placeholder="Search KB…"
						bind:value={query}
						oninput={onQueryInput}
					/>
					<button
						class="kb-btn kb-clear"
						class:confirm={clearConfirm}
						onclick={doClear}
						disabled={clearing}
					>
						{clearing ? 'Clearing…' : clearConfirm ? 'Confirm clear?' : 'Clear KB'}
					</button>
					{#if clearConfirm}
						<button class="kb-btn" onclick={() => (clearConfirm = false)}>Cancel</button>
					{/if}
					<button class="kb-btn" onclick={refresh} disabled={loading} title="Refresh">↺</button>
					<button class="kb-btn" onclick={close} aria-label="Close">✕</button>
				</div>
			</header>
			<div class="kb-body">
				{#if query.trim()}
					{#if searching}
						<div class="kb-empty"><span class="spinner"></span> Searching…</div>
					{:else if !results || results.length === 0}
						<div class="kb-empty">No matching chunks.</div>
					{:else}
						<section>
							<h3>Matching chunks ({results.length})</h3>
							<ul class="kb-chunks">
								{#each results as chunk, i (i)}
									<li class="kb-chunk">{chunk}</li>
								{/each}
							</ul>
						</section>
					{/if}
				{:else if loading}
					<div class="kb-empty"><span class="spinner"></span> Loading…</div>
				{:else if !data || data.sources.length === 0}
					<div class="kb-empty">KB is empty — drop files onto the canvas to index them.</div>
				{:else}
					<section>
						<h3>Indexed sources ({data.chunks} chunks)</h3>
						<ul>
							{#each data.sources as s (s)}
								<li>{s}</li>
							{/each}
						</ul>
					</section>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.kb-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 14vh;
		background: rgba(0, 0, 0, 0.28);
	}
	.kb-panel {
		width: min(680px, 92vw);
		max-height: 72vh;
		background: var(--c-canvas, #fff);
		border-radius: 14px;
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-3, 0 18px 50px rgba(0, 0, 0, 0.25));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.kb-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		flex: none;
	}
	.kb-title {
		font-weight: 600;
		font-size: 14px;
		color: var(--c-ink);
	}
	.kb-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.kb-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: none;
		background: transparent;
		border-radius: var(--r-pill, 999px);
		padding: 5px 10px;
		font-size: 12px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
		white-space: nowrap;
		transition: background 0.12s;
	}
	.kb-btn:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.06); }
	.kb-btn:disabled { opacity: 0.5; cursor: default; }
	.kb-btn.kb-clear { color: rgb(255, 80, 80); }
	.kb-btn.kb-clear:hover:not(:disabled) { background: rgba(255, 80, 80, 0.1); }
	.kb-btn.kb-clear.confirm { background: rgb(255, 80, 80); color: #fff; }
	.kb-btn.kb-clear.confirm:hover { background: rgb(235, 60, 60); }
	.kb-search {
		border: none;
		outline: none;
		background: rgba(var(--ink-rgb), 0.05);
		border-radius: var(--r-pill, 999px);
		padding: 5px 12px;
		font-size: 12px;
		color: var(--c-ink);
		width: 180px;
	}
	.kb-search::placeholder { color: var(--c-ink); opacity: 0.4; }
	.kb-chunks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
	.kb-chunk {
		padding: 8px 10px;
		border: 1px solid var(--c-hairline);
		border-radius: 8px;
		background: var(--c-surface-soft, #fff);
		white-space: pre-wrap;
	}
	.kb-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		font-size: 13px;
		line-height: 1.55;
	}
	.kb-empty {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: rgba(var(--ink-rgb),0.45);
		text-align: center;
		padding: 32px 0;
	}
	.kb-body section { margin-bottom: 20px; }
	.kb-body h3 {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: rgba(var(--ink-rgb),0.45);
		margin: 0 0 8px;
	}
	.kb-body ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.kb-body li {
		padding: 5px 10px;
		background: var(--c-surface-soft, rgba(0,0,0,0.03));
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 12px;
		word-break: break-word;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid rgba(var(--ink-rgb), 0.18);
		border-top-color: var(--c-ink);
		animation: spin 0.7s linear infinite;
		flex: none;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
