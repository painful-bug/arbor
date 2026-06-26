<script lang="ts">
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';

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

	let text = $state('');
	let input = $state<HTMLTextAreaElement>();

	$effect(() => {
		input?.focus();
	});

	function submit() {
		const t = text.trim();
		if (t) onsubmit(t);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			oncancel();
		}
	}
</script>

<!-- Liquid-Glass prompt bubble with bouncy spring entrance -->
<div
	class="bubble glass"
	style="left: {x}px; top: {y}px; z-index: {z}"
	in:scale={reducedMotion() ? { duration: 0 } : { duration: 420, start: 0.5, opacity: 0, easing: backOut }}
	out:scale={reducedMotion() ? { duration: 0 } : { duration: 160, start: 0.85, opacity: 0 }}
>
	<textarea
		bind:this={input}
		bind:value={text}
		{onkeydown}
		rows="1"
		{placeholder}
		onblur={() => !text.trim() && oncancel()}
	></textarea>
	<button class="send" onclick={submit} disabled={!text.trim()} aria-label="Send">↵</button>
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
	textarea {
		flex: 1;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: 16px;
		line-height: 1.4;
		max-height: 140px;
		padding: 8px 0;
		color: var(--c-ink);
	}
	.send {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: var(--r-full);
		border: none;
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 16px;
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.send:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.send:not(:disabled):active {
		transform: scale(0.9);
	}
</style>
