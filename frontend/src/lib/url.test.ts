import { describe, it, expect } from 'vitest';
import { asUrl, labelFor, toEmbedUrl, isMediaEmbed, youtubeThumb, youtubeId } from './url';

describe('asUrl', () => {
	it('accepts http(s) URLs and normalizes', () => {
		expect(asUrl('https://a.com/x')).toBe('https://a.com/x');
		expect(asUrl('  http://a.com  ')).toBe('http://a.com/');
	});
	it('rejects non-URLs, other protocols, and text with a URL inside', () => {
		expect(asUrl('not a url')).toBeNull();
		expect(asUrl('ftp://a.com')).toBeNull();
		expect(asUrl('hello world https://a.com')).toBeNull();
		expect(asUrl('')).toBeNull();
	});
});

describe('labelFor', () => {
	it('strips www and root path', () => {
		expect(labelFor('https://www.x.com/')).toBe('x.com');
		expect(labelFor('https://x.com/a/b')).toBe('x.com/a/b');
	});
});

const ID = 'dQw4w9WgXcQ';

describe('youtubeId', () => {
	it('extracts id from every YouTube url form', () => {
		expect(youtubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
		expect(youtubeId(`https://youtu.be/${ID}`)).toBe(ID);
		expect(youtubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
		expect(youtubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
	});
	it('returns null for non-YouTube urls', () => {
		expect(youtubeId('https://vimeo.com/12345')).toBeNull();
		expect(youtubeId('https://example.com/x')).toBeNull();
		expect(youtubeId('not a url')).toBeNull();
	});
});

describe('toEmbedUrl', () => {
	it('maps YouTube forms to nocookie embed', () => {
		const want = `https://www.youtube-nocookie.com/embed/${ID}?enablejsapi=1`;
		expect(toEmbedUrl(`https://www.youtube.com/watch?v=${ID}`)).toBe(want);
		expect(toEmbedUrl(`https://youtu.be/${ID}`)).toBe(want);
		expect(toEmbedUrl(`https://www.youtube.com/shorts/${ID}`)).toBe(want);
	});
	it('appends autoplay when requested', () => {
		expect(toEmbedUrl(`https://youtu.be/${ID}`, true)).toBe(
			`https://www.youtube-nocookie.com/embed/${ID}?enablejsapi=1&autoplay=1`
		);
	});
	it('maps Vimeo and leaves plain urls untouched', () => {
		expect(toEmbedUrl('https://vimeo.com/12345')).toBe('https://player.vimeo.com/video/12345');
		expect(toEmbedUrl('https://example.com/page')).toBe('https://example.com/page');
	});
});

describe('isMediaEmbed', () => {
	it('true for known players, false otherwise', () => {
		expect(isMediaEmbed(`https://www.youtube.com/watch?v=${ID}`)).toBe(true);
		expect(isMediaEmbed(`https://youtu.be/${ID}`)).toBe(true);
		expect(isMediaEmbed('https://vimeo.com/12345')).toBe(true);
		expect(isMediaEmbed('https://example.com')).toBe(false);
		// guard against substring spoofing
		expect(isMediaEmbed('https://youtube.com.evil.com')).toBe(false);
	});
});

describe('youtubeThumb', () => {
	it('returns hqdefault thumb for YouTube, null otherwise', () => {
		expect(youtubeThumb(`https://youtu.be/${ID}`)).toBe(`https://i.ytimg.com/vi/${ID}/hqdefault.jpg`);
		expect(youtubeThumb('https://example.com')).toBeNull();
	});
});
