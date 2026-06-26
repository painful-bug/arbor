// Reactive prefers-reduced-motion flag. Svelte JS transitions (in:scale) ignore the
// CSS media query, so components must check this and skip the spring themselves.
let reduced = $state(false);

if (typeof window !== 'undefined') {
	const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
	reduced = mq.matches;
	mq.addEventListener('change', (e) => (reduced = e.matches));
}

export function reducedMotion(): boolean {
	return reduced;
}
