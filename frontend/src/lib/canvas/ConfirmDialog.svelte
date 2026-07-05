<script lang="ts">
	// Tiny confirm dialog: backdrop + centered card. Used for the unsaved-edits
	// prompt (Save / Discard / Cancel) when replacing or closing a dirty pane.
	import { popScale, overlayFade } from '$lib/theme/animations';

	let {
		title,
		message = '',
		confirmLabel = 'Save',
		discardLabel,
		cancelLabel = 'Cancel',
		onconfirm,
		ondiscard,
		oncancel,
	}: {
		title: string;
		message?: string;
		confirmLabel?: string;
		discardLabel?: string;
		cancelLabel?: string;
		onconfirm: () => void;
		ondiscard?: () => void;
		oncancel: () => void;
	} = $props();

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); oncancel(); }
		else if (e.key === 'Enter') { e.preventDefault(); onconfirm(); }
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="cd-backdrop" transition:overlayFade onpointerdown={oncancel}>
	<div
		class="cd-card"
		role="alertdialog"
		aria-modal="true"
		aria-label={title}
		tabindex="-1"
		transition:popScale
		onpointerdown={(e) => e.stopPropagation()}
	>
		<div class="cd-title">{title}</div>
		{#if message}<div class="cd-msg">{message}</div>{/if}
		<div class="cd-actions">
			<button class="cd-btn" onclick={oncancel}>{cancelLabel}</button>
			<span class="cd-spacer"></span>
			{#if discardLabel && ondiscard}
				<button class="cd-btn cd-discard" onclick={ondiscard}>{discardLabel}</button>
			{/if}
			<button class="cd-btn cd-confirm" onclick={onconfirm}>{confirmLabel}</button>
		</div>
	</div>
</div>

<style>
	.cd-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.28);
	}
	.cd-card {
		width: min(400px, 90vw);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--elev-float, 0 18px 50px rgba(0, 0, 0, 0.25));
		padding: 20px;
	}
	.cd-title { font-weight: 600; font-size: 15px; color: var(--c-ink); }
	.cd-msg { margin-top: 8px; font-size: 13px; line-height: 1.5; color: rgba(var(--ink-rgb), 0.65); }
	.cd-actions { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
	.cd-spacer { flex: 1; }
	.cd-btn {
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 9px;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
	}
	.cd-btn:hover { background: rgba(var(--ink-rgb), 0.06); }
	.cd-discard { color: rgb(220, 60, 60); border-color: transparent; background: transparent; }
	.cd-confirm { background: var(--c-primary); color: var(--c-on-primary); border-color: transparent; }
</style>
