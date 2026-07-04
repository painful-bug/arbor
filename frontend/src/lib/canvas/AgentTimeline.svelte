<script lang="ts">
	// Inline activity timeline: reasoning + tool calls a card's agent made, streamed.
	// Folds the flat AgentEvent[] into thinking blocks and start/end-paired tool rows.
	import type { AgentEvent } from '$lib/ai/client';
	import { openSource } from './globalSearch.svelte';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { slide } from 'svelte/transition';

	let { events, streaming }: { events: AgentEvent[]; streaming: boolean } = $props();

	// Human label + the relevant arg per built-in tool.
	const VERB: Record<string, string> = {
		read: 'Read',
		write: 'Wrote',
		edit: 'Edited',
		bash: 'Ran shell',
		web_search: 'Searched web',
		scholar_search: 'Searched papers',
		knowledge_base_search: 'Searched KB',
		knowledge_base_overview: 'KB overview',
		knowledge_base_read_source: 'Read source',
		create_card: 'Created card',
		create_note: 'Created note',
		update_card: 'Updated card'
	};
	function basename(p: unknown): string {
		return typeof p === 'string' ? p.split('/').pop() || p : '';
	}
	function chipLabel(s: { source: string; page?: number }): string {
		return s.page ? `${basename(s.source)} · p.${s.page}` : basename(s.source);
	}
	function toolLabel(name: string, args: unknown): string {
		const a = (args ?? {}) as Record<string, unknown>;
		const arg = basename(a.path) || (a.query as string) || (a.command as string) || '';
		return arg ? `${VERB[name] ?? name} ${arg}` : VERB[name] ?? name;
	}

	type Item =
		| { kind: 'thinking'; text: string }
		| {
				kind: 'tool';
				toolId: string;
				label: string;
				args: unknown;
				done: boolean;
				ok: boolean;
				detail?: string;
				sources?: { source: string; page?: number }[];
		  }
		| { kind: 'fallback'; provider: string; message: string };

	// Recomputes whenever the events array is replaced (store pushes immutably).
	const items = $derived.by(() => {
		const out: Item[] = [];
		const byTool = new Map<string, Extract<Item, { kind: 'tool' }>>();
		for (const e of events) {
			if (e.type === 'thinking_delta') {
				const last = out.at(-1);
				if (last?.kind === 'thinking') last.text += e.delta ?? '';
				else out.push({ kind: 'thinking', text: e.delta ?? '' });
			} else if (e.type === 'tool_start' && e.toolId) {
				const it: Extract<Item, { kind: 'tool' }> = {
					kind: 'tool',
					toolId: e.toolId,
					label: toolLabel(e.name ?? 'tool', e.args),
					args: e.args,
					done: false,
					ok: true
				};
				byTool.set(e.toolId, it);
				out.push(it);
			} else if (e.type === 'tool_end' && e.toolId) {
				const it = byTool.get(e.toolId);
				if (it) {
					it.done = true;
					it.ok = e.ok ?? true;
					it.detail = e.detail;
					it.sources = e.sources;
				}
			} else if (e.type === 'provider_switch') {
				out.push({ kind: 'fallback', provider: e.provider ?? '', message: e.message ?? '' });
			}
		}
		return out;
	});

	let open = $state(false);
	let expanded = $state<Record<number, boolean>>({});
	const slideIn = (node: Element) => (reducedMotion() ? {} : slide(node, { duration: 160 }));
</script>

