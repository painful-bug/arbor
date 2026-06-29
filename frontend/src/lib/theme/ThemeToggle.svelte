<script lang="ts">
	import { settings, persistSettings } from '$lib/canvas/store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	let btn = $state<HTMLButtonElement>();
	const isDark = $derived(settings.theme === 'dark');

	function toggle() {
		const next = isDark ? 'light' : 'dark';
		const apply = () => { settings.theme = next; persistSettings(); };

		if (!(document as any).startViewTransition || reducedMotion()) {
			apply();
			return;
		}

		const r = btn!.getBoundingClientRect();
		const x = r.left + r.width / 2;
		const y = r.top + r.height / 2;
		const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
		const goingDark = next === 'dark';

		if (!goingDark) document.documentElement.classList.add('vt-shrink');

		const vt = (document as any).startViewTransition(apply);
		vt.ready.then(() => {
			const frames = [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`];
			document.documentElement.animate(
				{ clipPath: goingDark ? frames : [...frames].reverse() },
				{
					duration: 500,
					easing: 'ease-in-out',
					pseudoElement: goingDark ? '::view-transition-new(root)' : '::view-transition-old(root)',
				}
			);
		});
		vt.finished.then(() => document.documentElement.classList.remove('vt-shrink'));
	}
</script>

<button
	bind:this={btn}
	class="theme-toggle glass"
	onclick={toggle}
	aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if isDark}
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor"/>
		</svg>
	{:else}
		<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
			<circle cx="12" cy="12" r="5" fill="currentColor"/>
			<path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
		</svg>
	{/if}
</button>

<style>
	.theme-toggle {
		position: fixed;
		top: 16px;
		right: 68px;
		z-index: 50;
		width: 32px;
		height: 32px;
		border-radius: var(--r-full);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--c-ink);
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.theme-toggle:active {
		transform: scale(0.88);
	}
</style>
