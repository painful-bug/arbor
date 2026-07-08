<script lang="ts">
	import { testConnection, type Provider } from '$lib/ai/client';
	import { apiJson, apiPut } from '$lib/api';
	import { DEFAULT_MODELS, persistSettings, settings } from '$lib/canvas/store.svelte';

	// One keyed provider's settings block: API key save, connection test, model name.
	// Keys go straight to the backend keychain; the UI only ever sees `exists`.
	let { provider }: { provider: { id: Provider; name: string; block: string } } = $props();

	type Status = 'idle' | 'saving' | 'saved' | 'error';
	type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

	let key = $state('');
	let keyExists = $state(false);
	let saveStatus = $state<Status>('idle');
	let testStatus = $state<TestStatus>('idle');
	let testError = $state('');

	$effect(() => {
		(async () => {
			try {
				const { exists } = await apiJson<{ exists: boolean }>(`/api/keys/${provider.id}`);
				keyExists = exists;
			} catch {
				/* backend unreachable */
			}
		})();
	});

	async function save() {
		saveStatus = 'saving';
		try {
			// Trim whitespace/newlines a paste can carry along — an untrimmed key
			// saves "successfully" but fails every real call.
			await apiPut(`/api/keys/${provider.id}`, { key: key.trim() });
			keyExists = true;
			saveStatus = 'saved';
		} catch {
			saveStatus = 'error';
		}
		setTimeout(() => (saveStatus = 'idle'), 2000);
	}

	async function test() {
		testStatus = 'testing';
		testError = '';
		const err = await testConnection(provider.id);
		if (err) {
			testStatus = 'fail';
			testError = err;
		} else {
			testStatus = 'ok';
		}
		setTimeout(() => (testStatus = 'idle'), 4000);
	}
</script>

<div class="key-card" style="--accent: var(--block-{provider.block})">
	<div class="key-card-head">
		<span class="kc-name">{provider.name}</span>
		<button
			class="test-btn"
			class:ok={testStatus === 'ok'}
			class:fail={testStatus === 'fail'}
			onclick={test}
			disabled={testStatus === 'testing'}
		>
			{testStatus === 'testing' ? 'Testing…'
				: testStatus === 'ok' ? 'Connected ✓'
				: testStatus === 'fail' ? 'Failed ✕'
				: 'Test'}
		</button>
	</div>
	<div class="field">
		<label for="{provider.id}-key">API key</label>
		<div class="input-row">
			<input
				id="{provider.id}-key"
				type="password"
				placeholder={keyExists ? '•••••••• saved' : 'sk-…'}
				bind:value={key}
				autocomplete="off"
				spellcheck="false"
			/>
			<button class="btn-primary" onclick={save} disabled={!key || saveStatus === 'saving'}>
				{saveStatus === 'saved' ? 'Saved ✓' : saveStatus === 'error' ? 'Error' : 'Save'}
			</button>
		</div>
	</div>
	<div class="field">
		<label for="{provider.id}-model">Model</label>
		<input
			id="{provider.id}-model"
			type="text"
			placeholder={DEFAULT_MODELS[provider.id]}
			bind:value={settings.models[provider.id]}
			oninput={persistSettings}
			autocomplete="off"
			spellcheck="false"
		/>
	</div>
	{#if testStatus === 'fail' && testError}
		<p class="test-error">{testError}</p>
	{/if}
</div>

<style>
	.key-card {
		display: flex;
		flex-direction: column;
		gap: var(--s-sm);
		padding: var(--s-md);
		border: 1px solid var(--c-hairline);
		border-top: 3px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--c-canvas);
	}
	.key-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.kc-name {
		font-size: 14px;
		font-weight: 600;
	}
	.test-btn {
		font-family: var(--font-mono);
		font-size: 11px;
		padding: 3px 10px;
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-full);
		background: transparent;
		color: var(--c-ink);
		cursor: pointer;
		transition: background 160ms ease, border-color 160ms ease, transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.test-btn:active:not(:disabled) { transform: scale(0.96); }
	.test-btn:disabled { opacity: 0.5; cursor: default; }
	.test-btn.ok { background: var(--block-mint); border-color: transparent; }
	.test-btn.fail { background: var(--block-coral); border-color: transparent; }
	.test-error {
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.4;
		color: #a02020;
		word-break: break-word;
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
	.input-row {
		display: flex;
		gap: var(--s-xs);
	}
	input[type='password'],
	input[type='text'] {
		flex: 1;
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
		min-width: 0;
	}
	input[type='password']:focus,
	input[type='text']:focus {
		border-color: var(--c-ink);
		box-shadow: 0 0 0 3px rgba(var(--ink-rgb), 0.08);
	}
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
		transition: opacity var(--ease-glass), transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
		flex-shrink: 0;
	}
	.btn-primary:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn-primary:disabled {
		opacity: 0.3;
		cursor: default;
	}
</style>
