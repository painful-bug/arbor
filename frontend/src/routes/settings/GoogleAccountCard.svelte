<script lang="ts">
	import { onMount } from 'svelte';
	import { apiFetch, apiJson } from '$lib/api';
	import { canUseFs, openPath } from '$lib/files';
	import { pollDriveConnected } from '$lib/canvas/drive';

	type ConnectStatus = 'idle' | 'connecting' | 'error';
	type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

	let connected = $state(false);
	let email = $state<string | undefined>(undefined);
	let connectStatus = $state<ConnectStatus>('idle');
	let connectError = $state('');

	let showOverride = $state(false);
	let clientId = $state('');
	let clientSecret = $state('');
	let overrideStatus = $state<SaveStatus>('idle');

	async function refresh() {
		try {
			const body = await apiJson<{ connected: boolean; email?: string }>('/api/google/auth/status');
			connected = body.connected;
			email = body.email;
		} catch {
			/* backend unreachable */
		}
	}
	onMount(refresh);

	async function connect() {
		connectStatus = 'connecting';
		try {
			const res = await apiFetch('/api/google/auth/start', { method: 'POST' });
			if (!res.ok) throw new Error(`could not start Google auth (${res.status})`);
			const { authUrl } = (await res.json()) as { authUrl: string };
			if (canUseFs()) await openPath(authUrl);
			else window.open(authUrl, '_blank', 'noopener,noreferrer');
			const ok = await pollDriveConnected();
			if (ok) {
				connectStatus = 'idle';
				await refresh();
			} else {
				connectStatus = 'error';
				connectError = 'Timed out waiting for Google sign-in.';
			}
		} catch (err) {
			connectStatus = 'error';
			connectError = String((err as Error)?.message ?? err);
		}
	}

	async function disconnect() {
		await apiFetch('/api/google/auth', { method: 'DELETE' });
		await refresh();
	}

	async function saveOverride() {
		overrideStatus = 'saving';
		try {
			const res = await apiFetch('/api/google/client', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ clientId, clientSecret: clientSecret || undefined }),
			});
			overrideStatus = res.ok ? 'saved' : 'error';
		} catch {
			overrideStatus = 'error';
		}
		setTimeout(() => (overrideStatus = 'idle'), 2000);
	}
</script>

<section class="card">
	<h2>Google Drive</h2>
	<p class="sub">Connect a Google account to paste Drive, Docs, Sheets, or Slides links directly onto the canvas.</p>

	{#if connected}
		<div class="gd-status">
			<span class="gd-dot"></span>
			Connected{email ? ` as ${email}` : ''}
		</div>
		<button class="btn-ghost" onclick={disconnect}>Disconnect</button>
	{:else}
		<button class="btn-primary" disabled={connectStatus === 'connecting'} onclick={connect}>
			{connectStatus === 'connecting' ? 'Connecting…' : connectStatus === 'error' ? 'Retry' : 'Connect Google Drive'}
		</button>
		{#if connectStatus === 'error'}<p class="warn">{connectError}</p>{/if}
	{/if}

	<details bind:open={showOverride}>
		<summary>Use your own OAuth client</summary>
		<div class="override">
			<p class="sub">Only needed if Arbor's shared client isn't available for your account yet.</p>
			<div class="field">
				<label for="gd-client-id">Client ID</label>
				<input
					id="gd-client-id"
					bind:value={clientId}
					placeholder="xxxx.apps.googleusercontent.com"
					autocomplete="off"
					spellcheck="false"
				/>
			</div>
			<div class="field">
				<label for="gd-client-secret">Client secret (optional for installed-app clients)</label>
				<input id="gd-client-secret" type="password" bind:value={clientSecret} autocomplete="off" spellcheck="false" />
			</div>
			<button class="btn-primary" disabled={!clientId || overrideStatus === 'saving'} onclick={saveOverride}>
				{overrideStatus === 'saved' ? 'Saved ✓' : overrideStatus === 'error' ? 'Error' : 'Save'}
			</button>
		</div>
	</details>
</section>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--s-md);
		padding: var(--s-lg);
		background: var(--c-surface-soft);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
	}
	h2 {
		font-size: 15px;
		font-weight: 600;
		margin: 0;
		letter-spacing: -0.2px;
	}
	.sub {
		font-size: 13px;
		color: rgba(var(--ink-rgb), 0.5);
		margin: 0;
		line-height: 1.5;
	}
	.gd-status {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
	}
	.gd-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--block-mint, #2ecc71);
		display: inline-block;
	}
	.warn {
		font-size: 12px;
		line-height: 1.4;
		color: #a05a00;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	label {
		font-size: 12px;
		font-weight: 500;
		color: rgba(var(--ink-rgb), 0.5);
		letter-spacing: 0.1px;
	}
	input {
		height: 36px;
		padding: 0 var(--s-sm);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		font-family: var(--font-mono);
		font-size: 13px;
		background: var(--c-canvas);
		color: var(--c-ink);
		outline: none;
		transition: border-color var(--ease-glass);
	}
	input:focus { border-color: var(--c-ink); }
	.btn-primary {
		height: 36px;
		padding: 0 var(--s-md);
		border: 1px solid var(--c-ink);
		border-radius: var(--r-md);
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity var(--ease-glass);
		align-self: flex-start;
	}
	.btn-primary:disabled { opacity: 0.3; cursor: default; }
	.btn-ghost {
		align-self: flex-start;
		height: 32px;
		padding: 0 var(--s-md);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		background: transparent;
		color: var(--c-ink);
		font-size: 13px;
		cursor: pointer;
		transition: border-color var(--ease-glass);
	}
	.btn-ghost:hover { border-color: var(--c-ink); }
	summary {
		cursor: pointer;
		font-size: 13px;
		font-weight: 500;
		color: var(--c-ink);
	}
	.override {
		display: flex;
		flex-direction: column;
		gap: var(--s-sm);
		margin-top: var(--s-sm);
	}
</style>
