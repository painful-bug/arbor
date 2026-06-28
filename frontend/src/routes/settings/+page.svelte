<script lang="ts">
	import { settings, persistSettings, DEFAULT_MODELS } from '$lib/canvas/store.svelte';
	import { testConnection, PROVIDERS, type Provider } from '$lib/ai/client';
	import { WORKFLOWS } from '$lib/ai/workflows';
	import { apiJson, apiPut } from '$lib/api';

	// pastel block per provider, cycled for visual variety
	const BLOCKS = ['lilac', 'lime', 'cream', 'pink', 'mint', 'coral'];
	const providers = PROVIDERS.map((p, i) => ({ ...p, block: BLOCKS[i % BLOCKS.length] }));
	const keyed = providers.filter((p) => p.requiresKey);

	type Status = 'idle' | 'saving' | 'saved' | 'error';
	type TestStatus = 'idle' | 'testing' | 'ok' | 'fail';

	let keys = $state<Record<string, string>>({});
	let keyExists = $state<Record<string, boolean>>({}); // a key is saved (we never read it back)
	let saveStatus = $state<Record<string, Status>>({});
	let testStatus = $state<Record<string, TestStatus>>({});
	let testError = $state<Record<string, string>>({});
	let tavilyKey = $state('');
	let tavilyStatus = $state<Status>('idle');

	// On mount, ask the backend which keys are present (presence only — the key
	// itself never leaves the keychain). Fields stay empty; a saved key shows as a
	// placeholder so the user knows one exists.
	$effect(() => {
		(async () => {
			for (const p of [...keyed.map((k) => k.id), 'tavily'] as string[]) {
				try {
					const { exists } = await apiJson<{ exists: boolean }>(`/api/keys/${p}`);
					keyExists[p] = exists;
				} catch {
					/* backend unreachable — leave unknown */
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
	function selectProvider(p: Provider) {
		settings.provider = p;
		persistSettings();
	}

</script>

<div class="page">
	<header>
		<p class="eyebrow">LOOM · SETTINGS</p>
		<h1>Preferences</h1>
	</header>

	<section>
		<h2>Default Workflow</h2>
		<p class="sub">System prompt new cards run under. Pick per-card on the canvas too.</p>
		<select class="select" bind:value={settings.workflow} onchange={persistSettings}>
			{#each WORKFLOWS as w (w.id)}
				<option value={w.id}>{w.label} — {w.description}</option>
			{/each}
		</select>
	</section>

	<section>
		<h2>AI Model Provider</h2>
		<p class="sub">Provider + model for new cards. All inference runs through the pi agent.</p>

		<div class="provider-grid">
			{#each providers as p (p.id)}
				<button
					class="provider-card"
					class:active={settings.provider === p.id}
					style="--bg: var(--block-{p.block})"
					onclick={() => selectProvider(p.id)}
				>
					<div class="p-header">
						<span class="p-name">{p.name}</span>
						{#if settings.provider === p.id}
							<span class="badge">Active</span>
						{/if}
					</div>
					<p class="p-desc">{p.requiresKey ? 'API key required' : 'Local — no key needed'}</p>
				</button>
			{/each}
		</div>
	</section>

	<section>
		<h2>API Keys & Models</h2>
		<p class="sub">Keys stored in macOS Keychain — never leave your device. Model name persists locally.</p>

		<div class="key-list">
			{#each keyed as p (p.id)}
				<div class="key-card" style="--bg: var(--block-{p.block})">
					<div class="key-card-head">
						<span class="kc-name">{p.name}</span>
						<button
							class="test-btn"
							class:ok={testStatus[p.id] === 'ok'}
							class:fail={testStatus[p.id] === 'fail'}
							onclick={() => test(p.id)}
							disabled={testStatus[p.id] === 'testing'}
						>
							{testStatus[p.id] === 'testing'
								? 'Testing…'
								: testStatus[p.id] === 'ok'
									? 'Connected ✓'
									: testStatus[p.id] === 'fail'
										? 'Failed ✕'
										: 'Test'}
						</button>
					</div>

					<label for="{p.id}-key">API key</label>
					<div class="key-input-wrap">
						<input
							id="{p.id}-key"
							type="password"
							placeholder={keyExists[p.id] ? '•••••••• saved' : 'sk-…'}
							bind:value={keys[p.id]}
							autocomplete="off"
							spellcheck="false"
						/>
						<button
							class="save-btn"
							onclick={() => save(p.id)}
							disabled={!keys[p.id] || saveStatus[p.id] === 'saving'}
						>
							{saveStatus[p.id] === 'saved' ? 'Saved ✓' : saveStatus[p.id] === 'error' ? 'Error' : 'Save'}
						</button>
					</div>

					<label for="{p.id}-model">Model</label>
					<input
						id="{p.id}-model"
						type="text"
						class="model-input"
						placeholder={DEFAULT_MODELS[p.id]}
						bind:value={settings.models[p.id]}
						oninput={onModelInput}
						autocomplete="off"
						spellcheck="false"
					/>

					{#if testStatus[p.id] === 'fail' && testError[p.id]}
						<p class="test-error">{testError[p.id]}</p>
					{/if}
				</div>
			{/each}
		</div>
	</section>

	<section>
		<h2>Web Search</h2>
		<p class="sub">Let the agent search the web. <strong>Tavily is recommended</strong> — source-aware results with a key. DuckDuckGo is free but frequently rate-limits automated requests and may return nothing.</p>

		<label class="toggle-row">
			<input type="checkbox" bind:checked={settings.websearch.enabled} onchange={persistSettings} />
			<span>Enable web search</span>
		</label>

		{#if settings.websearch.enabled}
			<label for="ws-backend">Backend</label>
			<select
				id="ws-backend"
				class="select"
				bind:value={settings.websearch.backend}
				onchange={persistSettings}
			>
				<option value="tavily">Tavily — recommended (API key)</option>
				<option value="duckduckgo">DuckDuckGo (free, often rate-limited)</option>
			</select>

			{#if settings.websearch.backend === 'tavily'}
				<label for="tavily-key">Tavily API key</label>
				<div class="key-input-wrap">
					<input
						id="tavily-key"
						type="password"
						placeholder={keyExists['tavily'] ? '•••••••• saved' : 'tvly-…'}
						bind:value={tavilyKey}
						autocomplete="off"
						spellcheck="false"
					/>
					<button class="save-btn" onclick={saveTavily} disabled={!tavilyKey || tavilyStatus === 'saving'}>
						{tavilyStatus === 'saved' ? 'Saved ✓' : tavilyStatus === 'error' ? 'Error' : 'Save'}
					</button>
				</div>
			{/if}
		{/if}
	</section>

	<section>
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

	<section>
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

<style>
	.page {
		max-width: 640px;
		padding: var(--s-xxl) var(--s-xxl) var(--s-xxl) calc(56px + var(--s-xxl));
		display: flex;
		flex-direction: column;
		gap: var(--s-xxl);
	}

	header {
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
	}
	.eyebrow {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.6px;
		color: rgba(0, 0, 0, 0.45);
		margin: 0;
	}
	h1 {
		font-size: 40px;
		font-weight: 600;
		letter-spacing: -0.8px;
		margin: 0;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--s-md);
	}
	h2 {
		font-size: 18px;
		font-weight: 600;
		margin: 0;
	}
	.sub {
		font-size: 14px;
		color: rgba(0, 0, 0, 0.5);
		margin: 0;
	}

	/* provider cards */
	.provider-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--s-md);
	}
	.provider-card {
		text-align: left;
		background: var(--c-surface-soft);
		border: 1.5px solid transparent;
		border-radius: var(--r-lg);
		padding: var(--s-md);
		cursor: pointer;
		transition:
			border-color var(--ease-glass),
			box-shadow var(--ease-glass),
			background var(--ease-glass);
	}
	.provider-card:hover {
		background: var(--bg);
		box-shadow: var(--elev-2);
	}
	.provider-card.active {
		background: var(--bg);
		border-color: var(--c-ink);
	}
	.p-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s-xs);
	}
	.p-name {
		font-size: 15px;
		font-weight: 600;
	}
	.badge {
		font-family: var(--font-mono);
		font-size: 11px;
		background: var(--c-ink);
		color: var(--c-on-primary);
		padding: 2px 8px;
		border-radius: var(--r-full);
	}
	.p-desc {
		font-size: 13px;
		color: rgba(0, 0, 0, 0.6);
		margin: 0;
		line-height: 1.4;
	}

	/* api keys + models */
	.key-list {
		display: flex;
		flex-direction: column;
		gap: var(--s-md);
	}
	.key-card {
		display: flex;
		flex-direction: column;
		gap: var(--s-xs);
		padding: var(--s-md);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
		border-left: 4px solid var(--bg);
		background: var(--c-surface-soft);
	}
	.key-card-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--s-xs);
	}
	.kc-name {
		font-size: 15px;
		font-weight: 600;
	}
	.key-card label {
		margin-top: var(--s-xs);
	}
	.test-btn {
		font-family: var(--font-mono);
		font-size: 12px;
		padding: 4px 12px;
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-full);
		background: var(--c-canvas);
		color: var(--c-ink);
		cursor: pointer;
		transition: all var(--ease-glass);
	}
	.test-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.test-btn.ok {
		background: var(--block-mint);
		border-color: var(--c-ink);
	}
	.test-btn.fail {
		background: var(--block-coral);
		border-color: var(--c-ink);
	}
	.test-error {
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.4;
		color: #a02020;
		margin: var(--s-xs) 0 0;
		word-break: break-word;
		max-height: 80px;
		overflow: auto;
	}
	.model-input {
		font-size: 13px !important;
	}
	label {
		font-size: 13px;
		font-weight: 500;
		color: rgba(0, 0, 0, 0.65);
	}
	.key-input-wrap {
		display: flex;
		gap: var(--s-xs);
	}
	input[type='password'],
	input[type='text'] {
		flex: 1;
		height: 40px;
		padding: 0 var(--s-md);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		font-family: var(--font-mono);
		font-size: 14px;
		background: var(--c-canvas);
		color: var(--c-ink);
		outline: none;
		transition: border-color var(--ease-glass);
	}
	input[type='password']:focus,
	input[type='text']:focus {
		border-color: var(--c-ink);
	}
	.select {
		height: 40px;
		padding: 0 var(--s-md);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		font-family: var(--font-sans);
		font-size: 14px;
		background: var(--c-canvas);
		color: var(--c-ink);
		outline: none;
	}
	.toggle-row {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		font-size: 14px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
	}
	.toggle-row input {
		width: 18px;
		height: 18px;
		cursor: pointer;
	}
	.warn {
		font-size: 13px;
		line-height: 1.4;
		color: #a05a00;
		margin: 0;
	}
	.save-btn {
		height: 40px;
		padding: 0 var(--s-md);
		border: 1px solid var(--c-ink);
		border-radius: var(--r-md);
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		transition: opacity var(--ease-glass);
	}
	.save-btn:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* future */
	.future-list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-lg);
		overflow: hidden;
	}
	.future-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: var(--s-md) var(--s-lg);
		background: var(--c-surface-soft);
	}
	.future-item + .future-item {
		border-top: 1px solid var(--c-hairline);
	}
	.f-title {
		font-size: 14px;
		font-weight: 500;
	}
	.f-badge {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.3px;
		color: rgba(0, 0, 0, 0.4);
		background: var(--c-hairline);
		padding: 2px 8px;
		border-radius: var(--r-full);
	}
</style>
