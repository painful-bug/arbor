// Pure right-click menu content builder — one function per surface, no DOM/Svelte
// imports so it's testable in the node vitest env. Canvas.svelte maps `icon` (a
// string key) to the actual lucide Component and renders `MenuEntry[][]` as
// divider-separated sections in CardContextMenu.
//
// Norms followed (NN/g + Figma/Miro precedent): frequency-ordered, grouped with
// dividers, inapplicable items OMITTED (not grayed), destructive action last.

export type MenuSurface =
	| "card"
	| "web"
	| "file"
	| "text"
	| "tag"
	| "mindmap"
	| "group"
	| "multi"
	| "pane";

export interface MenuCtx {
	selectionCount: number;
	streaming?: boolean; // card: disable Retry mid-stream
	hasOpenFile?: boolean; // file: Split View needs a primary pane open
	isOpenFile?: boolean; // file: this node IS the open primary pane
	branchId?: string | null; // mindmap: right-click landed on a branch row
	locked?: boolean; // phase 2: node is drag-locked
	caps?: {
		clipboard?: boolean;
		zorder?: boolean;
		align?: boolean;
	};
	canPaste?: boolean;
	canUndo?: boolean;
	canRedo?: boolean;
	hasNodes?: boolean; // pane: canvas has at least one node
	isDriveLinked?: boolean; // phase 5: node.data.drive is set
}

export interface MenuEntry {
	id: string;
	label: string;
	icon: string; // icon key — Canvas owns the string→Component map
	hint?: string; // right-aligned shortcut label, e.g. "D", "⌫", "⇧G"
	danger?: boolean;
	disabled?: boolean;
}

type Section = MenuEntry[];

function clipboardSection(ctx: MenuCtx): Section {
	if (!ctx.caps?.clipboard) return [];
	return [
		{ id: "copy", label: "Copy", icon: "copy", hint: "⌘C" },
		{ id: "cut", label: "Cut", icon: "scissors", hint: "⌘X" },
	];
}

function zorderSection(ctx: MenuCtx): Section {
	if (!ctx.caps?.zorder) return [];
	return [
		{ id: "bring-front", label: "Bring to Front", icon: "front" },
		{ id: "send-back", label: "Send to Back", icon: "back" },
		ctx.locked
			? { id: "unlock", label: "Unlock", icon: "unlock" }
			: { id: "lock", label: "Lock", icon: "lock" },
	];
}

function duplicateEntry(): MenuEntry {
	return { id: "duplicate", label: "Duplicate", icon: "duplicate", hint: "D" };
}

function deleteEntry(label = "Delete"): MenuEntry {
	return { id: "delete", label, icon: "delete", hint: "⌫", danger: true };
}

