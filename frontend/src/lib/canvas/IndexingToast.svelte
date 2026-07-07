<script lang="ts">
	// Aggregate indexing progress pill under the toolbar. Reads the indexing store
	// (indexing.svelte.ts) which tracks the current wave of in-flight file jobs, so
	// dropping more files mid-wave raises the count and the percent recomputes live.
	import { backOut } from 'svelte/easing';
	import { scale } from 'svelte/transition';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { indexing, indexingActive, indexingPercent } from './indexing.svelte';

	const active = $derived(indexingActive());
	const percent = $derived(indexingPercent());
	const count = $derived(indexing.total);
</script>

{#if active}
	<div
		class="indexing-toast"
		transition:scale={reducedMotion()
			? { duration: 0 }
			: { duration: 180, start: 0.94, easing: backOut, opacity: 0 }}
	>
		<span class="spinner"></span>
		Indexing {count} file{count === 1 ? '' : 's'}… {percent}%
	</div>
{/if}

<style>
	/* Sits just under the toolbar pill, same pill language as the Clean Up toast. */
	.indexing-toast {
		position: absolute;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 46;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		font-size: 12px;
		color: var(--c-ink);
		pointer-events: none;
		font-variant-numeric: tabular-nums;
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
		to {
			transform: rotate(360deg);
		}
	}
</style>
