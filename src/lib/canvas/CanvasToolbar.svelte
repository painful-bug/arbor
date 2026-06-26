<script lang="ts">
	// Collapsible toolbar pinned to the top of the canvas. Deep Research is the first
	// tool; add more buttons here as they land.
	import { popOutWindow } from '$lib/web';
	let { onDeepResearch }: { onDeepResearch: () => void } = $props();
	let open = $state(true);
</script>

<div class="toolbar" class:open>
	<button class="toggle" onclick={() => (open = !open)} aria-label={open ? 'Collapse toolbar' : 'Expand toolbar'} title="Toolbar">
		{open ? '⌃' : '⌄'}
	</button>
	{#if open}
		<div class="tools">
			<button class="tool" onclick={onDeepResearch} title="Plan and search real research papers">
				<span class="ico">🔬</span> Deep Research
			</button>
			<button class="tool" onclick={() => popOutWindow('https://www.youtube.com')} title="Open a browsable YouTube window">
				<span class="ico">▶</span> Browse YouTube
			</button>
		</div>
	{/if}
</div>

<style>
	.toolbar {
		position: absolute;
		top: 12px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
	}
	.toggle {
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r-full, 999px);
		background: transparent;
		cursor: pointer;
		font-size: 13px;
		color: var(--c-ink);
	}
	.toggle:hover {
		background: rgba(0, 0, 0, 0.06);
	}
	.tools {
		display: flex;
		gap: 4px;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border: none;
		border-radius: var(--r-pill, 999px);
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: transform var(--ease-glass, 0.15s);
	}
	.tool:active {
		transform: scale(0.96);
	}
	.ico {
		font-size: 14px;
	}
</style>
