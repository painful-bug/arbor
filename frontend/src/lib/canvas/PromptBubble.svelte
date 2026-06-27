<script lang="ts">
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import Composer from './Composer.svelte';

	let {
		x,
		y,
		z = 50,
		placeholder = 'Ask anything…',
		onsubmit,
		oncancel
	}: {
		x: number;
		y: number;
		z?: number;
		placeholder?: string;
		onsubmit: (text: string) => void;
		oncancel: () => void;
	} = $props();

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') oncancel();
	}
</script>

<!-- Liquid-Glass prompt bubble with bouncy spring entrance -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="bubble glass"
	style="left: {x}px; top: {y}px; z-index: {z}"
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 420, start: 0.5, opacity: 0, easing: backOut }}
	out:scale={reducedMotion() ? { duration: 0 } : { duration: 160, start: 0.85, opacity: 0 }}
	{onkeydown}
>
	<Composer
		{placeholder}
		focusOnMount
		onsend={onsubmit}
		onblurempty={oncancel}
	/>
</div>

<style>
	.bubble {
		position: fixed;
		transform: translate(-50%, -50%);
		z-index: 50;
		display: flex;
		align-items: flex-end;
		gap: var(--s-xs);
		padding: var(--s-xs) var(--s-xs) var(--s-xs) var(--s-md);
		border-radius: var(--r-pill);
		min-width: 320px;
	}
	/* Bubble uses 16px text and taller max-height than Composer defaults. */
	.bubble {
		--composer-font-size: 16px;
		--composer-max-height: 140px;
	}
</style>
