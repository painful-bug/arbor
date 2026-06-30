import { describe, it, expect } from 'vitest';
import { applyTextHL, markHTML } from './highlights';

describe('applyTextHL', () => {
	it('marks an exact-case occurrence', () => {
		expect(applyTextHL('<p>Neural networks</p>', ['Neural'])).toBe(
			'<p><mark>Neural</mark> networks</p>'
		);
	});

	it('default mode is case-sensitive (no false marks)', () => {
		expect(applyTextHL('<p>Neural networks</p>', ['neural'])).toBe('<p>Neural networks</p>');
	});

	// Regression: global search is case-insensitive, so its highlight must match
	// regardless of case while preserving the original casing of each hit.
	it('ci mode matches any case and preserves original casing', () => {
		expect(applyTextHL('<p>Neural and NEURAL nets</p>', ['neural'], true)).toBe(
			'<p><mark>Neural</mark> and <mark>NEURAL</mark> nets</p>'
		);
	});

	it('escapes regex special chars in the search term', () => {
		expect(applyTextHL('cost is $5 (cheap)', ['$5'], true)).toBe('cost is <mark>$5</mark> (cheap)');
	});
});

describe('markHTML', () => {
	it('marks the active occurrence with the mark-active class', () => {
		const { html } = markHTML('foo foo foo', ['foo'], { active: 1 });
		expect(html).toBe('<mark>foo</mark> <mark class="mark-active">foo</mark> <mark>foo</mark>');
	});

	it('threads the running count across segments via start/next', () => {
		// Title segment: one hit, ordinals [0], next = 1.
		const title = markHTML('cat', ['cat'], { start: 0, active: 2 });
		expect(title.next).toBe(1);
		expect(title.html).toBe('<mark>cat</mark>'); // active=2 not reached here
		// Answer segment continues at ordinal 1; global active=2 lands on its 2nd hit.
		const answer = markHTML('cat Cat', ['cat'], { start: title.next, active: 2 });
		expect(answer.html).toBe('<mark>cat</mark> <mark class="mark-active">Cat</mark>');
		expect(answer.next).toBe(3);
	});

	it('no active class when active index is out of range (e.g. RAG hit, -1)', () => {
		const { html } = markHTML('foo bar', ['foo'], { active: -1 });
		expect(html).toBe('<mark>foo</mark> bar');
	});
});
