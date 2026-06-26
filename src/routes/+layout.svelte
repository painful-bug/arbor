<script lang="ts">
	import '$lib/theme/tokens.css';
	import Sidebar from '$lib/Sidebar.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

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
