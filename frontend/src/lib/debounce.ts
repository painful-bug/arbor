/** Debounce fn by ms. Returned fn has .cancel() and .flush() (flush runs pending call now). */
export function debounce<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
	let t: ReturnType<typeof setTimeout> | null = null;
	let last: A | null = null;
	const run = (...a: A) => {
		last = a;
		if (t) clearTimeout(t);
		t = setTimeout(() => {
			t = null;
			fn(...(last as A));
		}, ms);
	};
	run.cancel = () => {
		if (t) clearTimeout(t);
		t = null;
		last = null;
	};
	run.flush = () => {
		if (t) {
			clearTimeout(t);
			t = null;
			fn(...(last as A));
		}
	};
	return run;
}
