// URL helpers shared by paste/drop/link-click → web embed cards.

// Return a normalized http(s) URL if `text` is a bare URL, else null.
// Used to decide whether a paste/drop should become a web embed card.
export function asUrl(text: string): string | null {
	const t = (text ?? '').trim();
	if (!t || /\s/.test(t)) return null; // a URL has no internal whitespace
	try {
		const u = new URL(t);
		return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
	} catch {
		return null;
	}
}

// Favicon URL for a page (Google's resolver — no key, cached). Falls back to '' if unparsable.
export function faviconFor(url: string): string {
	try {
		const host = new URL(url).hostname;
		return `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
	} catch {
		return '';
	}
}

// Extract a YouTube video id from any watch/share/embed/short URL form, else null.
export function youtubeId(url: string): string | null {
	try {
		const u = new URL(url);
		if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
		if (/^(www\.)?(youtube\.com|youtube-nocookie\.com)$/.test(u.hostname)) {
			if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
			if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
			return u.searchParams.get('v');
		}
	} catch { /* not a youtube url */ }
	return null;
}

// True for hosts we know are iframe-embeddable players. These skip the
// X-Frame-Options "blocked" heuristic in WebCard — onload always means loaded.
export function isMediaEmbed(url: string): boolean {
	try {
		const h = new URL(url).hostname;
		return /(^|\.)(youtube\.com|youtube-nocookie\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)$/.test(h);
	} catch {
		return false;
	}
}

// Thumbnail poster for a YouTube url (hqdefault always exists), else null.
export function youtubeThumb(url: string): string | null {
	const id = youtubeId(url);
	return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

// Transform watch/share URLs to their embeddable equivalents.
// YouTube: /watch?v= | youtu.be/ | /shorts/ → youtube-nocookie /embed/VIDEO_ID
// Vimeo:  vimeo.com/ID → player.vimeo.com/video/ID
// `autoplay` appends &autoplay=1 (use when the user clicks Load).
export function toEmbedUrl(url: string, autoplay = false): string {
	try {
		const id = youtubeId(url);
		if (id) {
			const ap = autoplay ? '&autoplay=1' : '';
			return `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1${ap}`;
		}
		const u = new URL(url);
		if (/^(www\.)?vimeo\.com$/.test(u.hostname)) {
			const vid = u.pathname.split('/').filter(Boolean)[0];
			if (vid && /^\d+$/.test(vid)) {
				return `https://player.vimeo.com/video/${vid}${autoplay ? '?autoplay=1' : ''}`;
			}
		}
	} catch { /* return original */ }
	return url;
}

// Short label for a URL: hostname + truncated path. For card headers/posters.
export function labelFor(url: string): string {
	try {
		const u = new URL(url);
		const path = u.pathname === '/' ? '' : u.pathname;
		const s = u.hostname.replace(/^www\./, '') + path;
		return s.length > 48 ? s.slice(0, 47) + '…' : s;
	} catch {
		return url;
	}
}
