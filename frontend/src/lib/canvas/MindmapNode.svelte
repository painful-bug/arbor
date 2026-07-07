<script lang="ts">
	import type { NodeProps } from '@xyflow/svelte';
	import { FoldVertical, Minus, Plus, UnfoldVertical } from '@lucide/svelte';
	import CardHandles from './CardHandles.svelte';
	import { flow, renameMindmap, setMindmapExpandAll, toggleMindmapBranch } from './store.svelte';
	import type { MindmapData, MindNode } from './cards';
	import { layoutTree } from './mindmap-layout';

	// Node box + spacing — MUST match the values passed to layoutTree so the SVG
	// edges line up with the rendered node divs.
	const NODE_W = 156;
	const NODE_H = 40;
	const DX = 64;
	const DY = 14;
	const PAD = 24;

	let { id, data, selected: nativeSelected }: NodeProps = $props();
	const map = $derived(data as MindmapData);
	const selected = $derived(flow.selected === id || !!nativeSelected);

	const root = $derived(map.nodes.find((n) => n.parent === null));
	const count = $derived(map.nodes.length - 1);
	const expanded = $derived(map.expanded ?? {});

	// id → node, and id → child list, for O(1) lookups while rendering.
	const byId = $derived(new Map(map.nodes.map((n) => [n.id, n])));
	const kids = $derived.by(() => {
		const m = new Map<string, MindNode[]>();
		for (const n of map.nodes) {
			if (n.parent === null) continue;
			(m.get(n.parent) ?? m.set(n.parent, []).get(n.parent)!).push(n);
		}
		return m;
	});

	const layout = $derived(
		root
			? layoutTree(map.nodes, root.id, (nid) => !!expanded[nid], {
					nodeW: NODE_W,
					nodeH: NODE_H,
					dx: DX,
					dy: DY,
				})
			: { pos: new Map<string, { x: number; y: number }>(), width: 0, height: 0 },
	);

	// Visible node ids in render order.
	const visible = $derived([...layout.pos.keys()]);
	// Every node that has children (root included) — the set expand-all toggles.
	const internalIds = $derived([
		...new Set(map.nodes.map((n) => n.parent).filter((p): p is string => !!p)),
	]);
	const anyOpen = $derived(Object.values(expanded).some(Boolean));
	const allExpanded = $derived(internalIds.length > 0 && internalIds.every((pid) => expanded[pid]));

	// Edges: parent → child for every visible pair (root's children are always visible).
	interface EdgePath {
		key: string;
		d: string;
	}
	const edges = $derived.by((): EdgePath[] => {
		const out: EdgePath[] = [];
		for (const nid of visible) {
			const node = byId.get(nid);
			if (!node?.parent) continue;
			const p = layout.pos.get(node.parent);
			const c = layout.pos.get(nid);
			if (!p || !c) continue;
			const x1 = p.x + NODE_W;
			const y1 = p.y + NODE_H / 2;
			const x2 = c.x;
			const y2 = c.y + NODE_H / 2;
			const mx = (x1 + x2) / 2;
			out.push({ key: nid, d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}` });
		}
		return out;
	});

	const childCount = (nid: string) => kids.get(nid)?.length ?? 0;

	function onNodeClick(e: MouseEvent, nid: string) {
		e.stopPropagation();
		flow.selected = id;
		// Toggle this node's forward neighbours (its direct children).
		if (childCount(nid) > 0) toggleMindmapBranch(id, nid);
	}
	function selectCard() {
		flow.selected = id;
	}
	// Double-click anywhere but a topic/title/control → expand or collapse the whole map.
	function onCardDblClick(e: MouseEvent) {
		const t = e.target as HTMLElement;
		if (t.closest('.topic') || t.closest('.head')) return;
		setMindmapExpandAll(id, !allExpanded);
	}

	// Inline rename of the map's title (the root topic).
	let renaming = $state(false);
	let titleDraft = $state('');
	let titleInput = $state<HTMLInputElement>();
	$effect(() => {
		if (renaming && titleInput) {
			titleInput.focus();
			titleInput.select();
		}
	});
	function startRename(e: MouseEvent) {
		e.stopPropagation();
		titleDraft = root?.title ?? '';
		renaming = true;
	}
	function commitRename() {
		if (!renaming) return;
		renaming = false;
		const next = titleDraft.trim();
		if (next && next !== root?.title) renameMindmap(id, next);
	}
</script>

<div
	class="card"
	class:node-glow-selected={selected}
	onclick={selectCard}
	ondblclick={onCardDblClick}
	onmousedown={(e) => {
		if ((e.target as HTMLElement).closest('.nodrag')) e.stopPropagation();
	}}
	role="button"
	tabindex="0"
	onkeydown={(e) => e.key === 'Enter' && selectCard()}
>
	<CardHandles corners />

	<header class="head">
		{#if renaming}
			<!-- svelte-ignore a11y_autofocus -->
			<input
				class="title-input nodrag"
				bind:this={titleInput}
				bind:value={titleDraft}
				onclick={(e) => e.stopPropagation()}
				onblur={commitRename}
				onkeydown={(e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						commitRename();
					} else if (e.key === 'Escape') {
						renaming = false;
					}
				}}
			/>
		{:else}
			<span
				class="title nodrag"
				title="Double-click to rename"
				ondblclick={startRename}
				role="textbox"
				tabindex="-1"
			>
				{root?.title ?? 'Mind map'}
			</span>
		{/if}
		<span class="badge">{count} topics</span>
		<button
			class="ctl nodrag"
			title={anyOpen ? 'Collapse all' : 'Expand all'}
			onclick={(e) => {
				e.stopPropagation();
				setMindmapExpandAll(id, !anyOpen);
			}}
		>
			{#if anyOpen}<FoldVertical size={13} />{:else}<UnfoldVertical size={13} />{/if}
		</button>
	</header>

	<div class="viewport nowheel nodrag">
		<div class="graph" style="width:{layout.width + PAD * 2}px; height:{layout.height + PAD * 2}px">
			<svg
				class="edges"
				width={layout.width + PAD * 2}
				height={layout.height + PAD * 2}
				aria-hidden="true"
			>
				<g transform="translate({PAD},{PAD})">
					{#each edges as e (e.key)}
						<path d={e.d} class="edge" fill="none" />
					{/each}
				</g>
			</svg>
			{#each visible as nid (nid)}
				{@const node = byId.get(nid)}
				{@const p = layout.pos.get(nid)}
				{@const kc = childCount(nid)}
				{@const open = !!expanded[nid]}
				{#if node && p}
					<button
						class="topic"
						class:root={node.parent === null}
						class:has-kids={kc > 0}
						data-branch-id={nid}
						title={node.summary || node.title}
						style="left:{p.x + PAD}px; top:{p.y + PAD}px; width:{NODE_W}px; height:{NODE_H}px"
						onclick={(e) => onNodeClick(e, nid)}
					>
						<span class="topic-title">{node.title}</span>
						{#if kc > 0}
							<span class="toggle" class:open>
								{#if open}<Minus size={11} />{:else}<Plus size={11} />{/if}
								{#if !open}<span class="kc">{kc}</span>{/if}
							</span>
						{/if}
					</button>
				{/if}
			{/each}
		</div>
	</div>
</div>

<style>
	.card {
		/* Hug the graph so the whole map is visible at full size — no inner scroll,
		   the card grows/shrinks as nodes expand/collapse (xyflow re-measures it). */
		width: max-content;
		max-width: none;
		display: flex;
		flex-direction: column;
		contain: layout paint;
		border-radius: var(--r-lg);
		padding: var(--s-sm) var(--s-md) var(--s-md);
		border: 1px solid rgba(0, 0, 0, 0.06);
		/* Always a light paper surface (palette forced light above), so the graph
		   stays readable in dark theme instead of dark ink on a dark canvas. */
		background: #fff;
		cursor: pointer;
		box-sizing: border-box;
		color: rgba(0, 0, 0, 0.85);
		--ink-rgb: 0, 0, 0;
		color-scheme: light;
		transition:
			transform var(--ease-glass),
			box-shadow var(--ease-glass);
	}
	.card:hover {
		transform: translateY(-2px);
		box-shadow: var(--elev-2);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: var(--s-xs);
	}
	.title {
		font-size: 13px;
		font-weight: 700;
		flex: 1;
		min-width: 0;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: text;
	}
	.title-input {
		flex: 1;
		min-width: 0;
		font-size: 13px;
		font-weight: 700;
		font-family: inherit;
		color: rgba(var(--ink-rgb), 0.9);
		border: 1px solid rgba(var(--ink-rgb), 0.2);
		border-radius: var(--r-sm, 6px);
		padding: 1px 5px;
		background: #fff;
		outline: none;
	}
	.title-input:focus {
		border-color: #6c5ce7;
	}
	.badge {
		font-size: 10px;
		font-weight: 600;
		opacity: 0.5;
		white-space: nowrap;
	}
	.ctl {
		display: inline-flex;
		align-items: center;
		border: none;
		background: transparent;
		border-radius: var(--r-md, 8px);
		padding: 4px;
		cursor: pointer;
		color: rgba(var(--ink-rgb), 0.85);
		opacity: 0.6;
	}
	.ctl:hover {
		opacity: 1;
		background: rgba(var(--ink-rgb), 0.06);
	}
	.viewport {
		/* No scroll — the card sizes to the graph so it always fits in view. */
		overflow: visible;
		border-radius: var(--r-md, 8px);
		background: rgba(var(--ink-rgb), 0.015);
	}
	.graph {
		position: relative;
	}
	.edges {
		position: absolute;
		inset: 0;
		pointer-events: none;
		overflow: visible;
	}
	.edge {
		stroke: rgba(var(--ink-rgb), 0.22);
		stroke-width: 1.5;
	}
	.topic {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 4px;
		box-sizing: border-box;
		padding: 4px 8px;
		border: 1px solid rgba(var(--ink-rgb), 0.12);
		border-radius: var(--r-md, 8px);
		background: #fff;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
		cursor: pointer;
		text-align: left;
		font: inherit;
		color: rgba(var(--ink-rgb), 0.88);
		transition:
			border-color 0.12s,
			box-shadow 0.12s;
	}
	.topic:hover {
		border-color: rgba(var(--ink-rgb), 0.28);
		box-shadow: var(--elev-2);
	}
	.topic.has-kids {
		font-weight: 600;
	}
	.topic.root {
		font-weight: 700;
		border-color: transparent;
		background: #6c5ce7;
		color: #fff;
	}
	.topic-title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 11.5px;
		line-height: 1.25;
	}
	.toggle {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 1px;
		font-size: 10px;
		font-weight: 700;
		opacity: 0.7;
	}
	.root .toggle {
		opacity: 0.95;
	}
	.kc {
		font-size: 9.5px;
	}
</style>
