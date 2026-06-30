<script lang="ts">
	import '$lib/theme/tokens.css';
	import Sidebar from '$lib/Sidebar.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { apiJson } from '$lib/api';
	import { settings, ui } from '$lib/canvas/store.svelte';
	import { checkForUpdates, registerOnAction } from '$lib/updates/store.svelte';

	let { children } = $props();

	$effect(() => {
		document.documentElement.setAttribute('data-theme', settings.theme);
	});

	// Auto-update: register the notification click handler, check at startup, then
	// re-check every 6 hours. ponytail: fixed interval; make configurable if asked.
	onMount(() => {
		registerOnAction(async () => {
			const { getCurrentWindow } = await import('@tauri-apps/api/window');
			await getCurrentWindow().setFocus();
			await goto('/settings#updates');
		});
		void checkForUpdates(true);
		const id = setInterval(() => void checkForUpdates(true), 6 * 60 * 60 * 1000);
		return () => clearInterval(id);
	});

	// Dev sanity check: confirm the UI can reach the backend over the API.
	onMount(async () => {
		if (!import.meta.env.DEV) return;
		try {
			const ok = await apiJson<{ ok: boolean }>('/api/ping');
			console.log('[arbor] backend reachable:', ok);
		} catch (e) {
			console.error('[arbor] backend unreachable:', e);
		}
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!-- Full-width drag strip behind sidebar and toolbar (z-index 30).
     data-tauri-drag-region makes the empty titlebar area drag the window.
     Double-click triggers macOS zoom/restore natively. -->
<div class="titlebar-drag" data-tauri-drag-region></div>

<Sidebar />

<div class="content" class:sidebar-expanded={ui.sidebarExpanded}>
	{@render children()}
</div>

<style>
	/* Drag region spanning the full titlebar band.
	   z-index 30 keeps it behind the sidebar (100) and toolbar (40):
	   the sidebar and toolbar buttons get mouse events first; the drag strip
	   catches everything else in the top 48px band (empty chrome areas).
	   data-tauri-drag-region requires core:window:allow-start-dragging permission. */
	.titlebar-drag {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 48px;
		z-index: 30;
	}

	/* nudge content right to not overlap the collapsed sidebar (100px).
	   Transitions in sync with the sidebar width animation so the toolbar
	   re-centers correctly when the sidebar expands to 200px. */
	.content {
		padding-left: 100px;
		height: 100vh;
		transition: padding-left var(--spring-snappy);
		/* overflow managed per-page:
		   canvas = overflow:hidden (Svelte Flow needs it)
		   other pages = overflow:auto (scrollable) */
		overflow: auto;
	}
	.content.sidebar-expanded {
		padding-left: 200px;
	}
</style>
