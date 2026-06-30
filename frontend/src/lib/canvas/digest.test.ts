import { describe, it, expect } from 'vitest';
import type { Edge } from '@xyflow/svelte';
import { digestFrom, connectedIds, connectedDigestFrom } from './store.svelte';

describe('digestFrom', () => {
	const cards = [
		{ id: 'a', title: 'AI fairness', lastAnswer: '  Bias detection\nmethods compared.  ' },
		{ id: 'b', title: 'Web research', lastAnswer: '' },
		{ id: 'c', title: '   ', lastAnswer: 'no title, skipped' }
	];

	it('excludes the current card and untitled cards, truncates + collapses whitespace', () => {
		const out = digestFrom(cards, 'a');
		expect(out).not.toContain('AI fairness'); // excluded (self)
		expect(out).toContain('- "Web research"'); // titled, empty answer → bare
		expect(out).not.toContain('skipped'); // blank title dropped
	});

	it('truncates snippets to 120 chars', () => {
		const long = 'x'.repeat(300);
		const out = digestFrom([{ id: 'z', title: 'T', lastAnswer: long }], 'other');
		expect(out).toContain('x'.repeat(120));
		expect(out).not.toContain('x'.repeat(121));
	});

	it('returns empty string when nothing qualifies', () => {
		expect(digestFrom([{ id: 'a', title: 'self', lastAnswer: '' }], 'a')).toBe('');
	});
});

describe('connectedIds', () => {
	const manual = (id: string, source: string, target: string): Edge => ({ id, source, target, type: 'bezier' });

	it('finds neighbors in either edge direction', () => {
		const edges = [manual('e1', 'a', 'b'), manual('e2', 'c', 'a')];
		expect([...connectedIds('a', edges)].sort()).toEqual(['b', 'c']);
	});

	it('ignores edges that do not touch the node', () => {
		const edges = [manual('e1', 'x', 'y')];
		expect(connectedIds('a', edges).size).toBe(0);
	});

	it('excludes self-loops', () => {
		const edges = [manual('e1', 'a', 'a')];
		expect(connectedIds('a', edges).size).toBe(0);
	});
});

describe('connectedDigestFrom', () => {
	it('renders cards, notes, and files with full headers, prioritized over generic digest', () => {
		const out = connectedDigestFrom([
			{ kind: 'card', title: 'Linked card', body: 'full prompt and answer text' },
			{ kind: 'text', title: '', body: 'note body' },
			{ kind: 'file', title: 'doc.pdf', body: 'extracted file preview' }
		]);
		expect(out).toContain('## Connected to this card');
		expect(out).toContain('prioritize them over the "Other threads" section');
		expect(out).toContain('### "Linked card"\nfull prompt and answer text');
		expect(out).toContain('### [note]\nnote body');
		expect(out).toContain('### [file: doc.pdf]\nextracted file preview');
	});

	it('shows a placeholder for an unindexed file instead of dropping it', () => {
		const out = connectedDigestFrom([{ kind: 'file', title: 'new.pdf', body: '' }]);
		expect(out).toContain('### [file: new.pdf]\n(not yet indexed)');
	});

	it('skips empty cards and notes', () => {
		const out = connectedDigestFrom([{ kind: 'card', title: 'Empty', body: '' }]);
		expect(out).toBe('');
	});

	it('returns empty string for no connected items', () => {
		expect(connectedDigestFrom([])).toBe('');
	});
});
