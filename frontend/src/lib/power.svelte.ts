// Visibility source of truth: true while the webview is visible. WKWebView maps
// window occlusion/minimize to document.hidden, so this alone covers hidden-window
// power savings without needing separate Tauri focus events.
export const power = $state({ visible: true });

/** Wire document.visibilitychange → power.visible + body[data-hidden]. Call once. */
export function initPower(): void {
	const update = () => {
		power.visible = !document.hidden;
		document.body.toggleAttribute("data-hidden", document.hidden);
	};
	document.addEventListener("visibilitychange", update);
	update();
}
