<script lang="ts">
	import '$lib/theme/tokens.css';
	import Sidebar from '$lib/Sidebar.svelte';
	import ThemeToggle from '$lib/theme/ThemeToggle.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { onMount } from 'svelte';
	import { apiJson } from '$lib/api';
	import { settings } from '$lib/canvas/store.svelte';

	let { children } = $props();

	$effect(() => {
		document.documentElement.setAttribute('data-theme', settings.theme);
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

<ThemeToggle />
<Sidebar />

<div class="content">
	{@render children()}
</div>

<style>
	/* nudge content right to not overlap the collapsed sidebar (56px) */
	.content {
		padding-left: 56px;
		height: 100vh;
		/* overflow managed per-page:
		   canvas = overflow:hidden (Svelte Flow needs it)
		   other pages = overflow:auto (scrollable) */
		overflow: auto;
	}
</style>
