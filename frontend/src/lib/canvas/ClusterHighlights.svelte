<script lang="ts">
	import { ViewportPortal } from '@xyflow/svelte';
	import { flow, settings } from './store.svelte';
	import type { TagData } from './cards';

	// Internal breathing room between the member bbox and the hull edge.
	const PAD = 72;

	// Superellipse (squircle) outline as an SVG path. n≈4 gives the iOS-style
	// rounded-corner look; sampled cheaply since it's a handful of hulls.
	function squirclePath(w: number, h: number, n = 4): string {
		const rx = w / 2;
		const ry = h / 2;
		const steps = 48;
		let d = '';
		for (let i = 0; i <= steps; i++) {
			const t = (i / steps) * Math.PI * 2;
			const ct = Math.cos(t);
			const st = Math.sin(t);
			const x = rx + Math.sign(ct) * rx * Math.abs(ct) ** (2 / n);
			const y = ry + Math.sign(st) * ry * Math.abs(st) ** (2 / n);
			d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)} `;
		}
		return `${d}Z`;
	}

	// One hull per cluster tag; recomputed whenever node positions/anchors change.
	// O(n + Σmembers), short-circuits entirely when the setting is off.
	const clusters = $derived.by(() => {
		if (!settings.highlightClusters) return [];
		const circle = settings.clusterShape === 'circle';
		const byId = new Map(flow.nodes.map((n) => [n.id, n]));
		const out: { id: string; x: number; y: number; w: number; h: number; color: string }[] = [];
		for (const t of flow.nodes) {
			if (t.type !== 'tag') continue;
			const d = t.data as TagData;
			if (!d.anchor || d.anchor.length < 2) continue;
			let minX = Infinity,
				minY = Infinity,
				maxX = -Infinity,
				maxY = -Infinity,
				found = false;
			for (const id of d.anchor) {
				const n = byId.get(id);
				if (!n) continue;
				found = true;
				const w = n.measured?.width ?? n.width ?? 400;
				const h = n.measured?.height ?? n.height ?? 200;
				minX = Math.min(minX, n.position.x);
				minY = Math.min(minY, n.position.y);
				maxX = Math.max(maxX, n.position.x + w);
				maxY = Math.max(maxY, n.position.y + h);
			}
			if (!found) continue;
			let bw = maxX - minX + PAD * 2;
			let bh = maxY - minY + PAD * 2;
			let x = minX - PAD;
			let y = minY - PAD;
			// An ellipse only touches the bbox at its edge midpoints. A full √2 grow
			// to cover corners makes it viewport-sized (huge animated repaint = lag),
			// so grow modestly and accept slight corner poke.
			if (circle) {
				const gx = bw * 0.09;
				const gy = bh * 0.09;
				x -= gx;
				y -= gy;
				bw += gx * 2;
				bh += gy * 2;
			}
			out.push({ id: t.id, x, y, w: bw, h: bh, color: d.color ?? 'lilac' });
		}
		return out;
	});
	const isCircle = $derived(settings.clusterShape === 'circle');
</script>

{#if clusters.length}
	<ViewportPortal target="back">
		{#each clusters as c (c.id)}
			<div class="hull" style="transform: translate({c.x}px, {c.y}px); width:{c.w}px; height:{c.h}px;">
				<svg width="100%" height="100%" viewBox="0 0 {c.w} {c.h}" aria-hidden="true">
					{#if isCircle}
						<ellipse
							cx={c.w / 2}
							cy={c.h / 2}
							rx={c.w / 2 - 2}
							ry={c.h / 2 - 2}
							style="fill: var(--block-{c.color}); stroke: var(--block-{c.color});"
							class="hull-shape"
						/>
					{:else}
						<path
							d={squirclePath(c.w - 4, c.h - 4)}
							transform="translate(2 2)"
							style="fill: var(--block-{c.color}); stroke: var(--block-{c.color});"
							class="hull-shape"
						/>
					{/if}
				</svg>
			</div>
		{/each}
	</ViewportPortal>
{/if}

<style>
	.hull {
		position: absolute;
		top: 0;
		left: 0;
		pointer-events: none;
		/* own compositor layer so the marching-ants repaint stays local, not page-wide */
		will-change: transform;
		contain: layout paint;
	}
	.hull-shape {
		fill-opacity: 0.1;
		stroke-width: 1.5;
		stroke-opacity: 0.55;
		stroke-dasharray: 5;
		vector-effect: non-scaling-stroke;
		animation: dashdraw 0.5s linear infinite;
	}
	@keyframes dashdraw {
		to {
			stroke-dashoffset: -10;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.hull-shape {
			animation: none;
		}
	}
</style>
