<script lang="ts">
	import { settings, persistSettings } from '$lib/canvas/store.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { Moon, Sun } from '@lucide/svelte';

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
		<Moon size={18} />
	{:else}
		<Sun size={18} />
	{/if}
</button>

<style>
	.theme-toggle {
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
