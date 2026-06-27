import { describe, it, expect } from 'vitest';
import { kindOf } from './files';

describe('kindOf', () => {
	it('detects by mime then extension', () => {
		expect(kindOf('a.pdf', '')).toBe('pdf');
		expect(kindOf('x', 'application/pdf')).toBe('pdf');
		expect(kindOf('notes.md', '')).toBe('markdown');
		expect(kindOf('r.docx', '')).toBe('docx');
		expect(kindOf('x', 'image/png')).toBe('image');
		expect(kindOf('log.txt', '')).toBe('text');
		expect(kindOf('data.bin', 'application/octet-stream')).toBe('other');
	});
});
