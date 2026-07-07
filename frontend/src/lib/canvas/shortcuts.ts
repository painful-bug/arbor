// Canvas keyboard shortcuts as a pure function: Canvas.svelte delegates its window
// keydown here with a snapshot of UI state + action callbacks. Unit-testable.
import type { Tool } from "./store.svelte";

/** UI-state snapshot + action callbacks the shortcut handler dispatches on. */
export interface CanvasShortcutDeps {
	// State snapshot
	inInput: boolean;
	searchOpen: boolean;
	searchHasMatches: boolean;
	kbOpen: boolean;
	paletteOpen: boolean;
	pendingBranch: boolean;
	openFile: boolean;
	expanded: boolean;
	chatOrSidebarOpen: boolean;
	toolActive: Tool;
	connectPending: boolean;
	selectionCount: number;
	/** True while the user has a text selection inside a card (native copy should win). */
	hasDocSelection: boolean;

	// Actions
	toggleSearch(): void;
	focusKbSearch(): void;
	togglePalette(): void;
	searchNext(): void;
	searchPrev(): void;
	closeOverlays(): void; // search + palette + KB overlay
	confirmBranch(): void;
	dismissBranch(): void;
	startEdit(): void;
	closeFile(): void;
	closeExpand(): void;
	closeChatAndSidebar(): void;
	setTool(t: Tool): void;
	resetTool(): void; // back to hand, clear pending connect
	deleteSelection(): void;
	/** Space: toggle expand/preview of the single selected node; false if none. */
	toggleSpaceTarget(): boolean;
	duplicateSelection(): void;
	copySelection(cut: boolean): void;
	undo(): void;
	redo(): void;
	fitView(): void;
	groupSelection(): void;
	/** ⇧G: dissolve the selected group; false if no group is selected. */
	ungroupSelection(): boolean;
	cleanUp(): void;
	openSettings(): void;
	toggleChat(): void;
}

// Double-press window for CC → Clean Up.
let lastC = 0;

/**
 * Handle one keydown against the canvas shortcut map. Returns true when the
 * event was consumed (preventDefault already called).
 */
export function handleCanvasShortcut(e: KeyboardEvent, a: CanvasShortcutDeps): boolean {
	const mod = e.metaKey || e.ctrlKey;
	const key = e.key;

	// Global search (⌘⇧F) and command palette (⌘⇧P) — work regardless of focus.
	if (mod && e.shiftKey && (key === "f" || key === "F")) {
		e.preventDefault();
		a.toggleSearch();
		return true;
	}
	// ⌘F (no shift): focus the KB overlay's search field if it's open; otherwise,
	// with nothing selected on canvas, open global search instead.
	if (mod && !e.shiftKey && (key === "f" || key === "F")) {
		if (a.kbOpen) {
			e.preventDefault();
			a.focusKbSearch();
			return true;
		}
		if (!a.selectionCount) {
			e.preventDefault();
			a.toggleSearch();
			return true;
		}
	}
	if (mod && e.shiftKey && (key === "p" || key === "P")) {
		e.preventDefault();
		a.togglePalette();
		return true;
	}
	// Platform find-next secondary bindings, active while global search is open.
	if (a.searchOpen && a.searchHasMatches) {
		if ((mod && (key === "g" || key === "G")) || key === "F3") {
			e.preventDefault();
			if (e.shiftKey) a.searchPrev();
			else a.searchNext();
			return true;
		}
	}

	// Escape closes search / palette / KB first (works whether or not their field has
	// focus); return so it doesn't also close an underlying preview in the same press.
	if (key === "Escape" && (a.searchOpen || a.paletteOpen || a.kbOpen)) {
		a.closeOverlays();
		e.preventDefault();
		return true;
	}

	if (!a.inInput) {
		if (key === "Enter" && a.pendingBranch) {
			e.preventDefault();
			a.confirmBranch();
			return true;
		}
		// `e` on an active selection popup: edit the passage in place (vs. Enter = branch).
		if ((key === "e" || key === "E") && a.pendingBranch) {
			e.preventDefault();
			a.startEdit();
			return true;
		}
		// Backspace/Delete: delete selected nodes (also prevents browser back-nav in Tauri).
		if (key === "Backspace" || key === "Delete") {
			e.preventDefault();
			if (a.selectionCount) a.deleteSelection();
			return true;
		}

		// Escape: close panels/modals in priority order; last resort → reset to hand.
		if (key === "Escape") {
			if (a.pendingBranch) {
				a.dismissBranch();
				e.preventDefault();
				return true;
			}
			if (a.openFile) {
				a.closeFile();
				e.preventDefault();
				return true;
			}
			if (a.expanded) {
				a.closeExpand();
				e.preventDefault();
				return true;
			}
			if (a.chatOrSidebarOpen) {
				a.closeChatAndSidebar();
				e.preventDefault();
				return true;
			}
			if (a.toolActive !== "hand" || a.connectPending) {
				a.resetTool();
				e.preventDefault();
				return true;
			}
		}

		// Space: toggle the expanded preview of the selected card/file.
		if (key === " ") {
			if (a.toggleSpaceTarget()) {
				e.preventDefault(); // stop page/canvas scroll
				return true;
			}
		}

		// Tool hotkeys (no modifier).
		if (!e.metaKey && !e.ctrlKey && !e.altKey) {
			const k = key.toLowerCase();
			if (k === "h") {
				a.resetTool();
				e.preventDefault();
				return true;
			}
			if (k === "v") {
				a.setTool("select");
				e.preventDefault();
				return true;
			}
			if (k === "t") {
				a.setTool("text");
				e.preventDefault();
				return true;
			}
			if (k === "d") {
				if (a.toolActive === "select" && a.selectionCount) a.duplicateSelection();
				else a.setTool("duplicate");
				e.preventDefault();
				return true;
			}
			if (k === "c") {
				const now = Date.now();
				if (now - lastC < 350) {
					lastC = 0;
					a.resetTool();
					a.cleanUp();
					e.preventDefault();
					return true;
				}
				lastC = now;
				a.setTool("connect");
				e.preventDefault();
				return true;
			}
			if (k === "u") {
				a.undo();
				e.preventDefault();
				return true;
			}
			if (k === "r") {
				a.redo();
				e.preventDefault();
				return true;
			}
			if (k === "f") {
				a.fitView();
				e.preventDefault();
				return true;
			}
			if (k === "g") {
				if (e.shiftKey) {
					if (a.ungroupSelection()) {
						e.preventDefault();
						return true;
					}
				} else if (a.selectionCount >= 2) {
					a.groupSelection();
					e.preventDefault();
					return true;
				}
			}
		}
	}

	if (mod && key === "," && !a.inInput) {
		e.preventDefault();
		a.openSettings();
		return true;
	}
	if (mod && key === "\\") {
		e.preventDefault();
		a.toggleChat();
		return true;
	}
	if (mod && key === "z" && !a.inInput) {
		e.preventDefault();
		if (e.shiftKey) a.redo();
		else a.undo();
		return true;
	}
	if (
		mod &&
		!e.shiftKey &&
		(key === "c" || key === "C") &&
		!a.inInput &&
		a.selectionCount &&
		!a.hasDocSelection
	) {
		e.preventDefault();
		a.copySelection(false);
		return true;
	}
	if (mod && !e.shiftKey && (key === "x" || key === "X") && !a.inInput && a.selectionCount) {
		e.preventDefault();
		a.copySelection(true);
		return true;
	}
	return false;
}
