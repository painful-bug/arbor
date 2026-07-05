// SplitFileView mode: two file panes fill the screen side-by-side, the top toolbar
// swaps to file-editing tools, and per-pane viewer toolbars hide. `active` is driven
// by Canvas (both openFileId + secondaryFileId set); `focused` picks which pane the
// top toolbar drives.

export type Pane = "primary" | "secondary";

export const splitView = $state<{ active: boolean; focused: Pane }>({
	active: false,
	focused: "primary",
});
