// Open a URL outside an embed: a native Tauri child window (Heptabase-style,
// bypasses X-Frame-Options) on desktop, a new browser tab in dev.
function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function popOutWindow(url: string): Promise<void> {
	if (isTauri()) {
		const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
		new WebviewWindow(`web-${Date.now().toString(36)}`, {
			url,
			title: url,
			width: 1000,
			height: 800
		});
	} else {
		window.open(url, '_blank', 'noopener,noreferrer');
	}
}

// "Open external". A native window on desktop (the OS-browser path needs the shell
// plugin's JS binding; add it later if true OS-default-browser opening is wanted),
// a new tab in dev.
// ponytail: reuse popOutWindow; swap in @tauri-apps/plugin-shell `open` when added.
export const openExternal = popOutWindow;
