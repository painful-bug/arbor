<script lang="ts">
	// Shown when a Drive/Docs/Sheets/Slides link is pasted but Google isn't
	// connected yet. Connect opens the OAuth consent page in the OS browser
	// (never an embedded webview — Google blocks embedded-webview OAuth) and
	// polls until the loopback exchange completes.
	import { popScale, overlayFade } from '$lib/theme/animations';
	import { canUseFs, openPath } from '$lib/files';
	import { pollDriveConnected, startDriveConnect } from './drive';

	let { onconnected, oncancel }: { onconnected: () => void; oncancel: () => void } = $props();

	let connectState = $state<'idle' | 'connecting' | 'error'>('idle');
	let errorMsg = $state('');

	async function connect() {
		connectState = 'connecting';
		try {
			const authUrl = await startDriveConnect();
			if (canUseFs()) await openPath(authUrl);
			else window.open(authUrl, '_blank', 'noopener,noreferrer');
			const ok = await pollDriveConnected();
			if (ok) onconnected();
			else {
				connectState = 'error';
				errorMsg = 'Timed out waiting for Google sign-in.';
			}
		} catch (err) {
			connectState = 'error';
			errorMsg = String((err as Error)?.message ?? err);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dc-backdrop" transition:overlayFade onpointerdown={oncancel}>
	<div
		class="dc-card"
		role="alertdialog"
		aria-modal="true"
		aria-label="Connect Google Drive"
		tabindex="-1"
		transition:popScale
		onpointerdown={(e) => e.stopPropagation()}
	>
		<div class="dc-title">Connect Google Drive</div>
		<div class="dc-msg">
			{#if connectState === 'connecting'}
				Waiting for Google sign-in in your browser…
			{:else if connectState === 'error'}
				{errorMsg}
			{:else}
				Sign in with Google to import this file. Arbor only requests read-only Drive access.
			{/if}
		</div>
		<div class="dc-actions">
			<button class="dc-btn" onclick={oncancel}>Cancel</button>
			<span class="dc-spacer"></span>
			<button class="dc-btn dc-confirm" disabled={connectState === 'connecting'} onclick={connect}>
				{connectState === 'error' ? 'Retry' : 'Connect'}
			</button>
		</div>
	</div>
</div>

<style>
	.dc-backdrop {
		position: fixed;
		inset: 0;
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.28);
	}
	.dc-card {
		width: min(400px, 90vw);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		border-radius: 14px;
		box-shadow: var(--elev-float, 0 18px 50px rgba(0, 0, 0, 0.25));
		padding: 20px;
	}
	.dc-title { font-weight: 600; font-size: 15px; color: var(--c-ink); }
	.dc-msg { margin-top: 8px; font-size: 13px; line-height: 1.5; color: rgba(var(--ink-rgb), 0.65); }
	.dc-actions { display: flex; align-items: center; gap: 8px; margin-top: 20px; }
	.dc-spacer { flex: 1; }
	.dc-btn {
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 9px;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
	}
	.dc-btn:hover { background: rgba(var(--ink-rgb), 0.06); }
	.dc-btn:disabled { opacity: 0.6; cursor: default; }
	.dc-confirm { background: var(--c-primary); color: var(--c-on-primary); border-color: transparent; }
</style>
