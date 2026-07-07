// Pure helpers for cluster tag reconciliation across Clean Up re-runs. No store
// imports, no I/O — kept testable in isolation (mirrors mindmap-layout.ts style).
import { BLOCKS } from "./cards";

export const clusterKey = (ids: string[]): string => [...ids].sort().join("|");

/** Index of the best matching old cluster for a new one, by member overlap ≥ 50%.
 *  -1 when nothing matches closely enough (treated as a brand-new cluster). */
export function matchCluster(members: string[], old: { key: string; ids: string[] }[]): number {
	const set = new Set(members);
	let best = -1;
	let bestScore = 0;
	old.forEach((o, i) => {
		const hit = o.ids.filter((id) => set.has(id)).length;
		const score = hit / Math.max(members.length, o.ids.length);
		if (score >= 0.5 && score > bestScore) {
			best = i;
			bestScore = score;
		}
	});
	return best;
}

export const clusterColor = (i: number): string => BLOCKS[i % BLOCKS.length];
