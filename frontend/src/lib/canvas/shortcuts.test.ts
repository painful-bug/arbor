import { describe, expect, it, vi } from "vitest";
import { type CanvasShortcutDeps, handleCanvasShortcut } from "./shortcuts";

// Minimal KeyboardEvent stand-in (node env has no DOM).
function key(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
	return {
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		preventDefault: vi.fn(),
		...init,
	} as unknown as KeyboardEvent;
}

function deps(over: Partial<CanvasShortcutDeps> = {}): CanvasShortcutDeps {
	return {
		inInput: false,
		searchOpen: false,
		searchHasMatches: false,
		kbOpen: false,
		paletteOpen: false,
		pendingBranch: false,
		openFile: false,
		expanded: false,
		chatOrSidebarOpen: false,
		toolActive: "hand",
		connectPending: false,
		selectionCount: 0,
		toggleSearch: vi.fn(),
		focusKbSearch: vi.fn(),
		togglePalette: vi.fn(),
		searchNext: vi.fn(),
		searchPrev: vi.fn(),
		closeOverlays: vi.fn(),
		confirmBranch: vi.fn(),
		dismissBranch: vi.fn(),
		closeFile: vi.fn(),
		closeExpand: vi.fn(),
		closeChatAndSidebar: vi.fn(),
		setTool: vi.fn(),
		resetTool: vi.fn(),
		deleteSelection: vi.fn(),
		toggleSpaceTarget: vi.fn(() => false),
		duplicateSelection: vi.fn(),
		undo: vi.fn(),
		redo: vi.fn(),
		fitView: vi.fn(),
		groupSelection: vi.fn(),
		cleanUp: vi.fn(),
		openSettings: vi.fn(),
		toggleChat: vi.fn(),
		...over,
	};
}

describe("handleCanvasShortcut", () => {
	it("table: each combo calls exactly its action and returns true", () => {
		const table: [KeyboardEvent, keyof CanvasShortcutDeps, Partial<CanvasShortcutDeps>][] = [
			[key({ key: "F", metaKey: true, shiftKey: true }), "toggleSearch", {}],
			[key({ key: "f", metaKey: true }), "toggleSearch", { selectionCount: 0 }],
			[key({ key: "f", metaKey: true }), "focusKbSearch", { kbOpen: true }],
			[key({ key: "P", metaKey: true, shiftKey: true }), "togglePalette", {}],
			[
				key({ key: "g", metaKey: true }),
				"searchNext",
				{ searchOpen: true, searchHasMatches: true },
			],
			[
				key({ key: "G", metaKey: true, shiftKey: true }),
				"searchPrev",
				{ searchOpen: true, searchHasMatches: true },
			],
			[key({ key: "Escape" }), "closeOverlays", { searchOpen: true }],
			[key({ key: "Escape" }), "closeOverlays", { kbOpen: true }],
			[key({ key: "Enter" }), "confirmBranch", { pendingBranch: true }],
			[key({ key: "Backspace" }), "deleteSelection", { selectionCount: 2 }],
			[key({ key: "Escape" }), "dismissBranch", { pendingBranch: true }],
			[key({ key: "Escape" }), "closeFile", { openFile: true }],
			[key({ key: "Escape" }), "closeExpand", { expanded: true }],
			[key({ key: "Escape" }), "closeChatAndSidebar", { chatOrSidebarOpen: true }],
			[key({ key: "Escape" }), "resetTool", { toolActive: "select" }],
			[key({ key: "h" }), "resetTool", {}],
			[key({ key: "v" }), "setTool", {}],
			[key({ key: "t" }), "setTool", {}],
			[key({ key: "d" }), "setTool", {}],
			[key({ key: "d" }), "duplicateSelection", { toolActive: "select", selectionCount: 1 }],
			[key({ key: "u" }), "undo", {}],
			[key({ key: "r" }), "redo", {}],
			[key({ key: "f" }), "fitView", {}],
			[key({ key: "g" }), "groupSelection", { selectionCount: 2 }],
			[key({ key: ",", metaKey: true }), "openSettings", {}],
			[key({ key: "\\", metaKey: true }), "toggleChat", {}],
			[key({ key: "z", metaKey: true }), "undo", {}],
			[key({ key: "z", metaKey: true, shiftKey: true }), "redo", {}],
		];
		for (const [e, action, over] of table) {
			const d = deps(over);
			expect(handleCanvasShortcut(e, d), `combo ${e.key}`).toBe(true);
			expect(d[action], `action ${String(action)}`).toHaveBeenCalledTimes(1);
			expect(e.preventDefault).toHaveBeenCalled();
		}
	});

	it("double-press C within 350ms triggers Clean Up", () => {
		vi.useFakeTimers();
		const d = deps();
		handleCanvasShortcut(key({ key: "c" }), d);
		expect(d.setTool).toHaveBeenCalledWith("connect");
		vi.advanceTimersByTime(100);
		handleCanvasShortcut(key({ key: "c" }), d);
		expect(d.cleanUp).toHaveBeenCalledTimes(1);
		expect(d.resetTool).toHaveBeenCalledTimes(1);
		vi.useRealTimers();
	});

	it("unmapped keys return false", () => {
		const d = deps();
		expect(handleCanvasShortcut(key({ key: "x" }), d)).toBe(false);
		expect(handleCanvasShortcut(key({ key: "q", metaKey: true }), d)).toBe(false);
	});

	it("plain hotkeys are ignored while typing in an input", () => {
		const d = deps({ inInput: true });
		expect(handleCanvasShortcut(key({ key: "u" }), d)).toBe(false);
		expect(d.undo).not.toHaveBeenCalled();
		// ⌘\ toggles chat even from an input (matches original behavior)
		expect(handleCanvasShortcut(key({ key: "\\", metaKey: true }), d)).toBe(true);
		expect(d.toggleChat).toHaveBeenCalled();
	});

	it("space consumes the event only when a target exists", () => {
		const hit = deps({ toggleSpaceTarget: vi.fn(() => true) });
		expect(handleCanvasShortcut(key({ key: " " }), hit)).toBe(true);
		const miss = deps();
		expect(handleCanvasShortcut(key({ key: " " }), miss)).toBe(false);
	});
});
