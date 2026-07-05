// A per-pane control facade. The active viewer (PdfViewer for PDFs, FilePanel's
// rich-text editor for md/text/docx) stays the source of truth for its own state
// and *publishes* a reactive snapshot + action closures here. The split-mode top
// toolbar (FileToolbar) reads/drives the focused pane through this object without
// the viewers having to lift their internal state machines out.
//
// ponytail: facade over the existing viewers, not a re-implementation. Upgrade to
// a real shared store only if a third surface needs to drive the same pane.

export type FitMode = "width" | "page" | "actual";
export type PaneKind = "pdf" | "text" | "none";

export interface PaneColor {
	label: string;
	value: string;
}

export interface PaneController {
	kind: PaneKind;
	// published, read by the toolbar
	zoomPct: number;
	fitMode: FitMode;
	currentPage: number;
	totalPages: number;
	highlightOn: boolean;
	activeColor: string;
	colors: PaneColor[];
	query: string;
	// actions — assigned by the active viewer; noops until then
	zoomIn(): void;
	zoomOut(): void;
	setFit(m: FitMode): void;
	prevPage(): void;
	nextPage(): void;
	toggleHighlight(): void;
	setColor(c: string): void;
	setQuery(q: string): void;
	// text panes only (undefined for PDFs)
	bold?(): void;
	italic?(): void;
	underline?(): void;
}

const noop = () => {};

export function createPaneController(): PaneController {
	const controller = $state<PaneController>({
		kind: "none",
		zoomPct: 100,
		fitMode: "width",
		currentPage: 1,
		totalPages: 0,
		highlightOn: false,
		activeColor: "",
		colors: [],
		query: "",
		zoomIn: noop,
		zoomOut: noop,
		setFit: noop,
		prevPage: noop,
		nextPage: noop,
		toggleHighlight: noop,
		setColor: noop,
		setQuery: noop,
	});
	return controller;
}
