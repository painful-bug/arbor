<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ui, newCanvas } from '$lib/canvas/store.svelte';

	let expanded = $state(false);
	const onCanvas = $derived($page.url.pathname === '/');

	async function showCanvas() {
		if ($page.url.pathname !== '/') await goto('/');
		ui.view = 'canvas';
	}

	async function showLibrary() {
		if ($page.url.pathname !== '/') await goto('/');
		ui.view = 'library';
	}

	async function createCanvas() {
		if ($page.url.pathname !== '/') await goto('/');
		newCanvas();
		ui.view = 'canvas';
	}

	function canvasIcon() {
		return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2" y="2" width="7" height="7" rx="2" fill="currentColor" opacity="0.85"/>
			<rect x="11" y="2" width="7" height="7" rx="2" fill="currentColor" opacity="0.45"/>
			<rect x="2" y="11" width="7" height="7" rx="2" fill="currentColor" opacity="0.45"/>
			<rect x="11" y="11" width="7" height="7" rx="2" fill="currentColor" opacity="0.85"/>
		</svg>`;
	}

	function settingsIcon() {
		return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="10" cy="10" r="2.5" stroke="currentColor" stroke-width="1.5"/>
			<path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.22 4.22l1.42 1.42M14.36 14.36l1.42 1.42M4.22 15.78l1.42-1.42M14.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>`;
	}

	function libraryIcon() {
		return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<rect x="2.5" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="1.5"/>
			<rect x="8" y="3" width="4" height="14" rx="1" stroke="currentColor" stroke-width="1.5"/>
			<path d="M14 4.5l3 0.8 2.4 13.6-3-0.8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
		</svg>`;
	}

	function plusIcon() {
		return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
		</svg>`;
	}
</script>

<aside class="sidebar glass" class:expanded>
	<!-- toggle -->
	<button
		class="toggle"
		onclick={() => (expanded = !expanded)}
		aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
	>
		{#if expanded}
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path d="M11 4L6 9l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		{:else}
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<path d="M7 4l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		{/if}
	</button>

	<!-- wordmark — only when expanded -->
	{#if expanded}
		<div class="wordmark">Loom</div>
	{/if}

	<nav>
		<button class="nav-item" class:active={onCanvas && ui.view === 'canvas'} onclick={showCanvas}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<span class="icon">{@html canvasIcon()}</span>
			{#if expanded}<span class="label">Canvas</span>{/if}
		</button>

		<button class="nav-item" class:active={onCanvas && ui.view === 'library'} onclick={showLibrary}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<span class="icon">{@html libraryIcon()}</span>
			{#if expanded}<span class="label">Library</span>{/if}
		</button>

		<button class="nav-item" onclick={createCanvas}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<span class="icon">{@html plusIcon()}</span>
			{#if expanded}<span class="label">New canvas</span>{/if}
		</button>

		<a href="/settings" class="nav-item" class:active={$page.url.pathname === '/settings'}>
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			<span class="icon">{@html settingsIcon()}</span>
			{#if expanded}<span class="label">Settings</span>{/if}
		</a>
	</nav>
</aside>

<style>
	.sidebar {
		position: fixed;
		left: 0;
		top: 0;
		bottom: 0;
		z-index: 100;
		width: 56px;
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
		padding: var(--s-md) var(--s-xs);
		transition: width var(--spring-snappy);
		/* override glass to stay opaque-ish on the pure white canvas */
		background: rgba(248, 248, 248, 0.82);
		border-right: 1px solid var(--c-hairline);
		border-radius: 0;
	}
	.sidebar.expanded {
		width: 200px;
	}
	/* macOS traffic-light area padding */
	@supports (-webkit-appearance: none) {
		.sidebar {
			padding-top: calc(var(--s-md) + 28px);
		}
	}

	.wordmark {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.5px;
		padding: 0 var(--s-xs) var(--s-xs);
		color: var(--c-ink);
	}

	.toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		border-radius: var(--r-full);
		border: none;
		background: transparent;
		color: var(--c-ink);
		cursor: pointer;
		transition: background var(--ease-glass);
		flex-shrink: 0;
	}
	.toggle:hover {
		background: var(--c-hairline-soft);
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		width: 100%;
		padding: 9px var(--s-xs);
		border: none;
		border-radius: var(--r-md);
		background: transparent;
		text-align: left;
		text-decoration: none;
		color: rgba(0, 0, 0, 0.55);
		font-family: var(--font-sans);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: background var(--ease-glass), color var(--ease-glass);
		white-space: nowrap;
		overflow: hidden;
	}
	.nav-item:hover {
		background: var(--c-hairline-soft);
		color: var(--c-ink);
	}
	.nav-item.active {
		background: var(--c-primary);
		color: var(--c-on-primary);
	}

	.icon {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 36px;
		height: 36px;
	}

	.label {
		flex: 1;
		min-width: 0;
	}
</style>
