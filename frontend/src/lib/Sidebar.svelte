<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { ui, newCanvas } from '$lib/canvas/store.svelte';
	import { hasUpdate } from '$lib/updates/store.svelte';
	import { LayoutGrid, Library as LibraryIcon, Plus, Settings } from '@lucide/svelte';

	const onCanvas = $derived($page.url.pathname === '/');
	const updateReady = $derived(hasUpdate());

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

</script>

<aside class="sidebar" class:expanded={ui.sidebarExpanded}>
	<!-- Traffic-light safe zone — drag region so this strip drags the window.
	     The toggle button sits inside and stays clickable (Tauri hit-tests buttons first). -->
	<div class="tl-zone" data-tauri-drag-region>
	<!-- toggle -->
	<button
		class="nav-item toggle"
		onclick={() => (ui.sidebarExpanded = !ui.sidebarExpanded)}
		aria-label={ui.sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
	>
		<span class="icon">
			<svg width="24" height="24" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
				<path d="M14 22V14M14 14C14 10 9 9 9 5M14 14C14 10 19 9 19 5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"/>
				<circle cx="9" cy="5" fill="currentColor" r="2.5"/>
				<circle cx="19" cy="5" fill="currentColor" r="2.5"/>
				<circle cx="14" cy="22" fill="currentColor" r="2.5"/>
			</svg>
		</span>
		{#if ui.sidebarExpanded}<span class="label wordmark">Arbor</span>{/if}
	</button>
	</div><!-- end tl-zone -->

	<nav>
		<button class="nav-item" class:active={onCanvas && ui.view === 'canvas'} onclick={showCanvas}>
			<span class="icon"><LayoutGrid size={22} strokeWidth={1.75} /></span>
			{#if ui.sidebarExpanded}<span class="label">Canvas</span>{/if}
		</button>

		<button class="nav-item" class:active={onCanvas && ui.view === 'library'} onclick={showLibrary}>
			<span class="icon"><LibraryIcon size={22} strokeWidth={1.75} /></span>
			{#if ui.sidebarExpanded}<span class="label">Library</span>{/if}
		</button>

		<button class="nav-item" onclick={createCanvas}>
			<span class="icon"><Plus size={22} strokeWidth={1.75} /></span>
			{#if ui.sidebarExpanded}<span class="label">New canvas</span>{/if}
		</button>

		<a href="/settings" class="nav-item" class:active={$page.url.pathname === '/settings'} style="margin-top: auto">
			<span class="icon">
				<Settings size={22} strokeWidth={1.75} />
				{#if updateReady}<span class="update-dot" aria-label="Update available"></span>{/if}
			</span>
			{#if ui.sidebarExpanded}<span class="label">Settings</span>{/if}
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
		/* 100px: wide enough to fully contain macOS Sequoia traffic lights (~89px from edge).
		   The sidebar icon rail centers within this width when collapsed. */
		width: 100px;
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
		/* Top padding = 0; tl-zone handles that space */
		padding: 0 var(--s-xs) var(--s-md);
		box-sizing: border-box;
		transition: width var(--spring-snappy);
		/* Tinted layer over NSVisualEffect Sidebar vibrancy.
		   Semi-transparent so the blur material shows depth;
		   colored to match the app theme rather than default macOS grey. */
		background: var(--c-sidebar);
		border-right: 1px solid var(--c-hairline);
		border-radius: 0;
		overflow: hidden;
	}
	.sidebar.expanded {
		width: 200px;
	}

	/* Traffic-light safe zone: reserves 48px for the native window controls.
	   data-tauri-drag-region on this element lets the user drag the window by
	   clicking the empty area above the toggle button. */
	.tl-zone {
		width: 100%;
		/* 48px matches the drag strip in +layout.svelte */
		padding-top: 48px;
		box-sizing: border-box;
		/* ponytail: no extra background — inherits sidebar transparency */
	}

	/* toggle glyph keeps full-ink color; wordmark sits in its label slot */
	.toggle {
		color: var(--c-ink);
		margin-bottom: var(--s-xs);
	}
	.wordmark {
		font-size: 22px;
		font-weight: 700;
		letter-spacing: -0.5px;
		color: var(--c-ink);
	}

	nav {
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex: 1;
		padding-top: 4px;
	}

	/* one uniform rail button: --nav-btn square (collapsed), grows to a row when ui.sidebarExpanded */
	.nav-item {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--s-sm);
		width: 100%;
		height: var(--nav-btn);
		padding: 0;
		border: none;
		border-radius: var(--nav-radius);
		background: transparent;
		text-align: left;
		text-decoration: none;
		color: rgba(var(--ink-rgb), 0.55);
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

	/* Collapsed: compact rounded-square highlight on the icon only */
	.sidebar:not(.expanded) .nav-item {
		background: transparent;
	}
	.sidebar:not(.expanded) .nav-item:hover {
		background: transparent;
	}
	.sidebar:not(.expanded) .nav-item:hover .icon {
		background: var(--c-hairline-soft);
	}
	.sidebar:not(.expanded) .nav-item.active {
		background: transparent;
	}
	.sidebar:not(.expanded) .nav-item.active .icon {
		background: var(--c-primary);
	}

	/* expanded: glyph + label as a left-aligned row */
	.sidebar.expanded .nav-item {
		justify-content: flex-start;
	}

	.icon {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: var(--nav-btn);
		height: var(--nav-btn);
		border-radius: var(--nav-radius);
		transition: background var(--ease-glass);
	}

	/* Update-available indicator on the settings gear — persists until updated. */
	.update-dot {
		position: absolute;
		top: 6px;
		right: 6px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--c-accent-magenta);
		box-shadow: 0 0 0 2px var(--c-surface-soft);
	}

	.label {
		flex: 1;
		min-width: 0;
	}
</style>