export function menuItemsFor(surface: MenuSurface, ctx: MenuCtx): MenuEntry[][] {
	switch (surface) {
		case "card": {
			const sections: Section[] = [
				[
					{ id: "continue", label: "Continue with AI", icon: "continue" },
					{ id: "retry", label: "Retry", icon: "retry", disabled: !!ctx.streaming },
				],
				[
					{ id: "copy-answer", label: "Copy answer text", icon: "copy-text" },
					...clipboardSection(ctx),
					duplicateEntry(),
					{ id: "rename", label: "Rename", icon: "rename" },
				],
				zorderSection(ctx),
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "web": {
			const sections: Section[] = [
				[
					{ id: "reload", label: "Reload", icon: "reload" },
					{ id: "open-browser", label: "Open in browser", icon: "open-browser" },
				],
				[
					{ id: "clip", label: "Clip to KB", icon: "clip" },
					{ id: "copy-url", label: "Copy URL", icon: "copy-url" },
				],
				[...clipboardSection(ctx), duplicateEntry()],
				zorderSection(ctx),
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "file": {
			const open: Section = [{ id: "open", label: "Open", icon: "open" }];
			if (ctx.hasOpenFile && !ctx.isOpenFile) {
				open.push({ id: "split", label: "Open in Split View", icon: "split" });
			}
			const sections: Section[] = [
				open,
				[
					{ id: "mindmap", label: "Generate Mind Map", icon: "mindmap" },
					{ id: "study", label: "Generate Flash Cards", icon: "study" },
					{ id: "reindex", label: "Re-index in KB", icon: "reindex" },
					...(ctx.isDriveLinked
						? [{ id: "resync", label: "Re-sync from Drive", icon: "resync" }]
						: []),
				],
				[...clipboardSection(ctx), duplicateEntry()],
				zorderSection(ctx),
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "text": {
			const sections: Section[] = [
				[{ id: "edit", label: "Edit", icon: "edit" }],
				[
					{ id: "copy-text", label: "Copy text", icon: "copy-text" },
					...clipboardSection(ctx),
					duplicateEntry(),
					...(ctx.isDriveLinked
						? [{ id: "resync", label: "Re-sync from Drive", icon: "resync" }]
						: []),
				],
				zorderSection(ctx),
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "tag": {
			const sections: Section[] = [
				[
					{ id: "rename", label: "Rename", icon: "rename" },
					{ id: "select-members", label: "Select members", icon: "select-members" },
				],
				[{ id: "color", label: "Change color", icon: "color" }],
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "mindmap": {
			const sections: Section[] = [
				[
					{ id: "expand-all", label: "Expand all", icon: "expand-all" },
					{ id: "collapse-all", label: "Collapse all", icon: "collapse-all" },
					{ id: "focus", label: "Focus", icon: "focus" },
				],
				ctx.branchId ? [{ id: "pin-branch", label: "Pin branch", icon: "pin-branch" }] : [],
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "group": {
			const sections: Section[] = [
				[
					{ id: "ungroup", label: "Ungroup", icon: "ungroup", hint: "⇧G" },
					{ id: "rename", label: "Rename label", icon: "rename" },
					{ id: "select-children", label: "Select children", icon: "select-children" },
				],
				[deleteEntry("Delete group")],
			];
			return sections.filter((s) => s.length);
		}

		case "multi": {
			const alignSection: Section =
				ctx.caps?.align && ctx.selectionCount >= 2
					? [
							{ id: "align-left", label: "Align left", icon: "align-left" },
							{ id: "align-center-h", label: "Align center", icon: "align-center-h" },
							{ id: "align-right", label: "Align right", icon: "align-right" },
							{ id: "align-top", label: "Align top", icon: "align-top" },
							{ id: "align-center-v", label: "Align middle", icon: "align-center-v" },
							{ id: "align-bottom", label: "Align bottom", icon: "align-bottom" },
							...(ctx.selectionCount >= 3
								? [
										{ id: "distribute-h", label: "Distribute horizontally", icon: "distribute-h" },
										{ id: "distribute-v", label: "Distribute vertically", icon: "distribute-v" },
									]
								: []),
						]
					: [];
			const sections: Section[] = [
				[
					{ id: "group", label: "Group", icon: "group", hint: "G" },
					{ id: "synthesize", label: "Synthesize", icon: "synthesize" },
					...clipboardSection(ctx),
					duplicateEntry(),
				],
				alignSection,
				zorderSection(ctx),
				[deleteEntry()],
			];
			return sections.filter((s) => s.length);
		}

		case "pane": {
			const newSection: Section = [
				{ id: "new-card", label: "New card", icon: "new-card" },
				{ id: "new-note", label: "New note", icon: "new-note", hint: "T" },
			];
			const pasteSection: Section =
				ctx.caps?.clipboard && ctx.canPaste
					? [{ id: "paste", label: "Paste", icon: "paste", hint: "⌘V" }]
					: [];
			const utilSection: Section = [
				...(ctx.hasNodes ? [{ id: "select-all", label: "Select all", icon: "select-all" }] : []),
				{ id: "undo", label: "Undo", icon: "undo", hint: "U", disabled: !ctx.canUndo },
				{ id: "redo", label: "Redo", icon: "redo", hint: "R", disabled: !ctx.canRedo },
			];
			const cleanupSection: Section = ctx.hasNodes
				? [
						{ id: "cleanup", label: "Clean up", icon: "cleanup", hint: "CC" },
						{ id: "fit", label: "Fit view", icon: "fit", hint: "F" },
					]
				: [];
			const exportSection: Section = ctx.hasNodes
				? [
						{ id: "export-png", label: "Export PNG", icon: "export-png" },
						{ id: "export-pdf", label: "Export PDF", icon: "export-pdf" },
						{ id: "export-md", label: "Export Markdown", icon: "export-md" },
					]
				: [];
			const sections: Section[] = [
				newSection,
				pasteSection,
				utilSection,
				cleanupSection,
				exportSection,
			];
			return sections.filter((s) => s.length);
		}

		default:
			return [];
	}
}
