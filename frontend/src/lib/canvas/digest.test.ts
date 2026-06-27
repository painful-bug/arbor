import { describe, it, expect } from 'vitest';
import { digestFrom } from './store.svelte';

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
