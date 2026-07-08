<script lang="ts">
	import { onMount } from 'svelte';
	import { settings, persistSettings, purgeSemanticEdges } from '$lib/canvas/store.svelte';
	import { PROVIDERS, type Provider } from '$lib/ai/client';
	import { WORKFLOWS } from '$lib/ai/workflows';
	import { apiJson, apiPut } from '$lib/api';
	import { isMac } from '$lib/platform';
	import {
		updateState,
		checkForUpdates,
		installUpdate,
		forceUpdateCheck,
		setForceUpdateCheck
	} from '$lib/updates/store.svelte';
	import ProviderCard from './ProviderCard.svelte';
	import OllamaPanel from './OllamaPanel.svelte';
	import GoogleAccountCard from './GoogleAccountCard.svelte';
	import { Sparkles, LayoutGrid, Cpu, Search, Cloud, Terminal } from '@lucide/svelte';

	type Section = 'general' | 'canvas' | 'models' | 'websearch' | 'integrations' | 'advanced';
	const SECTIONS: { id: Section; label: string; icon: typeof Sparkles }[] = [
		{ id: 'general', label: 'General', icon: Sparkles },
		{ id: 'canvas', label: 'Canvas', icon: LayoutGrid },
		{ id: 'models', label: 'Models & Providers', icon: Cpu },
		{ id: 'websearch', label: 'Web Search', icon: Search },
		{ id: 'integrations', label: 'Integrations', icon: Cloud },
		{ id: 'advanced', label: 'Advanced', icon: Terminal }
	];
	let activeSection = $state<Section>('general');

	let appVersion = $state('');
	onMount(async () => {
		try {
			const { getVersion } = await import('@tauri-apps/api/app');
			appVersion = await getVersion();
		} catch {
			appVersion = ''; // browser dev
		}
		if (location.hash === '#updates') activeSection = 'general';
	});

	const BLOCKS = ['lilac', 'lime', 'cream', 'pink', 'mint', 'coral'];
	const providers = PROVIDERS.map((p, i) => ({ ...p, block: BLOCKS[i % BLOCKS.length] }));
	const keyed = providers.filter((p) => p.requiresKey);
	const providerName = (id: string) => providers.find((p) => p.id === id)?.name ?? id;

	// Model ladder: drag to reorder, falls back to the next rung on rate-limit.
	let dragIndex = $state(-1);
	const unladdered = $derived(providers.filter((p) => !settings.providerLadder.includes(p.id)));
	function reorderLadder(from: number, to: number) {
		if (from < 0 || from === to) return;
		const arr = [...settings.providerLadder];
		const [moved] = arr.splice(from, 1);
		arr.splice(to, 0, moved);
		settings.providerLadder = arr;
		persistSettings();
	}
	function addToLadder(id: Provider) {
		settings.providerLadder = [...settings.providerLadder, id];
		persistSettings();
	}
	function removeFromLadder(id: Provider) {
		if (settings.providerLadder.length <= 1) return; // keep at least one rung
		settings.providerLadder = settings.providerLadder.filter((p) => p !== id);
		persistSettings();
	}

	type Status = 'idle' | 'saving' | 'saved' | 'error';

	// Tavily key lives here (Web Search section); per-provider keys live in ProviderCard.
	let tavilyKey = $state('');
	let tavilyExists = $state(false);
	let tavilyStatus = $state<Status>('idle');

	$effect(() => {
		(async () => {
			try {
				const { exists } = await apiJson<{ exists: boolean }>('/api/keys/tavily');
				tavilyExists = exists;
			} catch {
				/* backend unreachable */
			}
		})();
	});

	async function saveTavily() {
		tavilyStatus = 'saving';
		try {
			await apiPut('/api/keys/tavily', { key: tavilyKey });
			tavilyExists = true;
			tavilyStatus = 'saved';
		} catch {
			tavilyStatus = 'error';
		}
		setTimeout(() => (tavilyStatus = 'idle'), 2000);
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

</script>

<div class="page">
	<header>
		<h1>Settings</h1>
	</header>

	<div class="layout">
		<nav class="settings-nav" aria-label="Settings sections">
			{#each SECTIONS as s (s.id)}
				{@const Icon = s.icon}
				<button
					type="button"
					class="nav-btn"
					class:active={activeSection === s.id}
					onclick={() => (activeSection = s.id)}
				>
					<Icon size={16} strokeWidth={1.75} />
					<span>{s.label}</span>
				</button>
			{/each}
		</nav>

		<div class="settings-content">
			{#key activeSection}
				<div class="pane">
					{#if activeSection === 'general'}
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

							<label class="toggle-row dev-only">
								<input
									type="checkbox"
									checked={forceUpdateCheck.enabled}
									onchange={(e) => setForceUpdateCheck((e.currentTarget as HTMLInputElement).checked)}
								/>
								<span>Force-pull latest release (dev/testing — same version OK)</span>
							</label>
						</section>

						<section class="card">
							<h2>Default Workflow</h2>
							<p class="sub">System prompt new cards run under. Pick per-card on the canvas too.</p>
							<select class="select" bind:value={settings.workflow} onchange={persistSettings}>
								{#each WORKFLOWS as w (w.id)}
									<option value={w.id}>{w.label} — {w.description}</option>
								{/each}
							</select>
						</section>

						<section class="card">
							<h2>Appearance</h2>
							<p class="sub">Visual theme for the app.</p>
							<label class="toggle-row">
								<input type="checkbox" checked={settings.theme === 'dark'}
									onchange={() => { settings.theme = settings.theme === 'dark' ? 'light' : 'dark'; persistSettings(); }} />
								<span>Dark mode</span>
							</label>
						</section>
					{:else if activeSection === 'canvas'}
						<section class="card">
							<h2>Canvas</h2>
							<p class="sub">Grid and layout options.</p>
							<label class="toggle-row">
								<input type="checkbox" bind:checked={settings.snapToGrid} onchange={persistSettings} />
								<span>Snap nodes to grid</span>
							</label>
							<label class="toggle-row">
								<input type="checkbox" checked={settings.autoConnect} onchange={onAutoConnectChange} />
								<span>Auto-connect related cards, notes & files</span>
							</label>
							<p class="sub">Draws dashed links between items about the same topic, in the background as you work.</p>
							<label class="toggle-row">
								<input type="checkbox" bind:checked={settings.autoCleanup.enabled} onchange={persistSettings} />
								<span>Auto Clean Up</span>
							</label>
							<p class="sub">Repeats Clean Up (⌘C) on its own, forever, while this canvas is open.</p>
							{#if settings.autoCleanup.enabled}
								<div class="field">
									<label for="auto-cleanup-interval">Every (minutes)</label>
									<input
										id="auto-cleanup-interval"
										type="number"
										min="1"
										step="1"
										bind:value={settings.autoCleanup.intervalMin}
										onchange={() => {
											settings.autoCleanup.intervalMin = Math.max(1, settings.autoCleanup.intervalMin || 1);
											persistSettings();
										}}
									/>
								</div>
							{/if}
							<label class="toggle-row">
								<input type="checkbox" bind:checked={settings.highlightClusters} onchange={persistSettings} />
								<span>Highlight clusters</span>
							</label>
							<p class="sub">Tints each Clean Up cluster with a soft background and an animated dotted border.</p>
							{#if settings.highlightClusters}
								<div class="field">
									<label for="cluster-shape">Highlight shape</label>
									<select
										id="cluster-shape"
										class="select"
										bind:value={settings.clusterShape}
										onchange={persistSettings}
									>
										<option value="squircle">Squircle</option>
										<option value="circle">Circle</option>
									</select>
								</div>
							{/if}
						</section>
					{:else if activeSection === 'models'}
						<section class="card">
							<h2>Model Ladder</h2>
							<p class="sub">Tried in order for every card. On rate-limit, falls back to the next rung. Drag to reorder.</p>
							<div class="ladder-list" role="list">
								{#each settings.providerLadder as pid, i (pid)}
									<div
										class="ladder-row"
										role="listitem"
										class:dragging={dragIndex === i}
										draggable="true"
										ondragstart={() => (dragIndex = i)}
										ondragover={(e) => e.preventDefault()}
										ondrop={() => { reorderLadder(dragIndex, i); dragIndex = -1; }}
										ondragend={() => (dragIndex = -1)}
									>
										<span class="ladder-handle" aria-hidden="true">⠿</span>
										<span class="ladder-rank">{i + 1}</span>
										<span class="ladder-name">{providerName(pid)}{providers.find((p) => p.id === pid)?.requiresKey ? '' : ' (local)'}</span>
										<button
											class="ladder-remove"
											onclick={() => removeFromLadder(pid)}
											disabled={settings.providerLadder.length <= 1}
											aria-label="Remove {providerName(pid)} from ladder"
										>×</button>
									</div>
								{/each}
							</div>
							{#if unladdered.length}
								<div class="ladder-add">
									{#each unladdered as p (p.id)}
										<button class="btn-ghost" onclick={() => addToLadder(p.id)}>+ {p.name}</button>
									{/each}
								</div>
							{/if}
						</section>

						<OllamaPanel />

						<section class="card">
							<h2>API Keys & Models</h2>
							<p class="sub">Keys stored in {isMac ? 'macOS Keychain' : 'Windows Credential Manager'} — never leave your device. Model name persists locally.</p>
							<div class="key-grid">
								{#each keyed as p (p.id)}
									<ProviderCard provider={p} />
								{/each}
							</div>
						</section>
					{:else if activeSection === 'websearch'}
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
												placeholder={tavilyExists ? '•••••••• saved' : 'tvly-…'}
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
					{:else if activeSection === 'integrations'}
						<GoogleAccountCard />

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
					{:else if activeSection === 'advanced'}
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
					{/if}
				</div>
			{/key}
		</div>
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
		--ease-snap: cubic-bezier(0.23, 1, 0.32, 1);
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

	/* ── Sidebar-navigated layout, mirrors native macOS System Settings ── */
	.layout {
		display: flex;
		align-items: flex-start;
		gap: var(--s-xl);
	}

	.settings-nav {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 200px;
		flex-shrink: 0;
		position: sticky;
		top: var(--s-xl);
	}
	.nav-btn {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		height: 36px;
		padding: 0 var(--s-sm);
		border: none;
		border-radius: var(--r-md);
		background: transparent;
		color: rgba(var(--ink-rgb), 0.6);
		font-family: var(--font-sans);
		font-size: 13px;
		font-weight: 500;
		text-align: left;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease, transform 120ms var(--ease-snap);
	}
	.nav-btn :global(svg) {
		flex-shrink: 0;
	}
	.nav-btn:hover {
		background: var(--c-hairline-soft);
		color: var(--c-ink);
	}
	.nav-btn:active {
		transform: scale(0.98);
	}
	.nav-btn.active {
		background: var(--c-primary);
		color: var(--c-on-primary);
	}
	.nav-btn:focus-visible {
		outline: 2px solid var(--c-ink);
		outline-offset: 2px;
	}

	.settings-content {
		flex: 1;
		min-width: 0;
		max-width: 640px;
	}

	.pane {
		display: flex;
		flex-direction: column;
		gap: var(--s-lg);
		animation: pane-in 180ms var(--ease-snap);
	}
	@keyframes pane-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
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
	input[type='number'] {
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
		transition: border-color 160ms ease, box-shadow 160ms ease;
		min-width: 0;
	}
	input[type='password']:focus,
	input[type='number']:focus {
		border-color: var(--c-ink);
		box-shadow: 0 0 0 3px rgba(var(--ink-rgb), 0.08);
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
		transition: border-color 160ms ease, box-shadow 160ms ease;
		width: 100%;
	}
	.select:focus {
		border-color: var(--c-ink);
		box-shadow: 0 0 0 3px rgba(var(--ink-rgb), 0.08);
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
		transition: background 160ms ease;
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
		transition: transform 200ms var(--ease-snap);
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
		transition: opacity 160ms ease, transform 120ms var(--ease-snap);
		flex-shrink: 0;
	}
	.btn-primary:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn-primary:disabled {
		opacity: 0.3;
		cursor: default;
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
		transition: border-color 160ms ease, transform 120ms var(--ease-snap);
	}
	.btn-ghost:active:not(:disabled) {
		transform: scale(0.97);
	}
	.btn-ghost:hover {
		border-color: var(--c-ink);
	}
	.btn-ghost:disabled {
		opacity: 0.4;
		cursor: default;
	}

	/* ── Model ladder ── */
	.ladder-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ladder-row {
		display: flex;
		align-items: center;
		gap: var(--s-sm);
		height: 36px;
		padding: 0 var(--s-sm);
		border: 1px solid var(--c-hairline);
		border-radius: var(--r-md);
		background: var(--c-canvas);
		cursor: grab;
	}
	.ladder-row.dragging {
		opacity: 0.4;
	}
	.ladder-handle {
		color: rgba(var(--ink-rgb), 0.35);
		font-size: 13px;
	}
	.ladder-rank {
		font-family: var(--font-mono);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.45);
		min-width: 14px;
	}
	.ladder-name {
		flex: 1;
		font-size: 13px;
		font-weight: 500;
	}
	.ladder-remove {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: var(--r-full);
		background: transparent;
		color: rgba(var(--ink-rgb), 0.45);
		font-size: 15px;
		line-height: 1;
		cursor: pointer;
		transition: background 160ms ease, color 160ms ease, transform 120ms var(--ease-snap);
	}
	.ladder-remove:hover:not(:disabled) {
		background: var(--c-hairline);
		color: var(--c-ink);
	}
	.ladder-remove:active:not(:disabled) {
		transform: scale(0.9);
	}
	.ladder-remove:disabled {
		opacity: 0.25;
		cursor: default;
	}
	.ladder-add {
		display: flex;
		flex-wrap: wrap;
		gap: var(--s-xs);
	}
	.ladder-add .btn-ghost {
		height: 28px;
		padding: 0 var(--s-sm);
		font-size: 12px;
	}

	/* ── API Keys grid ── */
	.key-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: var(--s-md);
	}

	/* ── Misc ── */
	.warn {
		font-size: 12px;
		line-height: 1.4;
		color: #a05a00;
	}

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

	/* Dev/testing-only toggle — remove with the rest of this feature before public release. */
	.dev-only {
		margin-top: var(--s-sm);
		padding-top: var(--s-sm);
		border-top: 1px dashed var(--c-hairline);
		opacity: 0.7;
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
