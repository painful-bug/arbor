<script lang="ts">
	// Bottom-right stack of note-created notifications. Collapsed by default (title
	// only); click to expand into a scrollable body. Auto-dismisses after
	// NOTIF_DISMISS_TIME unless the user interacts (hover pauses, click expands + pins).
	import { noteNotifs, dismissNote, NOTIF_DISMISS_TIME, type NoteNotif } from './notifications.svelte';
	import { popScale } from '$lib/theme/animations';
	import { PenLine, X } from '@lucide/svelte';

	let expanded = $state<Set<number>>(new Set());

	// Per-item auto-dismiss. Pointer-enter pauses; click (expand) pins permanently.
	function autoDismiss(node: HTMLElement, id: number) {
		let pinned = false;
		let timer = setTimeout(() => dismissNote(id), NOTIF_DISMISS_TIME);
		const pause = () => clearTimeout(timer);
		const resume = () => {
			if (pinned) return;
			clearTimeout(timer);
			timer = setTimeout(() => dismissNote(id), NOTIF_DISMISS_TIME);
		};
		const pin = () => {
			pinned = true;
			clearTimeout(timer);
		};
		node.addEventListener('pointerenter', pause);
		node.addEventListener('pointerleave', resume);
		node.addEventListener('click', pin);
		return {
			destroy() {
				clearTimeout(timer);
				node.removeEventListener('pointerenter', pause);
				node.removeEventListener('pointerleave', resume);
				node.removeEventListener('click', pin);
			}
		};
	}

	function toggle(n: NoteNotif) {
		const next = new Set(expanded);
		next.has(n.id) ? next.delete(n.id) : next.add(n.id);
		expanded = next;
	}
</script>

{#if noteNotifs.length}
	<div class="stack">
		{#each noteNotifs as n (n.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
			<div
				class="notif"
				class:expanded={expanded.has(n.id)}
				use:autoDismiss={n.id}
				onclick={() => toggle(n)}
				transition:popScale
			>
				<div class="head">
					<PenLine size={13} />
					<span class="title">{n.title}</span>
					<button class="x" onclick={(e) => { e.stopPropagation(); dismissNote(n.id); }} aria-label="Dismiss"><X size={13} /></button>
				</div>
				{#if expanded.has(n.id)}
					<div class="body">{n.body}</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.stack {
		position: fixed;
		bottom: 24px;
		right: 24px;
		z-index: 130;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: flex-end;
		pointer-events: none;
	}
	.notif {
		pointer-events: auto;
		width: 300px;
		max-width: calc(100vw - 48px);
		padding: 10px 12px;
		border-radius: 12px;
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-float, 0 8px 30px rgba(0, 0, 0, 0.12));
		cursor: pointer;
		color: var(--c-ink);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
	}
	.title {
		flex: 1;
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.notif.expanded .title {
		white-space: normal;
	}
	.x {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: none;
		background: transparent;
		color: inherit;
		opacity: 0.5;
		cursor: pointer;
		padding: 2px;
		border-radius: 6px;
	}
	.x:hover {
		opacity: 1;
		background: rgba(var(--ink-rgb), 0.08);
	}
	.body {
		margin-top: 8px;
		max-height: 200px;
		overflow-y: auto;
		font-size: 12px;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
		color: rgba(var(--ink-rgb), 0.75);
		border-top: 1px solid var(--c-hairline);
		padding-top: 8px;
	}
</style>
