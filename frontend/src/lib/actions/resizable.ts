// Svelte action for left-edge drag-resize on right-side panels.
// Usage: <div use:resizable={{ min, max, getWidth, onwidth }} />
export interface ResizableOptions {
	min: number;
	max: number | (() => number);
	getWidth: () => number;
	onwidth: (w: number) => void;
	onstart?: () => void;
	onend?: () => void;
}

export function resizable(node: HTMLElement, opts: ResizableOptions) {
	function pointerdown(e: PointerEvent) {
		e.preventDefault();
		opts.onstart?.();
		const startX = e.clientX;
		const startW = opts.getWidth();
		const maxW = typeof opts.max === 'function' ? opts.max() : opts.max;
		const move = (ev: PointerEvent) => {
			opts.onwidth(Math.max(opts.min, Math.min(maxW, startW + startX - ev.clientX)));
		};
		const up = () => {
			opts.onend?.();
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}
	node.addEventListener('pointerdown', pointerdown);
	return {
		update(newOpts: ResizableOptions) { opts = newOpts; },
		destroy() { node.removeEventListener('pointerdown', pointerdown); }
	};
}
