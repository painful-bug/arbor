// Cosmetic platform detection: shortcut glyphs + find-next key choice.
// ponytail: navigator sniff — no Tauri OS plugin needed to draw a ⌘ vs Ctrl.
export const isMac =
	typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || navigator.userAgent);

export const modLabel = isMac ? '⌘' : 'Ctrl';
