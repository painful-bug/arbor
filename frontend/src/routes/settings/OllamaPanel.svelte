<script lang="ts">
	import { apiJson } from '$lib/api';
	import { persistSettings, settings } from '$lib/canvas/store.svelte';

	// Ollama section: local model list, active-model picker, and pull-with-progress
	// (SSE stream from the backend's ollama pull route).
	let models = $state<string[]>([]);
	let pullModel = $state('');
	type PullStatus = 'idle' | 'pulling' | 'done' | 'error';
	let pullStatus = $state<PullStatus>('idle');
	let pullProgress = $state('');

	$effect(() => {
		(async () => {
			try {
				const data = await apiJson<{ models: string[] }>('/api/ollama/models');
				models = data.models ?? [];
				if (models.length && !settings.models['ollama']) {
					settings.models['ollama'] = models[0];
					persistSettings();
				}
			} catch {
				/* ollama not running */
			}
		})();
	});

	async function pull() {
		if (!pullModel.trim() || pullStatus === 'pulling') return;
		pullStatus = 'pulling';
		pullProgress = '';
		const { apiFetch } = await import('$lib/api');
		try {
			const res = await apiFetch('/api/ollama/pull', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: pullModel.trim() })
			});
			if (!res || !res.body) { pullStatus = 'error'; pullProgress = 'Backend unreachable'; return; }
			const reader = res.body.getReader();
			const dec = new TextDecoder();
			let buf = '';
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				const parts = buf.split('\n\n');
				buf = parts.pop()!;
				for (const part of parts) {
					const line = part.replace(/^data: /, '').trim();
					if (!line) continue;
					const ev = JSON.parse(line) as { type: string; text?: string; message?: string };
					if (ev.type === 'progress' && ev.text) pullProgress = ev.text;
					else if (ev.type === 'done') {
						pullStatus = 'done';
						pullProgress = 'Download complete!';
						const data = await apiJson<{ models: string[] }>('/api/ollama/models');
						models = data.models ?? [];
						setTimeout(() => { pullStatus = 'idle'; pullModel = ''; }, 3000);
						return;
					} else if (ev.type === 'error') {
						pullStatus = 'error';
						pullProgress = ev.message ?? 'Pull failed';
						return;
					}
				}
			}
		} catch (err) {
			pullStatus = 'error';
			pullProgress = String(err);
		}
	}
</script>

<section class="card">
	<h2>Ollama (Local)</h2>
	<p class="sub">Run models locally via Ollama. Requires <code>ollama</code> running on your Mac.</p>
	{#if models.length > 0}
		<div class="field">
			<label for="ollama-model-select">Active model</label>
			<select id="ollama-model-select" class="select" bind:value={settings.models['ollama']} onchange={persistSettings}>
				{#each models as m (m)}
					<option value={m}>{m}</option>
				{/each}
			</select>
		</div>
	{:else}
		<p class="sub muted">No models found — is Ollama running?</p>
	{/if}
	<div class="field">
		<label for="ollama-pull-input">Download a model</label>
		<div class="input-row">
			<input
				id="ollama-pull-input"
				type="text"
				placeholder="e.g. llama3.2, mistral, gemma3"
				bind:value={pullModel}
				autocomplete="off"
				spellcheck="false"
				onkeydown={(e) => e.key === 'Enter' && pull()}
			/>
			<button
				class="btn-primary"
				onclick={pull}
				disabled={!pullModel.trim() || pullStatus === 'pulling'}
				class:done={pullStatus === 'done'}
				class:error={pullStatus === 'error'}
			>
				{pullStatus === 'pulling' ? 'Pulling…' : pullStatus === 'done' ? 'Done ✓' : pullStatus === 'error' ? 'Error' : 'Download'}
			</button>
		</div>
		{#if pullProgress}
			<p class="pull-progress" class:pull-error={pullStatus === 'error'}>{pullProgress}</p>
		{/if}
	</div>
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
	.muted {
		color: rgba(var(--ink-rgb), 0.35);
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
	input[type='text']:focus {
		border-color: var(--c-ink);
		box-shadow: 0 0 0 3px rgba(var(--ink-rgb), 0.08);
	}
	.select {
		height: 36px;
		padding: 0 32px 0 var(--s-sm);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		font-family: var(--font-sans);
		font-size: 13px;
		background: var(--c-canvas);
		color: var(--c-ink);
		outline: none;
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L6 7L11 1' stroke='%23999' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 12px center;
		cursor: pointer;
		transition: border-color var(--ease-glass);
		width: 100%;
	}
	.select:focus {
		border-color: var(--c-ink);
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
	.btn-primary.done {
		background: var(--block-mint);
		color: var(--c-ink);
		border-color: transparent;
	}
	.btn-primary.error {
		background: var(--block-coral);
		color: var(--c-ink);
		border-color: transparent;
	}
	code {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--c-hairline);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.pull-progress {
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.5);
		word-break: break-all;
	}
	.pull-progress.pull-error { color: #a02020; }
</style>
