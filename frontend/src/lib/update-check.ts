// Timestamp-gated update check: replaces a persistent 6h setInterval (a power leak
// that kept firing while the app was hidden/minimized) with a check that only runs
// at most every 6h, triggered by mount + the window becoming visible again.
const INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastCheck = -Infinity; // unset — first call always runs regardless of now()

/** Run `check()` if at least 6h have passed since the last run (per `now()`). */
export async function maybeCheckUpdates(
	now: () => number,
	check: () => Promise<void>,
): Promise<void> {
	const t = now();
	if (t - lastCheck < INTERVAL_MS) return;
	lastCheck = t;
	await check();
}

/** Test-only: reset the gate. */
export function resetUpdateCheckGate(): void {
	lastCheck = -Infinity;
}
