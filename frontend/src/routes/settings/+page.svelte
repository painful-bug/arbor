<script lang="ts">
	import { onMount } from 'svelte';
	import { settings, persistSettings, purgeSemanticEdges, DEFAULT_MODELS } from '$lib/canvas/store.svelte';
	import { testConnection, PROVIDERS, type Provider } from '$lib/ai/client';
	import { WORKFLOWS } from '$lib/ai/workflows';
	import { apiJson, apiPut } from '$lib/api';
	import { updateState, checkForUpdates, installUpdate } from '$lib/updates/store.svelte';

	let appVersion = $state('');
	onMount(async () => {
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			appVersion = await getVersion();
		} catch {
			appVersion = ''; // browser dev
		}
		if (location.hash === '#updates') {
			document.getElementById('updates')?.scrollIntoView({ behavior: 'smooth' });
		}
	});

	const BLOCKS = ['lilac', 'lime', 'cream', 'pink', 'mint', 'coral'];
	const providers = PROVIDERS.map((p, i) => ({ ...p, block: BLOCKS[i % BLOCKS.length] }));
	const keyed = providers.filter((p) => p.requiresKey);

	type Status = 'idle' | 'saving' | 'saved' | 'error';
	type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

	let keys = $state<Record<string, string>>({});
	let keyExists = $state<Record<string, boolean>>({});
	let saveStatus = $state<Record<string, Status>>({});
	let testStatus = $state<Record<string, TestStatus>>({});
	let testError = $state<Record<string, string>>({});
	let tavilyKey = $state('');
	let tavilyStatus = $state<Status>('idle');

	$effect(() => {
		(async () => {
			for (const p of [...keyed.map((k) => k.id), 'tavily'] as string[]) {
				try {
					const { exists } = await apiJson<{ exists: boolean }>(`/api/keys/${p}`);
					keyExists[p] = exists;
				} catch {
					/* backend unreachable */
				}
			}
		})();
	});

	async function saveKey(provider: string, value: string): Promise<boolean> {
		try {
			await apiPut(`/api/keys/${provider}`, { key: value });
			keyExists[provider] = true;
			return true;
		} catch {
			return false;
		}
	}

	async function save(id: string) {
		saveStatus[id] = 'saving';
		saveStatus[id] = (await saveKey(id, keys[id] ?? '')) ? 'saved' : 'error';
		setTimeout(() => (saveStatus[id] = 'idle'), 2000);
	}

	async function test(id: Provider) {
		testStatus[id] = 'testing';
		testError[id] = '';
		const err = await testConnection(id);
		if (err) {
			testStatus[id] = 'fail';
			testError[id] = err;
		} else {
			testStatus[id] = 'ok';
		}
		setTimeout(() => (testStatus[id] = 'idle'), 4000);
	}

	async function saveTavily() {
		tavilyStatus = 'saving';
		tavilyStatus = (await saveKey('tavily', tavilyKey)) ? 'saved' : 'error';
		setTimeout(() => (tavilyStatus = 'idle'), 2000);
	}

	function onModelInput() {
		persistSettings();
	}

	// Auto-connect toggle: turning on backfills existing nodes; turning off asks
	// whether to drop the semantic edges already drawn.
	let showAutoConnectOff = $state(false);
	function onAutoConnectChange(e: Event) {
		const on = (e.currentTarget as HTMLInputElement).checked;
		settings.autoConnect = on;
		persistSettings();
		if (on) {
			void import('$lib/canvas/autolink').then((m) => m.autolinkAll());
		} else {
			showAutoConnectOff = true;
		}
	}
	function resolveAutoConnectOff(remove: boolean) {
		showAutoConnectOff = false;
		if (remove) void purgeSemanticEdges();
	}

	let ollamaModels = $state<string[]>([]);
	let ollamaPullModel = $state('');
	type PullStatus = 'idle' | 'pulling' | 'done' | 'error';
	let pullStatus = $state<PullStatus>('idle');
	let pullProgress = $state('');

	$effect(() => {
		(async () => {
			try {
				const data = await apiJson<{ models: string[] }>('/api/ollama/models');
				ollamaModels = data.models ?? [];
				if (ollamaModels.length && !settings.models['ollama']) {
					settings.models['ollama'] = ollamaModels[0];
					persistSettings();
				}
			} catch {
				/* ollama not running */
			}
		})();
	});

	async function pullModel() {
		if (!ollamaPullModel.trim() || pullStatus === 'pulling') return;
		pullStatus = 'pulling';
		pullProgress = '';
		const { apiFetch } = await import('$lib/api');
		try {
			const res = await apiFetch('/api/ollama/pull', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: ollamaPullModel.trim() })
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
						ollamaModels = data.models ?? [];
						setTimeout(() => { pullStatus = 'idle'; ollamaPullModel = ''; }, 3000);
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

<div class="page">
	<header>
		<h1>Settings</h1>
	</header>

	<div class="grid">

		<!-- Updates -->
		<section class="card" id="updates">
			<h2>Updates</h2>
			<p class="sub">
				Arbor checks GitHub for new releases automatically.{#if appVersion}
					Current version <strong>v{appVersion}</strong>.{/if}
			</p>
			{#if updateState.status === 'available'}
				<p class="upd-line">Update available: <strong>v{updateState.version}</strong></p>
				{#if updateState.notes}<p class="sub">{updateState.notes}</p>{/if}
				<button class="btn-primary" onclick={() => installUpdate()}>Update now</button>
			{:else if updateState.status === 'downloading'}
				<p class="upd-line">Downloading update…</p>
				<div class="upd-progress"><div class="upd-bar" style="width:{Math.round(updateState.progress * 100)}%"></div></div>
			{:else if updateState.status === 'ready'}
				<p class="upd-line">Installed — restarting…</p>
			{:else if updateState.status === 'error'}
				<p class="upd-line err">Update failed: {updateState.error}</p>
				<button class="btn-ghost" onclick={() => checkForUpdates(false)}>Retry</button>
			{:else}
				<p class="upd-line">{updateState.status === 'checking' ? 'Checking…' : "You're up to date."}</p>
				<button class="btn-ghost" onclick={() => checkForUpdates(false)} disabled={updateState.status === 'checking'}>
					Check for updates
				</button>
			{/if}
		</section>

		<!-- Default Workflow -->
		<section class="card">
			<h2>Default Workflow</h2>
			<p class="sub">System prompt new cards run under. Pick per-card on the canvas too.</p>
			<select class="select" bind:value={settings.workflow} onchange={persistSettings}>
				{#each WORKFLOWS as w (w.id)}
					<option value={w.id}>{w.label} — {w.description}</option>
				{/each}
			</select>
		</section>

		<!-- AI Model Provider -->
		<section class="card">
			<h2>AI Model Provider</h2>
			<p class="sub">Provider used for all new cards.</p>
			<select class="select" bind:value={settings.provider} onchange={persistSettings}>
				{#each providers as p (p.id)}
					<option value={p.id}>{p.name}{p.requiresKey ? '' : ' (local)'}</option>
				{/each}
			</select>
		</section>

		<!-- Appearance -->
		<section class="card">
			<h2>Appearance</h2>
			<p class="sub">Visual theme for the app.</p>
			<label class="toggle-row">
				<input type="checkbox" checked={settings.theme === 'dark'}
					onchange={() => { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; persistSettings(); }} />
				<span>Dark mode</span>
			</label>
		</section>

		<!-- Canvas -->
		<section class="card">
			<h2>Canvas</h2>
			<p class="sub">Grid and layout options.</p>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={settings.snapToGrid} onchange={persistSettings} />
				<span>Snap nodes to grid</span>
			</label>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={settings.cleanupSemantic} onchange={persistSettings} />
				<span>Use AI to refine Clean Up clusters</span>
			</label>
			<label class="toggle-row">
				<input type="checkbox" checked={settings.autoConnect} onchange={onAutoConnectChange} />
				<span>Auto-connect related cards, notes & files</span>
			</label>
			<p class="sub">Draws dashed links between items about the same topic, in the background as you work.</p>
		</section>

		<!-- Tools -->
		<section class="card">
			<h2>Tools</h2>
			<p class="sub">File read/write and web search are always available to the agent.</p>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={settings.bashEnabled} onchange={persistSettings} />
				<span>Enable shell (bash) tool</span>
			</label>
			{#if settings.bashEnabled}
				<p class="warn">⚠︎ The agent can run shell commands on your Mac. Only enable for tasks you trust.</p>
			{/if}
		</section>

		<!-- Ollama -->
		<section class="card">
			<h2>Ollama (Local)</h2>
			<p class="sub">Run models locally via Ollama. Requires <code>ollama</code> running on your Mac.</p>
			{#if ollamaModels.length > 0}
				<div class="field">
					<label for="ollama-model-select">Active model</label>
					<select id="ollama-model-select" class="select" bind:value={settings.models['ollama']} onchange={persistSettings}>
						{#each ollamaModels as m (m)}
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
						bind:value={ollamaPullModel}
						autocomplete="off"
						spellcheck="false"
						onkeydown={(e) => e.key === 'Enter' && pullModel()}
					/>
					<button
						class="btn-primary"
						onclick={pullModel}
						disabled={!ollamaPullModel.trim() || pullStatus === 'pulling'}
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

		<!-- Web Search -->
		<section class="card">
			<h2>Web Search</h2>
			<p class="sub">Let the agent search the web. <strong>Tavily is recommended</strong> — source-aware results with a key. DuckDuckGo is free but frequently rate-limits automated requests.</p>
			<label class="toggle-row">
				<input type="checkbox" bind:checked={settings.websearch.enabled} onchange={persistSettings} />
				<span>Enable web search</span>
			</label>
			{#if settings.websearch.enabled}
				<div class="field">
					<label for="ws-backend">Backend</label>
					<select id="ws-backend" class="select" bind:value={settings.websearch.backend} onchange={persistSettings}>
						<option value="tavily">Tavily — recommended (API key)</option>
						<option value="duckduckgo">DuckDuckGo (free, often rate-limited)</option>
					</select>
				</div>
				{#if settings.websearch.backend === 'tavily'}
					<div class="field">
						<label for="tavily-key">Tavily API key</label>
						<div class="input-row">
							<input
								id="tavily-key"
								type="password"
								placeholder={keyExists['tavily'] ? '•••••••• saved' : 'tvly-…'}
								bind:value={tavilyKey}
								autocomplete="off"
								spellcheck="false"
							/>
							<button class="btn-primary" onclick={saveTavily} disabled={!tavilyKey || tavilyStatus === 'saving'}>
								{tavilyStatus === 'saved' ? 'Saved ✓' : tavilyStatus === 'error' ? 'Error' : 'Save'}
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</section>

		<!-- API Keys & Models — full width -->
		<section class="card full">
			<h2>API Keys & Models</h2>
			<p class="sub">Keys stored in macOS Keychain — never leave your device. Model name persists locally.</p>
			<div class="key-grid">
				{#each keyed as p (p.id)}
					<div class="key-card" style="--accent: var(--block-{p.block})">
						<div class="key-card-head">
							<span class="kc-name">{p.name}</span>
							<button
								class="test-btn"
								class:ok={testStatus[p.id] === 'ok'}
								class:fail={testStatus[p.id] === 'fail'}
								onclick={() => test(p.id)}
								disabled={testStatus[p.id] === 'testing'}
							>
								{testStatus[p.id] === 'testing' ? 'Testing…'
									: testStatus[p.id] === 'ok' ? 'Connected ✓'
									: testStatus[p.id] === 'fail' ? 'Failed ✕'
									: 'Test'}
							</button>
						</div>
						<div class="field">
							<label for="{p.id}-key">API key</label>
							<div class="input-row">
								<input
									id="{p.id}-key"
									type="password"
									placeholder={keyExists[p.id] ? '•••••••• saved' : 'sk-…'}
									bind:value={keys[p.id]}
									autocomplete="off"
									spellcheck="false"
								/>
								<button
									class="btn-primary"
									onclick={() => save(p.id)}
									disabled={!keys[p.id] || saveStatus[p.id] === 'saving'}
								>
									{saveStatus[p.id] === 'saved' ? 'Saved ✓' : saveStatus[p.id] === 'error' ? 'Error' : 'Save'}
								</button>
							</div>
						</div>
						<div class="field">
							<label for="{p.id}-model">Model</label>
							<input
								id="{p.id}-model"
								type="text"
								placeholder={DEFAULT_MODELS[p.id]}
								bind:value={settings.models[p.id]}
								oninput={onModelInput}
								autocomplete="off"
								spellcheck="false"
							/>
						</div>
						{#if testStatus[p.id] === 'fail' && testError[p.id]}
							<p class="test-error">{testError[p.id]}</p>
						{/if}
					</div>
				{/each}
			</div>
		</section>

		<!-- Future -->
		<section class="card">
			<h2>Future</h2>
			<div class="future-list">
				<div class="future-item">
					<span class="f-title">Zotero Integration</span>
					<span class="f-badge">Coming soon</span>
				</div>
				<div class="future-item">
					<span class="f-title">iPad / Apple Pencil</span>
					<span class="f-badge">Coming soon</span>
				</div>
				<div class="future-item">
					<span class="f-title">Multiplayer Canvas</span>
					<span class="f-badge">Coming soon</span>
				</div>
			</div>
		</section>

	</div>
</div>

{#if showAutoConnectOff}
	<div class="modal-backdrop" onpointerdown={() => resolveAutoConnectOff(false)}>
		<div class="modal" role="dialog" aria-modal="true" tabindex="-1" onpointerdown={(e) => e.stopPropagation()}>
			<h2>Remove existing connections?</h2>
			<p class="sub">
				Auto-connect is off. Keep the dashed links already drawn between related items, or
				remove them from every canvas?
			</p>
			<div class="modal-actions">
				<button class="btn-ghost" onclick={() => resolveAutoConnectOff(false)}>Keep them</button>
				<button class="btn-primary danger" onclick={() => resolveAutoConnectOff(true)}>Remove all</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.page {
		padding: var(--s-xl);
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		background: var(--c-canvas);
		min-height: 100%;
		box-sizing: border-box;
	}

	header {
		display: flex;
		align-items: center;
	}
	h1 {
		margin: 0;
		font-size: 28px;
		font-weight: 700;
		letter-spacing: -0.5px;
	}

	/* ── Responsive card grid ── */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: var(--s-lg);
		align-items: start;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: var(--s-md);
		padding: var(--s-lg);
		background: var(--c-surface-soft);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
	}

	/* API Keys card always spans full row */
	.card.full {
		grid-column: 1 / -1;
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

	/* ── Field layout ── */
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

	/* ── Inputs ── */
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
	}

	/* ── Select ── */
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

	/* ── Toggle switch ── */
	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		font-size: 13px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
		user-select: none;
	}
	.toggle-row input[type='checkbox'] {
		appearance: none;
		-webkit-appearance: none;
		width: 34px;
		height: 18px;
		flex-shrink: 0;
		border-radius: var(--r-full);
		background: var(--c-hairline);
		cursor: pointer;
		position: relative;
		transition: background var(--ease-glass);
	}
	.toggle-row input[type='checkbox']::before {
		content: '';
		position: absolute;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: white;
		top: 2px;
		left: 2px;
		transition: transform var(--ease-glass);
		box-shadow: 0 1px 3px rgba(0,0,0,0.25);
	}
	.toggle-row input[type='checkbox']:checked {
		background: var(--c-ink);
	}
	.toggle-row input[type='checkbox']:checked::before {
		transform: translateX(16px);
	}

	/* ── Buttons ── */
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
		flex-shrink: 0;
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
	.btn-ghost:hover {
		border-color: var(--c-ink);
	}
	.btn-ghost:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── API Keys grid ── */
	.key-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--s-md);
	}
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
		transition: all var(--ease-glass);
	}
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

	/* ── Misc ── */
	code {
		font-family: var(--font-mono);
		font-size: 12px;
		background: var(--c-hairline);
		padding: 1px 5px;
		border-radius: 3px;
	}
	.warn {
		font-size: 12px;
		line-height: 1.4;
		color: #a05a00;
	}
	.pull-progress {
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.5);
		word-break: break-all;
	}
	.pull-progress.pull-error { color: #a02020; }

	/* ── Auto-connect off modal ── */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
	}
	.modal {
		width: min(420px, calc(100vw - 48px));
		display: flex;
		flex-direction: column;
		gap: var(--s-md);
		padding: var(--s-lg);
		background: var(--c-surface-soft);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
		box-shadow: var(--elev-float);
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--s-sm);
	}
	.btn-primary.danger {
		background: #c0392b;
		border-color: #c0392b;
		color: #fff;
	}

	/* ── Updates ── */
	.upd-line {
		font-size: 13px;
		margin: 0;
	}
	.upd-line.err { color: var(--c-accent-magenta); }
	.upd-progress {
		height: 4px;
		border-radius: var(--r-full);
		background: var(--c-hairline);
		overflow: hidden;
	}
	.upd-bar {
		height: 100%;
		background: var(--c-accent-magenta);
		transition: width 0.2s ease;
	}

	/* ── Future ── */
	.future-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		overflow: hidden;
	}
	.future-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--s-sm) var(--s-md);
		background: var(--c-canvas);
	}
	.future-item + .future-item { border-top: 1px solid var(--c-hairline); }
	.f-title { font-size: 13px; font-weight: 500; }
	.f-badge {
		font-family: var(--font-mono);
		font-size: 10px;
		letter-spacing: 0.3px;
		color: rgba(var(--ink-rgb), 0.4);
		background: var(--c-hairline);
		padding: 2px 7px;
		border-radius: var(--r-full);
	}
</style>
