// Semantic force-clustering for the "Clean Up" (CC) action. Pure layout math:
// given each node's embedding vector + size + current position, and the canvas
// edges, lay nodes out so semantically-similar AND connected cards sit close and
// unrelated ones drift apart. No type buckets, no backdrops — clusters are read
// purely from spatial proximity. Deterministic.
//
// BGE embeddings have a high similarity baseline (even unrelated cards score
// ~0.3–0.5), so a plain force layout collapses into one blob — repulsion can't
// pull apart a fully-linked graph. So we detect communities (Louvain) on the
// blended similarity+edge graph, drop each community into its own grid cell with
// big gaps between cells, then settle each cluster locally with a force sim.
import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceCollide,
	forceX,
	forceY,
	type SimulationNodeDatum,
	type SimulationLinkDatum,
} from "d3-force";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";

export interface ArrangeNode {
	id: string;
	vec: number[]; // L2-normalized embedding (zero vector ⇒ no similarity links)
	w: number;
	h: number;
	x: number; // current position (unused for layout now; kept for the API)
	y: number;
}

export interface ArrangeEdge {
	source: string;
	target: string;
}

// A spacing-independent description of the layout: each card's grid cell + its
// offset from that cell's center. The actual pixel positions are derived from
// this by place(layout, gap) — clusters are decoupled, so changing the gutter
// just rescales the grid without re-running the (expensive) embed + simulation.
export interface ArrangeLayout {
	cellBase: number; // cell size at gap 0 (≈ 2× the biggest cluster radius)
	unit: number; // px added to the cell per unit of gap (≈ avg card radius)
	cols: number;
	nodes: Record<string, { col: number; row: number; lx: number; ly: number }>;
}

const SIM_K = 4; // similarity links per node
const SIM_FLOOR = 0.3; // min cosine to draw a similarity link
const TICKS = 400;
const PAD = 36; // extra gap added to each card's collision radius (breathing room)
const REF_GAP = 8; // gutter (in avg-radius units) the simulation is solved at

// Derive pixel positions from a layout at a given inter-cluster gap (avg-radius
// units). Pure + instant — this is what the spacing slider calls on every tick.
export function place(layout: ArrangeLayout, gap: number): Record<string, { x: number; y: number }> {
	const cell = layout.cellBase + Math.max(0, gap) * layout.unit;
	const out: Record<string, { x: number; y: number }> = {};
	for (const id in layout.nodes) {
		const { col, row, lx, ly } = layout.nodes[id];
		out[id] = { x: Math.round(col * cell + lx), y: Math.round(row * cell + ly) };
	}
	return out;
}

// Deterministic PRNG so Louvain (and thus the whole layout) is reproducible.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Vectors are L2-normalized upstream, so cosine = dot product.
function cosine(a: number[], b: number[]): number {
	if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot;
}

interface SimNode extends SimulationNodeDatum {
	id: string;
	r: number; // collision radius ≈ half-diagonal
	cx: number; // assigned cluster-cell center
	cy: number;
}
interface SimLink extends SimulationLinkDatum<SimNode> {
	source: string | SimNode;
	target: string | SimNode;
	strength: number; // 0..1
	distance: number;
}

