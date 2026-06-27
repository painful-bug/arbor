<script lang="ts">
	// Inline activity timeline: reasoning + tool calls a card's agent made, streamed.
	// Folds the flat AgentEvent[] into thinking blocks and start/end-paired tool rows.
	import type { AgentEvent } from '$lib/ai/client';
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
		rag_search: 'Searched files'
	};
	function basename(p: unknown): string {
		return typeof p === 'string' ? p.split('/').pop() || p : '';
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
		  };

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
				}
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
			<ul class="rows" transition:slideIn>
				{#each items as it, i (i)}
					{#if it.kind === 'thinking'}
						<li class="row thinking">
							<span class="dot think"></span>
							<span class="label">Thinking</span>
							<p class="think-text">{it.text}</p>
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
							{#if expanded[i] && it.detail}
								<pre class="detail" transition:slideIn>{it.detail}</pre>
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
		color: rgba(0, 0, 0, 0.55);
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
		color: rgba(0, 0, 0, 0.4);
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
		background: rgba(0, 0, 0, 0.25);
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
		border: 1px solid rgba(0, 0, 0, 0.3);
	}
	.label {
		color: rgba(0, 0, 0, 0.7);
		text-align: left;
	}
	.label.tool {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		font: inherit;
		text-decoration: underline dotted rgba(0, 0, 0, 0.25);
	}
	.think-text {
		grid-column: 2;
		margin: 0;
		font-style: italic;
		color: rgba(0, 0, 0, 0.5);
		white-space: pre-wrap;
		max-height: 60px;
		overflow-y: auto;
	}
	.detail {
		grid-column: 2;
		margin: 2px 0 0;
		padding: 4px 6px;
		font-size: 11px;
		background: rgba(0, 0, 0, 0.05);
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
