// Single JS home for Arbor's motion. Every Svelte transition and timing constant
// lives here so the design language stays consistent and tweakable in one place.
// (CSS @keyframes + the --spring-*/--ease-glass custom props necessarily live in
// theme/tokens.css — this module is the JS counterpart; keep the two in sync.)
import { backOut, cubicOut } from "svelte/easing";
import { fade, scale, type TransitionConfig } from "svelte/transition";
import { reducedMotion } from "./motion.svelte";

export { backOut, cubicOut };

/** Durations (ms) — mirror the tokens.css motion scale. */
export const DUR = {
	fast: 150,
	glass: 220,
	pane: 300,
	snappy: 320,
	swoop: 460,
	bouncy: 480,
} as const;

export const EASE = { backOut, glass: cubicOut } as const;

/** Standard "pop" for overlays/menus/dialogs — the scale+backOut spring used app-wide. */
export function popScale(
	node: Element,
	opts: { duration?: number; start?: number } = {},
): TransitionConfig {
	if (reducedMotion()) return { duration: 0 };
	return scale(node, {
		duration: opts.duration ?? DUR.glass,
		start: opts.start ?? 0.94,
		opacity: 0,
		easing: backOut,
	});
}

/** Soft fade for backdrops / overlays. */
export function overlayFade(node: Element, opts: { duration?: number } = {}): TransitionConfig {
	return fade(node, { duration: reducedMotion() ? 0 : (opts.duration ?? DUR.fast) });
}

/** Canvas ↔ Library cross-transition: spring scale + drop. */
export function swoop(_node: Element): TransitionConfig {
	if (reducedMotion()) return { duration: 0 };
	return {
		duration: DUR.swoop,
		easing: backOut,
		css: (t, u) => `transform: scale(${0.86 + 0.14 * t}) translateY(${u * 48}px); opacity: ${t}`,
	};
}

/** Split-view pane entrance: swoop in from the side while scaling up. Reversible (out). */
export function splitSwoopIn(_node: Element): TransitionConfig {
	if (reducedMotion()) return { duration: 0 };
	return {
		duration: DUR.pane,
		easing: backOut,
		css: (t, u) => `transform: translateX(${u * 36}px) scale(${0.92 + 0.08 * t}); opacity: ${t}`,
	};
}