// undirected key so a pair never gets two links
const pairKey = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`);

export function arrange(nodes: ArrangeNode[], edges: ArrangeEdge[]): ArrangeLayout {
	const empty: ArrangeLayout = { cellBase: 0, unit: 0, cols: 1, nodes: {} };
	if (nodes.length === 0) return empty;
	if (nodes.length === 1)
		return { ...empty, nodes: { [nodes[0].id]: { col: 0, row: 0, lx: nodes[0].x, ly: nodes[0].y } } };

	const ids = new Set(nodes.map((n) => n.id));

	// Accumulate a blended weight per pair: similarity (cosine→0.3..1) + edge (0.8).
	// Capped at 1. Edge present ⇒ guaranteed-close spring; similarity arranges the rest.
	const weight = new Map<string, number>();
	const add = (a: string, b: string, w: number) => {
		if (a === b) return;
		const k = pairKey(a, b);
		weight.set(k, Math.min(1, (weight.get(k) ?? 0) + w));
	};

	// Similarity links: each node's top-K cosine neighbors above the floor.
	for (let i = 0; i < nodes.length; i++) {
		const scored: { id: string; s: number }[] = [];
		for (let j = 0; j < nodes.length; j++) {
			if (i === j) continue;
			const s = cosine(nodes[i].vec, nodes[j].vec);
			if (s >= SIM_FLOOR) scored.push({ id: nodes[j].id, s });
		}
		scored.sort((p, q) => q.s - p.s);
		for (const { id, s } of scored.slice(0, SIM_K)) add(nodes[i].id, id, s * 0.5);
	}

	// Edge links: every canvas edge whose both ends are in scope. Tracked so they
	// survive the cross-cluster link cull below (drawn connections always count).
	const edgePairs = new Set<string>();
	for (const e of edges) {
		if (ids.has(e.source) && ids.has(e.target)) {
			add(e.source, e.target, 0.8);
			edgePairs.add(pairKey(e.source, e.target));
		}
	}

	// ── Community detection ──────────────────────────────────────────────────
	// Build a weighted undirected graph and run Louvain. Nodes are inserted in a
	// fixed order and Louvain gets a seeded RNG, so communities are deterministic.
	const g = new Graph({ type: "undirected" });
	for (const n of nodes) g.addNode(n.id);
	for (const [k, w] of weight) {
		const [a, b] = k.split(" ");
		if (!g.hasEdge(a, b)) g.addEdge(a, b, { weight: w });
	}
	const community: Record<string, number> = louvain(g, {
		rng: mulberry32(42),
		getEdgeWeight: "weight",
	});

	// Group members by community, in a deterministic order.
	const byComm = new Map<number, string[]>();
	for (const n of nodes) {
		const c = community[n.id];
		(byComm.get(c) ?? byComm.set(c, []).get(c)!).push(n.id);
	}
	const comms = [...byComm.entries()].sort((a, b) => a[0] - b[0]);

	const sizeById = new Map<string, { w: number; h: number }>();
	for (const n of nodes) sizeById.set(n.id, { w: n.w, h: n.h });
	const radiusOf = (id: string) => {
		const s = sizeById.get(id)!;
		return Math.hypot(s.w, s.h) / 2 + PAD;
	};
	const avgR =
		nodes.reduce((s, n) => s + Math.hypot(n.w, n.h) / 2 + PAD, 0) / nodes.length;

	// ── Place clusters on a grid with big gaps, members in a ring per cell ────
	// Cell size fits the largest cluster (a roughly circular packing of its cards);
	// the gutter guarantees visible empty space between clusters so each reads as a
	// distinct island.
	const clusterRadius = (size: number) => avgR * (0.8 + 0.7 * Math.sqrt(size));
	const maxClusterR = Math.max(...comms.map(([, m]) => clusterRadius(m.length)));
	const cellBase = 2 * maxClusterR; // cell at gap 0
	const cell = cellBase + REF_GAP * avgR; // solve the sim at the reference gap
	const cols = Math.ceil(Math.sqrt(comms.length));

	// Seed every node near its cluster center (ring-packed by member index), so the
	// simulation starts already separated and only tidies locally from there.
	const centerById = new Map<string, { x: number; y: number }>();
	const seed = new Map<string, { x: number; y: number }>();
	comms.forEach(([, members], ci) => {
		const col = ci % cols;
		const row = Math.floor(ci / cols);
		const cx = col * cell;
		const cy = row * cell;
		members.forEach((id, mi) => {
			centerById.set(id, { x: cx, y: cy });
			// golden-angle spiral → even, deterministic packing around the center
			const ang = mi * 2.399963229728653;
			const rad = mi === 0 ? 0 : avgR * 0.9 * Math.sqrt(mi);
			seed.set(id, { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad });
		});
	});

	const simNodes: SimNode[] = nodes.map((n) => {
		const s = seed.get(n.id)!;
		const c = centerById.get(n.id)!;
		return { id: n.id, x: s.x, y: s.y, r: radiusOf(n.id), cx: c.x, cy: c.y };
	});

	// Links tighten members within a cluster. Cross-cluster similarity links are
	// CULLED so clusters don't pull each other inward and close the gaps — only
	// drawn edges are allowed to cross (connections are always respected).
	const links: SimLink[] = [];
	for (const [k, w] of weight) {
		const [a, b] = k.split(" ");
		if (community[a] !== community[b] && !edgePairs.has(k)) continue;
		links.push({ source: a, target: b, strength: w, distance: avgR * (2 + (1 - w) * 2) });
	}

	const sim = forceSimulation(simNodes)
		.force(
			"link",
			forceLink<SimNode, SimLink>(links)
				.id((d) => d.id)
				.distance((d) => d.distance)
				.strength((d) => d.strength),
		)
		// Repulsion is LOCAL (distanceMax) — it only declutters cards inside the same
		// cluster. Global repulsion would push clusters into each other's cells and
		// erase the gaps; here the grid does the separating, not charge.
		.force("charge", forceManyBody().strength(-avgR * 2).distanceMax(avgR * 2.5))
		.force("collide", forceCollide<SimNode>().radius((d) => d.r).iterations(4))
		// Strong pull toward the assigned cell center keeps each cluster compact and
		// anchored in its own cell — this is what holds the gaps open between islands.
		.force("x", forceX<SimNode>((d) => d.cx).strength(0.5))
		.force("y", forceY<SimNode>((d) => d.cy).strength(0.5))
		.stop();

	for (let i = 0; i < TICKS; i++) sim.tick();

	// forceCollide is a soft circle constraint (capped iterations, fighting the center
	// pull), so cards can still overlap. Resolve it HARD per cluster: iterative AABB
	// separation on the real rectangles guarantees no two cards overlap. Members are
	// pushed apart along their axis of least penetration; deterministic, so the layout
	// stays reproducible. ponytail: O(members² · iters) per cluster, caps at 200 iters —
	// switch to a sweep-and-prune grid if a cluster ever holds thousands of cards.
	const byId = new Map(simNodes.map((n) => [n.id, n]));
	const GAP = PAD; // min empty gutter between any two card rectangles (px)
	function separate(members: string[]): void {
		const ms = members.map((id) => byId.get(id)!);
		for (let iter = 0; iter < 200; iter++) {
			let moved = false;
			for (let i = 0; i < ms.length; i++) {
				for (let j = i + 1; j < ms.length; j++) {
					const a = ms[i];
					const b = ms[j];
					const sa = sizeById.get(a.id)!;
					const sb = sizeById.get(b.id)!;
					const minDX = (sa.w + sb.w) / 2 + GAP;
					const minDY = (sa.h + sb.h) / 2 + GAP;
					let dx = (b.x ?? 0) - (a.x ?? 0);
					let dy = (b.y ?? 0) - (a.y ?? 0);
					// Exactly coincident → deterministic nudge so the push has a direction.
					if (dx === 0 && dy === 0) dx = a.id < b.id ? -1 : 1;
					const ox = minDX - Math.abs(dx);
					const oy = minDY - Math.abs(dy);
					if (ox <= 0 || oy <= 0) continue; // not overlapping on at least one axis
					if (ox < oy) {
						const push = (ox / 2) * (dx < 0 ? -1 : 1);
						a.x = (a.x ?? 0) - push;
						b.x = (b.x ?? 0) + push;
					} else {
						const push = (oy / 2) * (dy < 0 ? -1 : 1);
						a.y = (a.y ?? 0) - push;
						b.y = (b.y ?? 0) + push;
					}
					moved = true;
				}
			}
			if (!moved) break;
		}
	}
	for (const [, members] of comms) separate(members);

	// Record each card as its cell + offset from that cell's center. Because the
	// clusters are decoupled, these offsets hold for any gap — place() just rescales.
	// cellBase is recomputed from the ACTUAL post-separation cluster extent (not the
	// pre-sim heuristic) so adjacent cells never overlap, even at gap 0.
	let maxExtent = 0;
	const out: ArrangeLayout = { cellBase, unit: avgR, cols, nodes: {} };
	comms.forEach(([, members], ci) => {
		const col = ci % cols;
		const row = Math.floor(ci / cols);
		const cx = col * cell;
		const cy = row * cell;
		for (const id of members) {
			const n = byId.get(id)!;
			const lx = (n.x ?? cx) - cx;
			const ly = (n.y ?? cy) - cy;
			out.nodes[id] = { col, row, lx, ly };
			maxExtent = Math.max(maxExtent, Math.hypot(lx, ly) + radiusOf(id));
		}
	});
	out.cellBase = Math.max(cellBase, 2 * maxExtent);
	return out;
}
