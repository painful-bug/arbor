<script lang="ts" module>
	export interface Command {
		id: string;
		label: string;
		group: string;
		icon?: string;
		hint?: string;
		run: () => void;
	}
</script>

<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	let {
		open,
		commands,
		onclose
	}: { open: boolean; commands: Command[]; onclose: () => void } = $props();

	let query = $state('');
	let cursor = $state(0);
	let inputEl = $state<HTMLInputElement | null>(null);

	// Subsequence fuzzy match: every query char appears in order in the label.
	function matches(label: string, q: string): boolean {
		if (!q) return true;
		const s = label.toLowerCase();
		let i = 0;
		for (const ch of q.toLowerCase()) {
			i = s.indexOf(ch, i);
			if (i === -1) return false;
			i++;
		}
		return true;
	}

	const filtered = $derived(
		query.trim() ? commands.filter((c) => matches(c.label + ' ' + c.group, query.trim())) : commands
	);

	// Reset + focus each time it opens; clamp cursor as the list narrows.
	$effect(() => {
		if (open) {
			query = '';
			cursor = 0;
			queueMicrotask(() => inputEl?.focus());
		}
	});
	$effect(() => {
		if (cursor >= filtered.length) cursor = Math.max(0, filtered.length - 1);
	});

	function exec(cmd: Command | undefined) {
		if (!cmd) return;
		onclose();
		cmd.run();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			cursor = Math.min(cursor + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			cursor = Math.max(cursor - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			exec(filtered[cursor]);
		} else if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		}
	}

	// Group headers render before the first item of each group (preserves order).
	function isGroupStart(i: number): boolean {
		return i === 0 || filtered[i].group !== filtered[i - 1].group;
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="cmd-backdrop"
		transition:fade={{ duration: reducedMotion() ? 0 : 150 }}
		onpointerdown={onclose}
	>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="cmd-panel"
			role="dialog"
			tabindex="-1"
			aria-modal="true"
			aria-label="Command palette"
			transition:scale={{ duration: reducedMotion() ? 0 : 220, start: 0.96, easing: backOut, opacity: 0 }}
			onpointerdown={(e) => e.stopPropagation()}
		>
			<input
				bind:this={inputEl}
				class="cmd-input"
				type="text"
				placeholder="Type a command…"
				bind:value={query}
				onkeydown={onKeydown}
				aria-label="Command search"
				spellcheck="false"
				autocomplete="off"
			/>
			<div class="cmd-list">
				{#if filtered.length === 0}
					<div class="cmd-empty">No commands</div>
				{:else}
					{#each filtered as cmd, i (cmd.id)}
						{#if isGroupStart(i)}<div class="cmd-group">{cmd.group}</div>{/if}
						<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
						<div
							class="cmd-item"
							class:active={i === cursor}
							onpointerenter={() => (cursor = i)}
							onclick={() => exec(cmd)}
						>
							{#if cmd.icon}<span class="cmd-icon">{cmd.icon}</span>{/if}
							<span class="cmd-label">{cmd.label}</span>
							{#if cmd.hint}<span class="cmd-hint">{cmd.hint}</span>{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.cmd-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		justify-content: center;
		align-items: flex-start;
		padding-top: 14vh;
		background: rgba(0, 0, 0, 0.28);
	}
	.cmd-panel {
		width: min(560px, 92vw);
		max-height: 60vh;
		display: flex;
		flex-direction: column;
		border-radius: 14px;
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-3, 0 18px 50px rgba(0, 0, 0, 0.25));
		overflow: hidden;
	}
	.cmd-input {
		border: none;
		outline: none;
		background: transparent;
		padding: 16px 18px;
		font-size: 15px;
		color: var(--c-ink);
		border-bottom: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
	}
	.cmd-input::placeholder {
		color: var(--c-ink);
		opacity: 0.4;
	}
	.cmd-list {
		overflow-y: auto;
		padding: 6px;
	}
	.cmd-group {
		padding: 8px 10px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--c-ink);
		opacity: 0.45;
	}
	.cmd-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border-radius: 8px;
		font-size: 13px;
		color: var(--c-ink);
		cursor: pointer;
	}
	.cmd-item.active {
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
	}
	.cmd-icon {
		width: 18px;
		text-align: center;
		font-size: 13px;
		opacity: 0.85;
	}
	.cmd-label {
		flex: 1;
	}
	.cmd-hint {
		font-size: 11px;
		font-family: var(--font-mono);
		opacity: 0.55;
	}
	.cmd-empty {
		padding: 18px;
		text-align: center;
		font-size: 13px;
		color: var(--c-ink);
		opacity: 0.5;
	}
</style>
