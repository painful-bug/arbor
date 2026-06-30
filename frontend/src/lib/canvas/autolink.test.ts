import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/svelte';
import { reconcileSemanticEdges, semEdgeId, isSemanticEdge } from './autolink';

const manual = (id: string, source: string, target: string): Edge => ({
	id,
	source,
	target,
	type: 'bezier'
});
const auto = (a: string, b: string): Edge => {
	const [lo, hi] = a < b ? [a, b] : [b, a];
	return { id: semEdgeId(a, b), source: lo, target: hi, type: 'bezier', data: { auto: true } };
};

describe('reconcileSemanticEdges', () => {
	it('adds semantic edges for new neighbors', () => {
		const out = reconcileSemanticEdges('a', ['b', 'c'], []);
		expect(out.map((e) => e.id).sort()).toEqual([semEdgeId('a', 'b'), semEdgeId('a', 'c')].sort());
		expect(out.every(isSemanticEdge)).toBe(true);
	});

	it('removes stale auto edges the node no longer relates to', () => {
		const out = reconcileSemanticEdges('a', ['b'], [auto('a', 'c')]);
		expect(out.some((e) => e.id === semEdgeId('a', 'c'))).toBe(false);
		expect(out.some((e) => e.id === semEdgeId('a', 'b'))).toBe(true);
	});

	it('preserves manual/branch edges and other nodes auto edges', () => {
		const edges = [manual('e1', 'a', 'b'), manual('e2', 'x', 'y'), auto('x', 'z')];
		const out = reconcileSemanticEdges('a', [], edges);
		expect(out.some((e) => e.id === 'e1')).toBe(true); // manual touching a — kept
		expect(out.some((e) => e.id === 'e2')).toBe(true);
		expect(out.some((e) => e.id === semEdgeId('x', 'z'))).toBe(true); // other node's auto — kept
	});

	it('caps degree at 2', () => {
		const out = reconcileSemanticEdges('a', ['b', 'c', 'd', 'e', 'f'], []);
		expect(out.filter((e) => e.source === 'a' || e.target === 'a').length).toBe(2);
	});

	it('produces a stable undirected id regardless of order', () => {
		expect(semEdgeId('a', 'b')).toBe(semEdgeId('b', 'a'));
		// reconciling from either side does not duplicate the edge
		const fromA = reconcileSemanticEdges('a', ['b'], []);
		const fromB = reconcileSemanticEdges('b', ['a'], fromA);
		expect(fromB.filter((e) => e.id === semEdgeId('a', 'b')).length).toBe(1);
	});

	it('ignores self-references', () => {
		const out = reconcileSemanticEdges('a', ['a', 'b'], []);
		expect(out.map((e) => e.id)).toEqual([semEdgeId('a', 'b')]);
	});
});