{#if items.length > 0}
	<div class="timeline nodrag">
		<button class="head" onclick={() => (open = !open)} type="button">
			<span class="chev" class:open>▸</span>
			<span class="title">Activity</span>
			<span class="count">{items.length}</span>
			{#if streaming}<span class="pulse"></span>{/if}
		</button>
		{#if open}
			<ul class="rows nowheel" transition:slideIn>
				{#each items as it, i (i)}
					{#if it.kind === 'thinking'}
						<li class="row thinking">
							<span class="dot think"></span>
							<span class="label">Thinking</span>
							<p class="think-text nowheel">{it.text}</p>
						</li>
					{:else if it.kind === 'fallback'}
						<li class="row">
							<span class="dot err"></span>
							<span class="label">{it.message || `Switched to ${it.provider}`}</span>
						</li>
					{:else}
						<li class="row">
							<span
								class="dot"
								class:running={!it.done}
								class:ok={it.done && it.ok}
								class:err={it.done && !it.ok}
							></span>
							<button
								class="label tool"
								type="button"
								onclick={() => (expanded[i] = !expanded[i])}
							>
								{it.label}
							</button>
							{#if it.sources?.length}
								<div class="cites">
									{#each it.sources as s (s.source + '#' + (s.page ?? ''))}
										<button
											class="cite"
											type="button"
											title="Open {s.source}{s.page ? ` at page ${s.page}` : ''}"
											onclick={() => openSource(s.source, s.page ?? 0)}
										>
											{chipLabel(s)}
										</button>
									{/each}
								</div>
							{/if}
							{#if expanded[i] && it.detail}
								<pre class="detail nowheel" transition:slideIn>{it.detail}</pre>
							{/if}
						</li>
					{/if}
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.timeline {
		margin: 0 0 var(--s-xs);
		font-size: 12px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 2px 0;
		background: none;
		border: none;
		cursor: pointer;
		color: rgba(var(--ink-rgb), 0.55);
		font: inherit;
	}
	.chev {
		display: inline-block;
		transition: transform 0.15s var(--ease-glass, ease);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.title {
		font-weight: 600;
	}
	.count {
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.4);
	}
	.pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c-ink, #333);
		animation: pulse 1s ease-in-out infinite;
	}
	.rows {
		list-style: none;
		margin: 4px 0 0;
		padding: 0 0 0 2px;
		max-height: 140px;
		overflow-y: auto;
	}
	.row {
		display: grid;
		grid-template-columns: 12px 1fr;
		align-items: start;
		gap: 6px;
		padding: 2px 0;
	}
	.dot {
		width: 7px;
		height: 7px;
		margin-top: 4px;
		border-radius: 50%;
		background: rgba(var(--ink-rgb), 0.25);
	}
	.dot.running {
		background: var(--c-ink, #333);
		animation: pulse 1s ease-in-out infinite;
	}
	.dot.ok {
		background: #3fa34d;
	}
	.dot.err {
		background: #d24b4b;
	}
	.dot.think {
		background: transparent;
		border: 1px solid rgba(var(--ink-rgb), 0.3);
	}
	.label {
		color: rgba(var(--ink-rgb), 0.7);
		text-align: left;
	}
	.label.tool {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font: inherit;
		text-decoration: underline dotted rgba(var(--ink-rgb), 0.25);
	}
	.think-text {
		grid-column: 2;
		margin: 0;
		font-style: italic;
		color: rgba(var(--ink-rgb), 0.5);
		white-space: pre-wrap;
		max-height: 60px;
		overflow-y: auto;
	}
	.cites {
		grid-column: 2;
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin: 3px 0 1px;
	}
	.cite {
		max-width: 100%;
		padding: 1px 7px;
		font: inherit;
		font-size: 11px;
		line-height: 1.5;
		color: rgba(var(--ink-rgb), 0.72);
		background: rgba(var(--ink-rgb), 0.06);
		border: 1px solid rgba(var(--ink-rgb), 0.12);
		border-radius: 999px;
		cursor: pointer;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cite:hover {
		background: rgba(var(--ink-rgb), 0.12);
		color: rgba(var(--ink-rgb), 0.95);
	}
	.detail {
		grid-column: 2;
		margin: 2px 0 0;
		padding: 4px 6px;
		font-size: 11px;
		background: rgba(var(--ink-rgb), 0.05);
		border-radius: var(--r-sm, 4px);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.pulse,
		.dot.running {
			animation: none;
		}
	}
</style>
