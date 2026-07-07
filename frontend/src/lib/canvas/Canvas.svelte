<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow } from '@xyflow/svelte';
	import type { XYPosition } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount, tick } from 'svelte';
	import CardNode from './CardNode.svelte';
	import FileCard from './FileCard.svelte';
	import WebCard from './WebCard.svelte';
	import UserTextCard from './UserTextCard.svelte';
	import GroupNode from './GroupNode.svelte';
	import UserTagCard from './UserTagCard.svelte';
	import MindmapNode from './MindmapNode.svelte';
	import TextView from './TextView.svelte';
	import CanvasToolbar from './CanvasToolbar.svelte';
	import ClusterHighlights from './ClusterHighlights.svelte';
	import PromptBubble from './PromptBubble.svelte';
	import CardExpand from './CardExpand.svelte';
	import ConnectedEdge from './ConnectedEdge.svelte';
	import CardChatPanel from './CardChatPanel.svelte';
	import ThemeToggle from '$lib/theme/ThemeToggle.svelte';
	import GlobalSearchBar from './GlobalSearchBar.svelte';
	import KbOverlay from './KbOverlay.svelte';
	import StudyOverlay from './StudyOverlay.svelte';
	import CommandPalette, { type Command } from './CommandPalette.svelte';
	import { handleCanvasShortcut } from './shortcuts';
	import {
		searchState,
		deepLink,
		openSearch,
		closeSearch,
		next as searchNext,
		prev as searchPrev
	} from './globalSearch.svelte';
	import { persistSettings } from './store.svelte';
	import {
		flow,
		tool,
		ui,
		addCard,
		addFileCard,
		addWebCard,
		addTextCard,
		addMindmap,
		setFileStatus,
		setFilePreview,
		cycleCardBlock,
		duplicateNode,
		duplicateSelected,
		deleteSelected,
		addManualEdge,
		runModel,
		continueCard,
		saveCanvas,
		pushHistory,
		undo,
		redo,
		canUndo,
		canRedo,
		groupNodes,
		ungroupNodes,
		cleanUp,
		nodeCenter,
		facingSide,
		remapEdgeSides,
		repositionTags,
		settings,
		init,
		synthesizeSelection,
		retryCard,
		deleteNodes,
		setMindmapExpandAll,
		pinMindmapBranch,
		bringToFront,
		sendToBack,
		setLocked,
		applyPositions
	} from './store.svelte';
	import Library from './Library.svelte';
	import FilePanel from './FilePanel.svelte';
	import FileToolbar from './FileToolbar.svelte';
	import CardContextMenu, { type MenuItem } from './CardContextMenu.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import DriveConnectDialog from './DriveConnectDialog.svelte';
	import { importDriveUrl, isDriveUrl, resyncDriveNode } from './drive';
	import NoteNotifications from './NoteNotifications.svelte';
	import { splitView } from './split-view.svelte';
	import type { PaneController } from './pane-controller.svelte';
	import {
		FileText, Columns2, Brain, Layers, MessageSquare, X, Copy, Combine, Trash2,
		Sparkles, Maximize, Search, Hand, MousePointer2, Type, Spline, Palette,
		Plus, Microscope, Hexagon, Undo2, Redo2, Download, SunMoon, Settings, Ungroup,
		RotateCcw, RotateCw, ArrowUpRight, Pencil, Users, UnfoldVertical, FoldVertical,
		Pin, Crosshair, RefreshCw, Group as GroupIcon, Scissors, ClipboardPaste,
		BringToFront, SendToBack, Lock, LockOpen, AlignStartVertical, AlignEndVertical,
		AlignStartHorizontal, AlignEndHorizontal, AlignCenterHorizontal, AlignCenterVertical,
		AlignHorizontalDistributeCenter, AlignVerticalDistributeCenter
	} from '@lucide/svelte';
	import { menuItemsFor, type MenuSurface, type MenuCtx, type MenuEntry } from './menu-items';
	import { cardTitle, cardPlainText } from './cards';
	import { copySelection, pasteAt, hasClipboard, isInternalPaste } from './clipboard';
	import { align, distribute, type Box } from './align';
	import { apiFetch } from '$lib/api';
	import { asUrl } from '$lib/url';
	import { putFileBlob, deleteFileBlob, kindOf, extractText, mimeFromExt, canUseFs, type FileKind } from '$lib/files';
	import { kbAdd, kbRemove } from '$lib/ai/client';
	import { debounce } from '$lib/debounce';
	import { currentCanvasId, currentCanvasName } from './store.svelte';
	import { studioToasts, dismissToast, runMindmap, runStudy } from './studio-jobs.svelte';
	import { exportCanvasImage } from './export-image';
	import { scheduleAutolink } from './autolink';
	import { goto } from '$app/navigation';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { swoop } from '$lib/theme/animations';
	import { power } from '$lib/power.svelte';
	import { openExternal } from '$lib/web';

	const { screenToFlowPosition, fitView, setCenter, getZoom } = useSvelteFlow();
	const nodeTypes = { card: CardNode, file: FileCard, web: WebCard, text: UserTextCard, group: GroupNode, tag: UserTagCard, mindmap: MindmapNode };
	// 'bezier' isn't a built-in xyflow edge-type key (only 'default' is) — manual
	// connect-tool edges and autolink semantic edges both set type:'bezier'
	// explicitly (see addManualEdge / autolink.ts), so register it too.
	const edgeTypes = { default: ConnectedEdge, bezier: ConnectedEdge };

	let bubble = $state<{
		x: number;
		y: number;
		flow: { x: number; y: number };
		parentId?: string;
		quote?: string;
		continueId?: string;
		overModal?: boolean;
		deep?: boolean;
	} | null>(null);

	// Viewport culling (onlyRenderVisibleElements below) is great for steady-state
	// pan/zoom but fights any *animated* viewport jump: fitView/setCenter interpolate
	// the transform over ~300-450ms, so nodes that start off-screen only enter the
	// visible rect partway through — each one mounting for the first time (markdown
	// render, thumbnail decode, entrance transition) on a frame that's also mid-tween.
	// That main-thread work competing with the tween's own rAF loop is the choppiness.
	// Suspending culling for the duration of these animations keeps them buttery;
	// normal user-driven pan/zoom (incremental, not a sudden full-canvas jump) still
	// gets the full benefit.
	let viewportAnimating = $state(false);
	async function animateViewport(run: () => Promise<unknown>): Promise<void> {
		viewportAnimating = true;
		try {
			await run();
		} finally {
			viewportAnimating = false;
		}
	}

	// Viewport culling is the ONLY thing that makes pan/zoom touch Svelte's reactive
	// graph: with it on, every viewport delta recomputes which nodes intersect the
	// screen and mounts/unmounts them at the edges — each mount rebuilding a card's
	// DOM (markdown, timeline, handles). Without it, pan/zoom is a pure GPU transform
	// with zero JS per frame. So we only cull on genuinely large canvases, where
	// rendering every node would cost more memory/DOM than the churn; below that the
	// whole graph stays mounted and pan/zoom/drag are buttery. Suspended during
	// programmatic viewport animations (fitView/search swoop) either way.
	const CULL_THRESHOLD = 150;
	const cullNodes = $derived(flow.nodes.length > CULL_THRESHOLD && !viewportAnimating);

	// Generous padding so every card, note, and file is fully visible, not clipped
	// under the floating toolbar/sidebar chrome. Needs the <SvelteFlow minZoom={0.05}>
	// prop below: d3-zoom's scaleExtent is fixed at pan-zoom init from that global
	// minZoom, so a per-call fitView({minZoom}) alone gets silently re-clamped back
	// to the default 0.5 floor — a widely-spread canvas couldn't zoom out far enough
	// to fit everything no matter the padding.
	function doFitView() {
		requestAnimationFrame(() => {
			void animateViewport(() => fitView({ duration: 300, padding: 0.18 }));
		});
	}

	// Global search: swoop the viewport to the active match's node. Only animates when
	// the *target node* changes — otherwise every keystroke (which rebuilds the match
	// list) would restart an in-flight setCenter animation, making the canvas judder.
	let lastSwoopId: string | null = null;
	$effect(() => {
		const matches = searchState.matches;
		const id = searchState.open && matches.length ? matches[searchState.cursor]?.nodeId : null;
		if (!id) {
			lastSwoopId = null;
			return;
		}
		if (id === lastSwoopId) return; // same node — don't re-animate
		const node = flow.nodes.find((n) => n.id === id);
		if (!node) return;
		lastSwoopId = id;
		const { x, y } = nodeCenter(node);
		// Keep the current zoom if already readable; only zoom in when far out.
		const cur = getZoom();
		const zoom = cur < 0.7 ? 1 : cur;
		void animateViewport(() => setCenter(x, y, { zoom, duration: reducedMotion() ? 0 : 450 }));
	});

	let paletteOpen = $state(false);

	// Command palette registry — Utilities pinned on top, then tools and actions.
	const commands: Command[] = [
		{ id: 'cleanup', group: 'Utilities', icon: Sparkles, label: 'Clean Up', hint: 'CC', run: () => doCleanUp() },
		{ id: 'fit', group: 'Utilities', icon: Maximize, label: 'Fit to view', hint: 'F', run: doFitView },
		{ id: 'search', group: 'Utilities', icon: Search, label: 'Search canvas', run: () => openSearch() },
		{ id: 'tool-hand', group: 'Tools', icon: Hand, label: 'Hand tool', hint: 'H', run: () => { tool.active = 'hand'; tool.connectFrom = null; } },
		{ id: 'tool-select', group: 'Tools', icon: MousePointer2, label: 'Select tool', hint: 'V', run: () => { tool.active = 'select'; tool.connectFrom = null; } },
		{ id: 'tool-text', group: 'Tools', icon: Type, label: 'Text tool', hint: 'T', run: () => { tool.active = 'text'; } },
		{ id: 'tool-duplicate', group: 'Tools', icon: Copy, label: 'Duplicate tool', hint: 'D', run: () => { tool.active = 'duplicate'; } },
		{ id: 'tool-connect', group: 'Tools', icon: Spline, label: 'Connect tool', hint: 'C', run: () => { tool.active = 'connect'; } },
		{ id: 'tool-color', group: 'Tools', icon: Palette, label: 'Color tool', run: () => { tool.active = 'color'; } },
		{ id: 'new-note', group: 'Create', icon: Plus, label: 'New note', run: () => {
			const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
			tool.active = 'select';
			addTextCard(pos);
		} },
		{ id: 'research', group: 'Create', icon: Microscope, label: 'Deep Research', run: startDeepResearch },
		{ id: 'kb', group: 'Knowledge', icon: Hexagon, label: 'Search knowledge base', run: openKB },
		{ id: 'study', group: 'Knowledge', icon: Layers, label: 'Study flashcards & quizzes', run: () => (studyOpen = true) },
		{ id: 'undo', group: 'Edit', icon: Undo2, label: 'Undo', hint: 'U', run: doUndo },
		{ id: 'redo', group: 'Edit', icon: Redo2, label: 'Redo', hint: 'R', run: doRedo },
		{ id: 'synthesize', group: 'Edit', icon: Combine, label: 'Synthesize selected cards', run: doSynthesize },
		{ id: 'export-md', group: 'Export', icon: Download, label: 'Export as Markdown (.md)', run: () => exportCanvas('md') },
		{ id: 'export-canvas', group: 'Export', icon: Download, label: 'Export as Obsidian Canvas (.canvas)', run: () => exportCanvas('canvas') },
		{ id: 'export-png', group: 'Export', icon: Download, label: 'Export as Image (.png)', run: () => exportCanvas('png') },
		{ id: 'export-pdf', group: 'Export', icon: Download, label: 'Export as PDF (.pdf)', run: () => exportCanvas('pdf') },
		{ id: 'theme', group: 'App', icon: SunMoon, label: 'Toggle theme', run: () => {
			settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
			persistSettings();
		} },
		{ id: 'settings', group: 'App', icon: Settings, label: 'Open settings', hint: '⌘,', run: () => goto('/settings') }
	];

	// Synthesize the currently selected cards (≥2) into a new synthesis card.
	function doSynthesize() {
		const ids = flow.nodes.filter((n) => n.selected).map((n) => n.id);
		if (ids.length < 2) return;
		const id = synthesizeSelection(ids);
		if (id) flow.selected = id;
	}

	// Fetch the canvas export and trigger a browser download (WKWebView saves to
	// ~/Downloads like any other anchor-download). No new Tauri command needed.
	// png/pdf are rendered client-side from the xyflow viewport; md/canvas come from the backend.
	async function exportCanvas(format: 'md' | 'canvas' | 'png' | 'pdf') {
		const id = currentCanvasId();
		if (!id) return;
		if (format === 'png' || format === 'pdf') {
			// Suspend viewport culling so off-screen nodes mount into the DOM before we
			// rasterize (otherwise the image only captures currently-visible cards).
			await animateViewport(async () => {
				await tick();
				await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
				await exportCanvasImage(format, currentCanvasName() || 'canvas');
			});
			return;
		}
		const res = await apiFetch(`/api/canvases/${id}/export?format=${format}`);
		if (!res.ok) return;
		const blob = await res.blob();
		const disposition = res.headers.get('Content-Disposition') ?? '';
		const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `canvas.${format}`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	}

	function startDeepResearch() {
		const x = window.innerWidth / 2;
		const y = 140;
		bubble = { x, y, flow: screenToFlowPosition({ x, y }), deep: true };
	}

	let expandId = $state<string | null>(null);
	let lastBranchAt = 0;

	// Pending branch: set when user selects text; confirmed on button click or Enter.
	let pendingBranch = $state<{
		x: number; y: number;          // button position (fixed)
		selCx: number; selCy: number;  // selection center for bubble placement
		parentId: string;
		quote: string;
		overModal: boolean;
	} | null>(null);
	let branchHiding = $state(false);

	// Animate button out via CSS, then remove from DOM after transition completes.
	function dismissBranch() {
		if (!pendingBranch || branchHiding) return;
		branchHiding = true;
		setTimeout(() => { pendingBranch = null; branchHiding = false; }, 180);
	}

	// Chat panel open state lifted here so the flex layout can include it.
	let chatOpen = $state(false);
	// Quote seeded into the canvas chat composer by "Send to chat" on a file selection.
	let chatSeed = $state('');

	// Send-to-chat from a file preview: open the side chat panel (canvas/session mode)
	// seeded with the quote + file context. In split view the chat tiles beside the
	// panes (they shrink responsively) instead of disrupting the split.
	function onFileChatEvent(e: Event) {
		const { filename, quote, page } = (e as CustomEvent).detail as {
			filename: string;
			quote: string;
			page: number;
		};
		flow.selected = null; // canvas/session chat, not a card thread
		chatSeed = `> "${quote}"\n\n— ${filename || 'file'}${page ? `, p.${page}` : ''}\n\n`;
		chatOpen = true;
	}

	let animatingCleanup = $state(false);
	let cleaningUp = $state(false);
	async function doCleanUp() {
		cleaningUp = true;
		try {
			if (reducedMotion()) { await cleanUp(); return; }
			animatingCleanup = true;
			await tick();
			await cleanUp();
			setTimeout(() => { animatingCleanup = false; }, 550);
		} finally {
			cleaningUp = false;
		}
	}

	// Undo/redo restore a prior node snapshot under the same ids, so reuse the
	// cleanup transition envelope: cards animate to their old positions instead
	// of snapping (e.g. un-clustering after Cmd-C cleanup via Cmd-Z/U).
	async function animateHistory(fn: () => void) {
		if (reducedMotion()) { fn(); return; }
		animatingCleanup = true;
		await tick();
		fn();
		setTimeout(() => { animatingCleanup = false; }, 550);
	}
	function doUndo() { void animateHistory(undo); }
	function doRedo() { void animateHistory(redo); }

	// No eager blob hydration: card faces render from small cached thumbnails
	// (FileCard → hydrateThumb) and the file panel fetches bytes on open. Keeping
	// every dropped file's raw bytes in the webview (~60MB+ on file-heavy
	// canvases) was the main memory/lag driver.

	function onDblClick(e: MouseEvent) {
		// Only spawn prompt bubble in hand mode.
		if (tool.active !== 'hand') return;
		const target = e.target as HTMLElement;
		if (!target.classList.contains('svelte-flow__pane')) return;
		bubble = {
			x: e.clientX,
			y: e.clientY,
			flow: screenToFlowPosition({ x: e.clientX, y: e.clientY })
		};
	}

	// Pane click: text tool places a note card; otherwise deselect.
	function onPaneClick({ event }: { event: MouseEvent }) {
		if (tool.active === 'text') {
			const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
			const id = addTextCard(pos);
			flow.selected = id;
			window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
			tool.active = 'hand';
		} else {
			flow.selected = null;
		}
	}

	const selectedNodes = $derived(flow.nodes.filter((n) => n.selected));

	// Node click: duplicate / color / connect tool dispatch.
	function onNodeClick(node: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number }) {
		if (tool.active === 'select') return; // let SvelteFlow handle selection
		if (tool.active === 'duplicate') {
			const newId = duplicateNode(node.id);
			if (newId) flow.selected = newId;
		} else if (tool.active === 'color') {
			cycleCardBlock(node.id);
		} else if (tool.active === 'connect') {
			if (!tool.connectFrom) {
				tool.connectFrom = node.id;
			} else if (tool.connectFrom !== node.id) {
				// Compute best handles using existing helpers.
				const src = flow.nodes.find((n) => n.id === tool.connectFrom);
				const tgt = flow.nodes.find((n) => n.id === node.id);
				if (src && tgt) {
					const sc = nodeCenter(src);
					const tc = nodeCenter(tgt);
					addManualEdge(tool.connectFrom, node.id, facingSide(sc, tc) + '-s', facingSide(tc, sc) + '-t');
				}
				tool.connectFrom = null;
			}
		}
	}

	function onBranchEvent(e: Event) {
		lastBranchAt = Date.now();
		const { x, y, parentId, quote, overModal } = (e as CustomEvent).detail;
		const parent = flow.nodes.find((n) => n.id === parentId) as (typeof flow.nodes[0] & { measured?: { width?: number } }) | undefined;
		const pos = parent
			? { x: parent.position.x + (parent.measured?.width ?? parent.width ?? 400) + 60, y: parent.position.y }
			: screenToFlowPosition({ x, y });
		bubble = { x, y, flow: pos, parentId, quote, overModal };
	}

	function onDocSelect(e: MouseEvent) {
		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!text || !sel) return;
		const anchor = sel.anchorNode;
		const el = anchor instanceof Element ? anchor : anchor?.parentElement;
		const host = el?.closest('[data-card-id]');
		if (!host) return;
		const parentId = host.getAttribute('data-card-id') as string;
		const overModal = !!host.closest('.backdrop');
		const rect = sel.getRangeAt(0).getBoundingClientRect();
		const cx = rect.width ? rect.left + rect.width / 2 : e.clientX;
		const cy = rect.height ? rect.top + rect.height / 2 : e.clientY;
		// Button sits just above the selection midpoint.
		const bx = Math.max(60, Math.min(window.innerWidth - 60, cx));
		const by = Math.max(40, cy - 52);
		pendingBranch = { x: bx, y: by, selCx: cx, selCy: cy, parentId, quote: text, overModal };
	}

	function confirmBranch() {
		if (!pendingBranch) return;
		const { selCx, selCy, parentId, quote, overModal } = pendingBranch;
		pendingBranch = null;
		const radius = 100 + Math.random() * 60;
		const angle = Math.random() * 2 * Math.PI;
		const bw = 180;
		const x = Math.max(bw, Math.min(window.innerWidth - bw, selCx + Math.cos(angle) * radius));
		const y = Math.max(50, Math.min(window.innerHeight - 50, selCy + Math.sin(angle) * radius));
		onBranchEvent(new CustomEvent('arbor:branch', { detail: { x, y, parentId, quote, overModal } }));
	}

	function onSelectionChange() {
		if (pendingBranch && !branchHiding && !window.getSelection()?.toString().trim()) dismissBranch();
	}

	function onContinueEvent(e: Event) {
		const { cardId, x, y } = (e as CustomEvent).detail;
		bubble = { x, y, flow: screenToFlowPosition({ x, y }), continueId: cardId };
	}

	function onExpandEvent(e: Event) {
		if (Date.now() - lastBranchAt < 400) return;
		dismissBranch();
		expandId = (e as CustomEvent).detail.cardId;
	}

	function onDelete({ nodes }: { nodes: { id: string; type?: string; data: unknown }[] }) {
		for (const node of nodes) {
			if (node.type === 'file') {
				const filename = (node.data as { filename?: string }).filename;
				if (filename) void kbRemove(currentCanvasId(), filename);
				void deleteFileBlob(node.id);
			}
		}
	}

	// Re-anchor edges to the facing sides whenever a node is dragged. Shared with CC.
	// Also reflow any cluster tags whose cluster just moved.
	function onNodeDragStop({ nodes }: { targetNode: unknown; nodes: { id: string }[]; event: MouseEvent | TouchEvent }) {
		remapEdgeSides(new Set<string>(nodes.map((n) => n.id)));
		repositionTags();
	}

	function onWebUrlEvent(e: Event) {
		const { url, parentId } = (e as CustomEvent).detail;
		const parent = parentId && flow.nodes.find((n) => n.id === parentId);
		const pos = parent
			? { x: parent.position.x + (parent.width ?? 560) + 48, y: parent.position.y }
			: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		flow.selected = addWebCard(pos, url, { parentId: parent ? parentId : undefined });
	}

	// Web clipper result: the page is already fetched + indexed backend-side. Drop it
	// as an offline markdown file card beside the source web card (file cards aren't
	// re-indexed by kb-sync, so this doesn't duplicate what the backend already stored).
	function onClippedEvent(e: Event) {
		const { parentId, title, text } = (e as CustomEvent).detail as {
			parentId: string;
			title: string;
			text: string;
		};
		const parent = flow.nodes.find((n) => n.id === parentId);
		const pos = parent
			? { x: parent.position.x + (parent.width ?? 560) + 48, y: parent.position.y }
			: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		const id = addFileCard(pos, title, { mime: 'text/markdown', kind: 'markdown' });
		putFileBlob(id, new TextEncoder().encode(text).buffer as ArrayBuffer, 'text/markdown', title);
		setFilePreview(id, text.slice(0, 4000));
		setFileStatus(id, 'ready');
		scheduleAutolink(id);
		flow.selected = id;
	}

	// Studio mind map: backend returned a topic tree for a source file → bloom it
	// into linked cards in open space, select the root, and swoop to frame the map.
	function onMindmapEvent(e: Event) {
		const { parentId, nodes } = (e as CustomEvent).detail as {
			parentId: string;
			nodes: { id: string; title: string; summary: string; parent: string | null }[];
		};
		if (!nodes?.length) return;
		pushHistory();
		const rootId = addMindmap(parentId, nodes);
		if (rootId) flow.selected = rootId;
		requestAnimationFrame(() => focusMindmap(parentId));
	}

	// Frame a file's mind map — reuses the global-search swoop (animateViewport keeps
	// culling suspended for a buttery tween). Covers both the current single-node
	// mindmap (data.fileId) and legacy per-topic card blooms (data.mindmapOf).
	function focusMindmap(fileId: string) {
		const ids = flow.nodes
			.filter((n) => {
				const d = n.data as Record<string, unknown>;
				return (n.type === 'mindmap' && d.fileId === fileId) || d.mindmapOf === fileId;
			})
			.map((n) => ({ id: n.id }));
		if (!ids.length) return;
		void animateViewport(() =>
			fitView({ nodes: ids, duration: reducedMotion() ? 0 : 500, padding: 0.22 }),
		);
	}

	function onFocusMindmapEvent(e: Event) {
		const { fileId } = (e as CustomEvent).detail as { fileId: string };
		focusMindmap(fileId);
	}

	function onPaste(e: ClipboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		const text = e.clipboardData?.getData('text') ?? '';
		const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		if (isInternalPaste(text)) {
			e.preventDefault();
			void pasteAt(pos).then((ids) => {
				if (ids.length) flow.nodes = flow.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) }));
			});
			return;
		}
		if (isDriveUrl(text)) {
			e.preventDefault();
			void handleDrivePaste(text, pos);
			return;
		}
		const url = asUrl(text);
		if (!url) return;
		e.preventDefault();
		flow.selected = addWebCard(pos, url);
	}

	let showDriveConnect = $state(false);
	let pendingDriveImport = $state<{ url: string; at: XYPosition } | null>(null);
	let confirmResyncId = $state<string | null>(null);

	async function handleDrivePaste(url: string, at: XYPosition) {
		try {
			const result = await importDriveUrl(url, at);
			if (result === 'needs-connect') {
				pendingDriveImport = { url, at };
				showDriveConnect = true;
			}
		} catch (err) {
			console.error('drive import failed', err);
		}
	}

	// Keyboard: delegate to the pure shortcut handler with a state snapshot + actions.
	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		handleCanvasShortcut(e, {
			inInput:
				tag === 'INPUT' || tag === 'TEXTAREA' || !!(e.target as HTMLElement)?.isContentEditable,
			searchOpen: searchState.open,
			searchHasMatches: searchState.matches.length > 0,
			kbOpen,
			paletteOpen,
			pendingBranch: !!pendingBranch,
			openFile: !!openFileId,
			expanded: !!expandId,
			chatOrSidebarOpen: chatOpen || ui.sidebarExpanded,
			toolActive: tool.active,
			connectPending: !!tool.connectFrom,
			selectionCount: selectedNodes.length,
			hasDocSelection: !!window.getSelection()?.toString(),

			toggleSearch: () => (searchState.open ? closeSearch() : openSearch()),
			focusKbSearch: () => kbOverlayRef?.focusSearch(),
			togglePalette: () => (paletteOpen = !paletteOpen),
			searchNext,
			searchPrev,
			closeOverlays: () => {
				if (searchState.open) closeSearch();
				paletteOpen = false;
				kbOpen = false;
				studyOpen = false;
			},
			confirmBranch,
			dismissBranch,
			closeFile: () => {
				if (splitView.active) closeSplit();
				else if (secondaryFileId) secondaryFileId = null;
				else guardPrimary(() => (openFileId = null));
			},
			closeExpand: () => (expandId = null),
			closeChatAndSidebar: () => {
				chatOpen = false;
				ui.sidebarExpanded = false;
			},
			setTool: (t) => {
				tool.active = t;
				if (t === 'select') tool.connectFrom = null;
			},
			resetTool: () => {
				tool.active = 'hand';
				tool.connectFrom = null;
			},
			deleteSelection: deleteSelected,
			toggleSpaceTarget: () => {
				const multi = flow.nodes.filter((n) => n.selected);
				const id = flow.selected ?? (multi.length === 1 ? multi[0].id : null);
				const node = id ? flow.nodes.find((n) => n.id === id) : null;
				if (!node) return false;
				if (node.type === 'card') expandId = expandId === node.id ? null : node.id;
				else openFileId = openFileId === node.id ? null : node.id; // file + text nodes
				return true;
			},
			duplicateSelection: duplicateSelected,
			copySelection: (cut) => void copySelection(cut),
			undo: doUndo,
			redo: doRedo,
			fitView: doFitView,
			groupSelection: () => groupNodes(flow.nodes.filter((n) => n.selected).map((n) => n.id)),
			ungroupSelection: () => {
				const g = flow.nodes.find((n) => n.selected && n.type === 'group');
				if (!g) return false;
				ungroupNodes(g.id);
				return true;
			},
			cleanUp: () => void doCleanUp(),
			openSettings: () => goto('/settings'),
			toggleChat: () => (chatOpen = !chatOpen)
		});
	}

	// Click on the empty canvas background collapses the sidebar. Clicks on a card
	// are ignored so selecting a card (which retargets the chat) isn't disrupted.
	// The file preview deliberately stays open — only ✕ / Escape close it.
	function onWrapPointerDown(e: PointerEvent) {
		const t = e.target as HTMLElement;
		if (t?.closest('.svelte-flow__node') || t?.closest('.canvas-actions') || t?.closest('.topbar')) return;
		// Preview stays open on canvas clicks — only ✕ / Escape close it.
		ui.sidebarExpanded = false;
	}

	onMount(() => {
		// Async init: load canvas from ~/.arbor (file bytes stay backend-side; see above).
		void init();

		window.addEventListener('arbor:branch', onBranchEvent);
		window.addEventListener('arbor:continue', onContinueEvent);
		window.addEventListener('arbor:expand', onExpandEvent);
		window.addEventListener('arbor:weburl', onWebUrlEvent);
		window.addEventListener('arbor:clipped', onClippedEvent);
		window.addEventListener('arbor:mindmap', onMindmapEvent);
		window.addEventListener('arbor:focus-mindmap', onFocusMindmapEvent);
		window.addEventListener('arbor:openfile', onOpenFileEvent);
		window.addEventListener('arbor:nodemenu', onNodeMenuEvent);
		window.addEventListener('arbor:panemenu', onPaneMenuEvent);
		window.addEventListener('arbor:filechat', onFileChatEvent);
		window.addEventListener('keydown', onKeydown);
		document.addEventListener('mouseup', onDocSelect);
		document.addEventListener('selectionchange', onSelectionChange);
		document.addEventListener('paste', onPaste);

		let tauriUnlisten: (() => void) | null = null;
		if (canUseFs()) {
			(async () => {
				const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
				const { apiFetch } = await import('$lib/api');
				tauriUnlisten = await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
					if (event.payload.type !== 'drop') return;
					const { paths, position } = event.payload as { paths: string[]; position: { x: number; y: number } };
					if (!paths.length) return;
					let pos = screenToFlowPosition({ x: position.x, y: position.y });
					// Cards spawn synchronously; indexing runs in parallel across files.
					await Promise.all(paths.map((filePath) => {
						const name = filePath.split(/[/\\]/).pop() ?? filePath;
						const ext = name.split('.').pop()?.toLowerCase() ?? '';
						const mime = mimeFromExt(ext);
						const kind = kindOf(name, mime);
						const id = addFileCard(pos, name, { mime, kind, path: filePath });
						pos = { x: pos.x + 30, y: pos.y + 30 };
						return (async () => {
							try {
								const res = await apiFetch(`/api/files/read-bytes?path=${encodeURIComponent(filePath)}`);
								const b64 = await res.text();
								const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
								await indexDroppedFile(id, name, mime, kind, bytes);
							} catch (err) {
								console.error('tauri file drop read failed', err);
								setFileStatus(id, 'error');
							}
						})();
					}));
				});
			})();
		}

		return () => {
			window.removeEventListener('arbor:branch', onBranchEvent);
			window.removeEventListener('arbor:continue', onContinueEvent);
			window.removeEventListener('arbor:expand', onExpandEvent);
			window.removeEventListener('arbor:weburl', onWebUrlEvent);
			window.removeEventListener('arbor:clipped', onClippedEvent);
			window.removeEventListener('arbor:mindmap', onMindmapEvent);
			window.removeEventListener('arbor:focus-mindmap', onFocusMindmapEvent);
			window.removeEventListener('arbor:openfile', onOpenFileEvent);
			window.removeEventListener('arbor:nodemenu', onNodeMenuEvent);
			window.removeEventListener('arbor:panemenu', onPaneMenuEvent);
			window.removeEventListener('arbor:filechat', onFileChatEvent);
			window.removeEventListener('keydown', onKeydown);
			document.removeEventListener('mouseup', onDocSelect);
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('paste', onPaste);
			tauriUnlisten?.();
		};
	});

	// Auto Clean Up: re-run Cmd-C on a timer while enabled AND the window is visible —
	// no timer exists at all while hidden/minimized (power.visible gates it), so a
	// background window burns zero wakeups on this.
	$effect(() => {
		if (!settings.autoCleanup.enabled || !power.visible) return;
		const ms = Math.max(1, settings.autoCleanup.intervalMin) * 60_000;
		const id = setInterval(() => { if (!cleaningUp) void doCleanUp(); }, ms);
		return () => clearInterval(id);
	});

	// Autosave + push undo snapshot on change; debounced so streaming doesn't thrash.
	// Skip the first run: it's the initial empty state before init() loads real data.
	const saveDebounced = debounce(() => {
		saveCanvas();
		pushHistory();
	}, 400);
	let mounted = false;
	$effect(() => {
		flow.nodes;
		flow.edges; // track
		if (!mounted) {
			mounted = true;
			return;
		}
		saveDebounced();
	});

	async function onDrop(e: DragEvent) {
		const files = [...(e.dataTransfer?.files ?? [])];
		if (!files.length) {
			const dropped =
				e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain') || '';
			const url = asUrl(dropped.split('\n')[0]);
			if (url) {
				e.preventDefault();
				flow.selected = addWebCard(screenToFlowPosition({ x: e.clientX, y: e.clientY }), url);
			}
			return;
		}
		e.preventDefault();
		let pos = screenToFlowPosition({ x: e.clientX, y: e.clientY });
		// Cards spawn synchronously; indexing runs in parallel across files.
		await Promise.all(files.map(async (file) => {
			const kind = kindOf(file.name, file.type);
			const id = addFileCard(pos, file.name, { mime: file.type, kind });
			pos = { x: pos.x + 30, y: pos.y + 30 };
			await indexDroppedFile(id, file.name, file.type, kind, await file.arrayBuffer());
		}));
	}

	let openFileId = $state<string | null>(null);
	let secondaryFileId = $state<string | null>(null); // split-view right pane
	let viewTextId = $state<string | null>(null);

	// ── SplitFileView: per-pane controllers + unsaved-edit guard ─────────────────
	let primaryController = $state<PaneController>();
	let secondaryController = $state<PaneController>();
	let primaryDirty = $state(false);
	let primarySave = $state<(() => Promise<void>)>();
	const focusedController = $derived(
		splitView.focused === 'secondary' ? secondaryController : primaryController
	);
	// Split is active only while both panes hold a file.
	$effect(() => {
		splitView.active = !!openFileId && !!secondaryFileId;
		if (!secondaryFileId) splitView.focused = 'primary';
	});

	// Unsaved-edits confirm: set when a dirty primary pane is about to be replaced/closed.
	let confirmReplace = $state<null | { proceed: () => void }>(null);
	function guardPrimary(proceed: () => void) {
		if (primaryDirty && openFileId) confirmReplace = { proceed };
		else proceed();
	}

	function onOpenFileEvent(e: Event) {
		const id = (e as CustomEvent).detail.fileId;
		guardPrimary(() => {
			if (id === secondaryFileId) secondaryFileId = null; // don't show the same file twice
			openFileId = id;
			primaryDirty = false;
		});
	}
	// Closing the primary pane promotes the split pane into it (if any).
	function closePrimaryFile() {
		guardPrimary(() => {
			openFileId = secondaryFileId;
			secondaryFileId = null;
			primaryDirty = false;
			previewQuery = '';
			previewPage = 0;
		});
	}

	// ── Right-click context menu ─────────────────────────────────────────────────
	// One menu state for every surface (card/web/file/text/tag/mindmap/group/multi/
	// pane); content comes from the pure menu-items.ts builder, icons are mapped
	// here (Canvas is the only place that imports Svelte components).
	const MENU_ICONS: Record<string, typeof FileText> = {
		continue: MessageSquare,
		retry: RotateCcw,
		'copy-answer': Copy,
		'copy-text': Copy,
		duplicate: Copy,
		rename: Pencil,
		delete: Trash2,
		reload: RotateCw,
		'open-browser': ArrowUpRight,
		clip: Download,
		'copy-url': Copy,
		open: FileText,
		split: Columns2,
		mindmap: Brain,
		study: Layers,
		reindex: RefreshCw,
		resync: RefreshCw,
		edit: Pencil,
		'select-members': Users,
		color: Palette,
		ungroup: Ungroup,
		'select-children': MousePointer2,
		'expand-all': UnfoldVertical,
		'collapse-all': FoldVertical,
		focus: Crosshair,
		'pin-branch': Pin,
		group: GroupIcon,
		synthesize: Combine,
		'new-card': Plus,
		'new-note': Type,
		'select-all': MousePointer2,
		undo: Undo2,
		redo: Redo2,
		cleanup: Sparkles,
		fit: Maximize,
		'export-png': Download,
		'export-pdf': Download,
		'export-md': Download,
		copy: Copy,
		scissors: Scissors,
		paste: ClipboardPaste,
		front: BringToFront,
		back: SendToBack,
		lock: Lock,
		unlock: LockOpen,
		'align-left': AlignStartVertical,
		'align-right': AlignEndVertical,
		'align-top': AlignStartHorizontal,
		'align-bottom': AlignEndHorizontal,
		'align-center-h': AlignCenterHorizontal,
		'align-center-v': AlignCenterVertical,
		'distribute-h': AlignHorizontalDistributeCenter,
		'distribute-v': AlignVerticalDistributeCenter
	};

	let ctxMenu = $state<{ surface: MenuSurface; nodeId?: string; branchId?: string; x: number; y: number } | null>(null);

	function onNodeMenuEvent(e: Event) {
		const { nodeId, nodeType, branchId, x, y } = (e as CustomEvent).detail as
			{ nodeId: string; nodeType: string; branchId?: string; x: number; y: number };
		const node = flow.nodes.find((n) => n.id === nodeId);
		if (!node) return;
		// Right-click on an unselected node acts on that node alone, even if others
		// are selected; only clicking a node that's ITSELF part of a multi-selection
		// shows the bulk "multi" menu.
		const surface: MenuSurface =
			node.selected && selectedNodes.length > 1 ? 'multi' : (nodeType as MenuSurface);
		ctxMenu = { surface, nodeId, branchId, x, y };
	}
	function onPaneMenuEvent(e: Event) {
		const { x, y } = (e as CustomEvent).detail;
		ctxMenu = { surface: 'pane', x, y };
	}

	function buildMenuCtx(m: NonNullable<typeof ctxMenu>): MenuCtx {
		const node = m.nodeId ? flow.nodes.find((n) => n.id === m.nodeId) : undefined;
		return {
			selectionCount: selectedNodes.length,
			streaming: node?.type === 'card' ? !!(node.data as { streaming?: boolean }).streaming : undefined,
			hasOpenFile: !!openFileId,
			isOpenFile: openFileId === m.nodeId,
			branchId: m.branchId,
			locked: !!(node?.data as { locked?: boolean } | undefined)?.locked,
			hasNodes: flow.nodes.length > 0,
			canUndo: canUndo(),
			canRedo: canRedo(),
			canPaste: hasClipboard(),
			isDriveLinked: !!(node?.data as { drive?: unknown } | undefined)?.drive,
			caps: { clipboard: true, zorder: true, align: true }
		};
	}
	const ctxSections = $derived(ctxMenu
		? menuItemsFor(ctxMenu.surface, buildMenuCtx(ctxMenu)).map((sec) =>
				sec.map((e): MenuItem => ({
					id: e.id,
					label: e.label,
					icon: MENU_ICONS[e.icon] ?? FileText,
					hint: e.hint,
					danger: e.danger,
					disabled: e.disabled
				}))
			)
		: []);

	async function reindexFile(id: string) {
		const data = flow.nodes.find((n) => n.id === id)?.data as { filename?: string; mime?: string } | undefined;
		if (!data?.filename) return;
		setFileStatus(id, 'indexing');
		try {
			const canvas = currentCanvasId() || 'default';
			const res = await apiFetch(`/api/blobs/${encodeURIComponent(`${canvas}:${id}`)}`);
			if (!res.ok) throw new Error('blob not found');
			const bytes = await res.arrayBuffer();
			await kbRemove(canvas, data.filename);
			const chunks = await kbAdd(canvas, data.filename, data.mime ?? 'application/octet-stream', bytes);
			setFileStatus(id, chunks > 0 ? 'ready' : 'error');
			if (chunks > 0) scheduleAutolink(id);
		} catch (err) {
			console.error('reindex failed', err);
			setFileStatus(id, 'error');
		}
	}

	function onCtxSelect(actionId: string) {
		if (!ctxMenu) return;
		const { surface, nodeId, branchId, x, y } = ctxMenu;
		const node = nodeId ? flow.nodes.find((n) => n.id === nodeId) : undefined;

		switch (actionId) {
			case 'continue':
				if (nodeId) bubble = { x, y, flow: screenToFlowPosition({ x, y }), continueId: nodeId };
				return;
			case 'retry':
				if (nodeId) retryCard(nodeId);
				return;
			case 'copy-answer':
			case 'copy-text':
				if (node) void navigator.clipboard.writeText(cardPlainText(node));
				return;
			case 'rename':
				if (nodeId) window.dispatchEvent(new CustomEvent('arbor:rename', { detail: { nodeId } }));
				return;
			case 'duplicate':
				if (surface === 'multi') { duplicateSelected(); return; }
				if (nodeId) { const dup = duplicateNode(nodeId); if (dup) flow.selected = dup; }
				return;
			case 'delete':
				if (surface === 'multi') deleteSelected();
				else if (nodeId) deleteNodes([nodeId]);
				return;
			case 'reload':
			case 'clip':
				if (nodeId) window.dispatchEvent(new CustomEvent('arbor:webcard', { detail: { id: nodeId, action: actionId } }));
				return;
			case 'open-browser':
				if (node) openExternal((node.data as { url?: string }).url ?? '');
				return;
			case 'copy-url':
				if (node) void navigator.clipboard.writeText((node.data as { url?: string }).url ?? '');
				return;
			case 'open':
			case 'edit':
				if (nodeId) onOpenFileEvent(new CustomEvent('arbor:openfile', { detail: { fileId: nodeId } }));
				return;
			case 'split':
				if (nodeId) openInSplit(nodeId);
				return;
			case 'mindmap':
				if (nodeId) runMindmap(nodeId, (node?.data as { filename?: string })?.filename ?? '');
				return;
			case 'study':
				if (nodeId) runStudy(nodeId, (node?.data as { filename?: string })?.filename ?? '');
				return;
			case 'reindex':
				if (nodeId) void reindexFile(nodeId);
				return;
			case 'resync':
				if (!nodeId) return;
				if (node?.type === 'text') confirmResyncId = nodeId; // guarded: overwrites local edits
				else void resyncDriveNode(nodeId);
				return;
			case 'expand-all':
				if (nodeId) setMindmapExpandAll(nodeId, true);
				return;
			case 'collapse-all':
				if (nodeId) setMindmapExpandAll(nodeId, false);
				return;
			case 'pin-branch':
				if (nodeId && branchId) pinMindmapBranch(nodeId, branchId);
				return;
			case 'focus':
				if (nodeId) focusMindmap(nodeId);
				return;
			case 'select-members': {
				const anchor = (node?.data as { anchor?: string[] } | undefined)?.anchor ?? [];
				flow.nodes = flow.nodes.map((n) => ({ ...n, selected: anchor.includes(n.id) }));
				return;
			}
			case 'color':
				if (nodeId) cycleCardBlock(nodeId);
				return;
			case 'ungroup':
				if (nodeId) ungroupNodes(nodeId);
				return;
			case 'select-children':
				if (nodeId) flow.nodes = flow.nodes.map((n) => ({ ...n, selected: n.parentId === nodeId }));
				return;
			case 'group': {
				const ids = selectedNodes.map((n) => n.id);
				if (ids.length >= 2) groupNodes(ids);
				return;
			}
			case 'synthesize':
				doSynthesize();
				return;
			case 'new-card':
				bubble = { x, y, flow: screenToFlowPosition({ x, y }) };
				return;
			case 'new-note': {
				const pos = screenToFlowPosition({ x, y });
				const id = addTextCard(pos);
				flow.selected = id;
				window.dispatchEvent(new CustomEvent('arbor:openfile', { detail: { fileId: id } }));
				return;
			}
			case 'select-all':
				flow.nodes = flow.nodes.map((n) => (n.type === 'group' ? n : { ...n, selected: true }));
				return;
			case 'undo':
				doUndo();
				return;
			case 'redo':
				doRedo();
				return;
			case 'cleanup':
				void doCleanUp();
				return;
			case 'fit':
				doFitView();
				return;
			case 'export-png':
				void exportCanvas('png');
				return;
			case 'export-pdf':
				void exportCanvas('pdf');
				return;
			case 'export-md':
				void exportCanvas('md');
				return;
			case 'copy':
				void copySelection(false);
				return;
			case 'cut':
				void copySelection(true);
				return;
			case 'paste': {
				const pos = screenToFlowPosition({ x, y });
				void pasteAt(pos).then((ids) => {
					if (ids.length) flow.nodes = flow.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) }));
				});
				return;
			}
			case 'bring-front':
				bringToFront(surface === 'multi' ? selectedNodes.map((n) => n.id) : nodeId ? [nodeId] : []);
				return;
			case 'send-back':
				sendToBack(surface === 'multi' ? selectedNodes.map((n) => n.id) : nodeId ? [nodeId] : []);
				return;
			case 'lock':
				setLocked(surface === 'multi' ? selectedNodes.map((n) => n.id) : nodeId ? [nodeId] : [], true);
				return;
			case 'unlock':
				setLocked(surface === 'multi' ? selectedNodes.map((n) => n.id) : nodeId ? [nodeId] : [], false);
				return;
			case 'align-left':
			case 'align-right':
			case 'align-top':
			case 'align-bottom':
			case 'align-center-h':
			case 'align-center-v': {
				const op = actionId.slice('align-'.length) as Parameters<typeof align>[1];
				applyPositions(align(selectionBoxes(), op));
				return;
			}
			case 'distribute-h':
				applyPositions(distribute(selectionBoxes(), 'h'));
				return;
			case 'distribute-v':
				applyPositions(distribute(selectionBoxes(), 'v'));
				return;
		}
	}

	function selectionBoxes(): Box[] {
		return selectedNodes.map((n) => ({
			id: n.id,
			x: n.position.x,
			y: n.position.y,
			w: n.measured?.width ?? n.width ?? 400,
			h: n.measured?.height ?? n.height ?? 200
		}));
	}

	function openInSplit(id: string) {
		if (!openFileId || id === openFileId) { openFileId = id; return; }
		secondaryFileId = id;
		splitView.focused = 'secondary';
	}
	function swapPanes() {
		const a = openFileId;
		openFileId = secondaryFileId;
		secondaryFileId = a;
	}
	// X on the secondary pane closes it specifically (primary stays).
	function closeSecondary() {
		secondaryFileId = null;
		splitView.focused = 'primary';
	}
	// "Close split view" toolbar button: exit split, keeping whichever pane is focused.
	function closeSplit() {
		if (splitView.focused === 'secondary') openFileId = secondaryFileId;
		secondaryFileId = null;
		splitView.focused = 'primary';
	}

	// Shared tail of both drop paths (OS drag via Tauri + browser DataTransfer):
	// stash bytes, extract a preview, index into the KB, mark status, autolink.
	async function indexDroppedFile(id: string, name: string, mime: string, kind: FileKind, bytes: ArrayBuffer) {
		try {
			putFileBlob(id, bytes, mime, name);
			extractText(bytes, kind)
				.then((t) => t && setFilePreview(id, t.slice(0, 4000)))
				.catch(() => {}); // justified: preview is cosmetic; indexing below still runs
			const chunks = await kbAdd(currentCanvasId() || 'default', name, mime, bytes);
			setFileStatus(id, chunks > 0 ? 'ready' : 'error');
			if (chunks > 0) scheduleAutolink(id);
		} catch (err) {
			console.error('file index failed', err);
			setFileStatus(id, 'error');
		}
	}

	// Deep-link from global search: a RAG hit on file content opens that file's
	// preview and PdfViewer scrolls to / searches the matching page.
	let previewQuery = $state('');
	let previewPage = $state(0);
	let lastDeepSeq = 0;
	$effect(() => {
		if (deepLink.seq === lastDeepSeq || !deepLink.nodeId) return;
		lastDeepSeq = deepLink.seq;
		previewQuery = deepLink.query;
		previewPage = deepLink.page;
		openFileId = deepLink.nodeId;
	});

	// ── KB overlay (UI lives in KbOverlay.svelte) ───────────────────────────────
	let kbOpen = $state(false);
	let kbOverlayRef = $state<KbOverlay | null>(null);
	function openKB() {
		kbOpen = true;
	}

	// ── Study deck overlay (opens on arbor:study or from the palette) ────────────
	let studyOpen = $state(false);

	function submit(text: string) {
		if (!bubble) return;
		if (bubble.continueId) {
			continueCard(bubble.continueId, text);
			flow.selected = bubble.continueId;
		} else {
			const id = addCard(bubble.flow, text, {
				parentId: bubble.parentId,
				quote: bubble.quote,
				workflow: bubble.deep ? 'deep-web-research' : undefined
			});
			flow.selected = id;
			runModel(id);
		}
		bubble = null;
	}
</script>

<div class="stage">
	{#if ui.view === 'library'}
		<div class="layer" in:swoop out:swoop>
			<Library />
		</div>
	{:else}
		<div class="layer" in:swoop out:swoop>
			<div class="split">
				<!-- capture phase: Svelte Flow's d3-zoom stops dblclick propagation in the bubble phase -->
				<div
					class="wrap"
					class:split-hidden={splitView.active}
					class:cleanup-animating={animatingCleanup}
					class:cursor-default={tool.active === 'select'}
					class:cursor-text={tool.active === 'text'}
					class:cursor-copy={tool.active === 'duplicate'}
					class:cursor-crosshair={tool.active === 'connect' || tool.active === 'color'}
					ondblclickcapture={onDblClick}
					ondrop={onDrop}
					ondragover={(e) => e.preventDefault()}
					onpointerdown={onWrapPointerDown}
					role="presentation"
				>
					<SvelteFlow
						bind:nodes={flow.nodes}
						bind:edges={flow.edges}
						{nodeTypes}
						{edgeTypes}
						colorMode={settings.theme}
						minZoom={0.05}
						onlyRenderVisibleElements={cullNodes}
						zoomOnDoubleClick={false}
						selectionOnDrag={tool.active === 'select'}
						panOnDrag={tool.active === 'select' ? [1, 2] : true}
						proOptions={{ hideAttribution: true }}
						snapGrid={settings.snapToGrid ? [28, 28] : undefined}
						onnodedragstop={onNodeDragStop}
					ondelete={onDelete}
						onpaneclick={onPaneClick}
						onnodeclick={({ node }) => onNodeClick(node)}
					>
						<ClusterHighlights />
						<Background bgColor="var(--c-canvas)" patternColor="var(--c-pattern)" gap={28} />
						<Controls showLock={false} />
					</SvelteFlow>

					{#if pendingBranch}
						<button
							class="branch-trigger glass"
							class:is-hiding={branchHiding}
							style="left: {pendingBranch.x}px; top: {pendingBranch.y}px; z-index: {pendingBranch.overModal ? 200 : 60}"
							in:scale={reducedMotion() ? { duration: 0 } : { duration: 420, start: 0.5, opacity: 0, easing: backOut }}
							onmousedown={(e) => e.preventDefault()}
							onclick={confirmBranch}
						>Follow Up ↵</button>
					{/if}

					{#if bubble}
						<PromptBubble
							x={bubble.x}
							y={bubble.y}
							z={bubble.overModal ? 200 : 50}
							placeholder={bubble.continueId ? 'Follow up…' : 'Ask anything…'}
							onsubmit={submit}
							oncancel={() => (bubble = null)}
						/>
					{/if}

					{#if flow.nodes.length === 0 && !bubble}
						<div class="hint">Double-click anywhere to start</div>
					{/if}

					{#if tool.active === 'connect' && tool.connectFrom}
						<div class="connect-hint">Click another card to connect · Esc to cancel</div>
					{/if}

					{#if tool.active === 'select' && selectedNodes.length > 0}
						<div class="selection-bar">
							<span class="sel-count">{selectedNodes.length} selected</span>
							<button class="sel-btn" onclick={duplicateSelected} title="Duplicate (D)"><Copy size={13} /> Duplicate</button>
							{#if selectedNodes.length >= 2}
								<button class="sel-btn" onclick={doSynthesize} title="Synthesize selected cards"><Combine size={13} /> Synthesize</button>
							{/if}
							<button class="sel-btn sel-btn--danger" onclick={deleteSelected} title="Delete (⌫)"><Trash2 size={13} /> Delete</button>
						</div>
					{/if}

					<div class="topbar">
						<span class="topbar-spacer"></span>
						<CanvasToolbar onDeepResearch={startDeepResearch} onFit={doFitView} onUndo={doUndo} onRedo={doRedo} onKB={openKB} onCleanUp={() => doCleanUp()} />
						<div class="canvas-actions">
							<div class="theme-slot" class:hidden={chatOpen}>
								<ThemeToggle />
							</div>
							<button
								class="canvas-action-btn glass"
								class:active={chatOpen}
								onclick={() => (chatOpen = !chatOpen)}
								aria-label={chatOpen ? 'Close chat panel' : 'Open chat panel'}
								title={chatOpen ? 'Close chat (⌘\\)' : 'Open chat (⌘\\)'}
							>
								<MessageSquare size={16} />
							</button>
						</div>
					</div>
				</div>

					{#if cleaningUp}
						<div class="cleanup-toast" transition:scale={reducedMotion() ? { duration: 0 } : { duration: 180, start: 0.94, easing: backOut, opacity: 0 }}>
							<span class="spinner"></span>
							Cleaning up…
						</div>
					{/if}

				{#if openFileId}
					<FilePanel
						fileId={openFileId}
						initialQuery={previewQuery}
						initialPage={previewPage}
						fill={!!secondaryFileId}
						hideToolbar={!!secondaryFileId}
						growAnim
						focused={splitView.active && splitView.focused === 'primary'}
						onfocuspane={() => (splitView.focused = 'primary')}
						bind:controller={primaryController}
						bind:dirty={primaryDirty}
						bind:saveNow={primarySave}
						onclose={closePrimaryFile}
					/>
				{/if}
				{#if secondaryFileId}
					<FilePanel
						fileId={secondaryFileId}
						fill={true}
						hideToolbar={true}
						focused={splitView.active && splitView.focused === 'secondary'}
						onfocuspane={() => (splitView.focused = 'secondary')}
						bind:controller={secondaryController}
						onclose={closeSecondary}
					/>
				{/if}

				<!-- SplitFileView top toolbar — pane-focused editing tools, top-centre. -->
				{#if splitView.active && focusedController}
					<div class="split-topbar">
						<FileToolbar controller={focusedController} onSwap={swapPanes} onCloseSplit={closeSplit} />
					</div>
				{/if}

				<!-- Chat panel tiles as third column; open state lifted here. In split it
				     stays hidden unless opened (Send to chat), then tiles beside the panes. -->
				<div class="chat-slot" class:split-hidden={splitView.active && !chatOpen}>
					<CardChatPanel bind:open={chatOpen} seedText={chatSeed} />
				</div>
			</div>

			{#if expandId}
				<CardExpand cardId={expandId} onclose={() => (expandId = null)} />
			{/if}

			{#if viewTextId}
				<TextView cardId={viewTextId} onclose={() => (viewTextId = null)} />
			{/if}

			<GlobalSearchBar />
			<CommandPalette open={paletteOpen} {commands} onclose={() => (paletteOpen = false)} />
			<KbOverlay bind:this={kbOverlayRef} bind:open={kbOpen} />
			<StudyOverlay bind:open={studyOpen} />

			<NoteNotifications />

			{#if ctxMenu}
				<CardContextMenu x={ctxMenu.x} y={ctxMenu.y} sections={ctxSections} onselect={onCtxSelect} onclose={() => (ctxMenu = null)} />
			{/if}

			{#if confirmReplace}
				<ConfirmDialog
					title="Save changes before switching?"
					message="This file has unsaved edits."
					confirmLabel="Save"
					discardLabel="Discard"
					onconfirm={async () => { await primarySave?.(); const p = confirmReplace?.proceed; confirmReplace = null; p?.(); }}
					ondiscard={() => { primaryDirty = false; const p = confirmReplace?.proceed; confirmReplace = null; p?.(); }}
					oncancel={() => (confirmReplace = null)}
				/>
			{/if}

			{#if showDriveConnect}
				<DriveConnectDialog
					onconnected={() => {
						showDriveConnect = false;
						const p = pendingDriveImport;
						pendingDriveImport = null;
						if (p) void handleDrivePaste(p.url, p.at);
					}}
					oncancel={() => {
						showDriveConnect = false;
						pendingDriveImport = null;
					}}
				/>
			{/if}

			{#if confirmResyncId}
				<ConfirmDialog
					title="Re-sync from Drive?"
					message="This replaces this note's content with the current version from Google Drive, discarding local edits."
					confirmLabel="Re-sync"
					onconfirm={() => {
						const id = confirmResyncId;
						confirmResyncId = null;
						if (id) void resyncDriveNode(id);
					}}
					oncancel={() => (confirmResyncId = null)}
				/>
			{/if}

			<!-- Global studio-job errors — survive the file panel closing. -->
			{#if studioToasts.length}
				<div class="studio-toasts">
					{#each studioToasts as toast (toast.id)}
						<div class="studio-toast" role="alert" transition:scale={reducedMotion() ? { duration: 0 } : { duration: 180, start: 0.94, easing: backOut, opacity: 0 }}>
							<span>{toast.message}</span>
							<button class="studio-toast-x" onclick={() => dismissToast(toast.id)} aria-label="Dismiss"><X size={13} /></button>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
	}
	.layer {
		position: absolute;
		inset: 0;
		transform-origin: center;
		display: flex;
		flex-direction: column;
	}
	.split {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: row;
		overflow: hidden;
		position: relative;
	}
	/* SplitFileView: canvas + chat collapse so the two file panes fill the screen. */
	.split-hidden {
		display: none !important;
	}
	/* Wrapper is layout-transparent so CardChatPanel keeps tiling as a flex column. */
	.chat-slot {
		display: contents;
	}
	.split-topbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		z-index: 50;
	}
	.wrap {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		position: relative;
		/* drives the toolbar's container queries — it squeezes as this shrinks */
		container-type: inline-size;
		container-name: canvasarea;
	}
	.hint {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		font-family: var(--font-mono);
		font-size: 13px;
		letter-spacing: 0.5px;
		color: rgba(var(--ink-rgb), 0.32);
	}
	.connect-hint {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
		font-size: 12px;
		padding: 6px 14px;
		border-radius: var(--r-pill, 999px);
		pointer-events: none;
		box-shadow: var(--elev-2);
	}
	/* Sits just under the toolbar pill, same pill language as GlobalSearchBar/CanvasToolbar. */
	.cleanup-toast {
		position: absolute;
		top: 64px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 45;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		font-size: 12px;
		color: var(--c-ink);
		pointer-events: none;
	}
	/* Bottom-centre error stack for studio jobs (mind map / study). */
	.studio-toasts {
		position: absolute;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 120;
		display: flex;
		flex-direction: column;
		gap: 8px;
		align-items: center;
	}
	.studio-toast {
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 420px;
		padding: 9px 14px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-canvas, #fff);
		border: 1px solid rgba(220, 38, 38, 0.4);
		box-shadow: var(--elev-2, 0 6px 24px rgba(0, 0, 0, 0.12));
		font-size: 12px;
		color: #b91c1c;
	}
	.studio-toast-x {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 2px;
		font-size: 12px;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		border: 2px solid rgba(var(--ink-rgb), 0.18);
		border-top-color: var(--c-ink);
		animation: spin 0.7s linear infinite;
		flex: none;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
	.branch-trigger {
		position: fixed;
		transform: translate(-50%, -50%);
		padding: 8px 18px;
		border-radius: var(--r-pill);
		border: none;
		font-size: 14px;
		font-family: var(--font-sans);
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
		white-space: nowrap;
		transition: transform 180ms var(--ease-glass), opacity 180ms ease;
	}
	.branch-trigger:active {
		transform: translate(-50%, -50%) scale(0.93);
	}
	.branch-trigger.is-hiding {
		transform: translate(-50%, -50%) scale(0.82);
		opacity: 0;
		pointer-events: none;
	}

	/* Resize controls (SvelteFlow NodeResizer): invisible paint, enlarged hit area.
	   Default xyflow hit targets are razor-thin (1px lines, 5x5px corner handles) —
	   fine when the blue paint shows you exactly where they are, but once invisible
	   that thinness makes the cursor flicker between hand/pointer/resize and makes
	   diagonal/vertical drags nearly impossible to grab. Enlarging keeps the same
	   centering (xyflow's own translate(-50%, ...) centers on the element's own
	   size), so the bigger invisible box still straddles the true edge/corner.
	   Scoped under .wrap so it outranks the library's own CSS, which
	   @xyflow/svelte/dist/style.css (imported above) loads after tokens.css. */
	.wrap :global(.svelte-flow__resize-control.line) {
		border-color: transparent;
	}
	.wrap :global(.svelte-flow__resize-control.line.left),
	.wrap :global(.svelte-flow__resize-control.line.right) {
		width: 14px;
	}
	.wrap :global(.svelte-flow__resize-control.line.top),
	.wrap :global(.svelte-flow__resize-control.line.bottom) {
		height: 14px;
	}
	.wrap :global(.svelte-flow__resize-control.handle) {
		width: 18px;
		height: 18px;
		background: transparent;
		border-color: transparent;
	}

	/* Edge (connection line) visibility */
	.wrap :global(.svelte-flow__edge-path) {
		stroke: var(--c-edge);
		stroke-width: 2;
	}
	.wrap :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke: var(--c-edge-selected);
		stroke-width: 2.5;
	}
	/* An edge whose source/target node is selected (not the edge itself clicked) —
	   colorful breathing glow, cycling between the two accent colors already used
	   for selection elsewhere (magenta / violet), matching the node glow ring. */
	/* No drop-shadow filter here: animating an SVG filter forces a full repaint of
	   the edge layer every frame in WKWebView — measurable GPU/battery cost. */
	@keyframes edge-breathe {
		0%,
		100% {
			stroke: var(--c-edge-selected);
			stroke-width: 2.5px;
		}
		50% {
			stroke: var(--c-edge-semantic);
			stroke-width: 4px;
		}
	}
	/* ConnectedEdge.svelte applies .connected directly to the path (BaseEdge's
	   class prop), not to the parent <g> — props-driven, not a DOM query, so it
	   can't race SvelteFlow's own render cycle. */
	.wrap :global(.svelte-flow__edge-path.connected) {
		animation: edge-breathe 1.8s ease-in-out infinite;
	}
	@media (prefers-reduced-motion: reduce) {
		.wrap :global(.svelte-flow__edge-path.connected) {
			animation: none;
			stroke: var(--c-edge-selected);
			stroke-width: 3px;
		}
	}
	.wrap :global(.svelte-flow__connection-path) {
		stroke: var(--c-edge);
		stroke-width: 2;
	}

	/* Cursor overrides per tool */
	.wrap.cursor-default :global(.svelte-flow__pane) { cursor: default; }
	.wrap.cursor-text :global(.svelte-flow__pane) { cursor: text; }
	.wrap.cursor-copy :global(.svelte-flow__pane) { cursor: copy; }
	.wrap.cursor-crosshair :global(.svelte-flow__pane) { cursor: crosshair; }

	/* Swoop animation for cards during Clean Up */
	.wrap.cleanup-animating :global(.svelte-flow__node) {
		transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	/* Promote every node to its own GPU compositing layer. SvelteFlow positions nodes
	   with an inline transform:translate but gives no layer hint, so a viewport *zoom*
	   (scale) forces WKWebView to repaint every card's content each frame — the root
	   cause of fit/zoom lag (Timeline: ~150ms composites, multi-frame jank on F, GPU
	   re-raster stalls). will-change makes pan/zoom/fit/drag pure GPU transforms; layers
	   re-raster crisp once motion settles. Bounded by culling above CULL_THRESHOLD, so
	   the on-screen layer count (and thus GPU memory) can't grow without limit. */
	.wrap :global(.svelte-flow__node) {
		will-change: transform;
	}

	/* Remove SvelteFlow's default border/padding/background on group nodes */
	.wrap :global(.svelte-flow__node-group) {
		border: none;
		padding: 0;
		background: transparent;
	}

	.selection-bar {
		position: absolute;
		bottom: 20px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 40;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border-radius: var(--r-pill, 999px);
		background: var(--c-ink);
		color: var(--c-on-primary, #fff);
		font-size: 12px;
		box-shadow: var(--elev-2);
		white-space: nowrap;
	}
	.sel-count {
		opacity: 0.65;
		font-family: var(--font-mono);
		padding-right: 4px;
	}
	.sel-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		border: none;
		background: rgba(255,255,255,0.12);
		color: inherit;
		font-size: 12px;
		font-family: var(--font-sans);
		font-weight: 500;
		padding: 3px 10px;
		border-radius: var(--r-pill, 999px);
		cursor: pointer;
		transition: background 0.1s;
	}
	.sel-btn:hover { background: rgba(255,255,255,0.22); }
	.sel-btn--danger:hover { background: rgba(255, 80, 80, 0.5); }


	/* 3-col grid: [spacer 1fr] [toolbar auto] [canvas-actions 1fr].
	   Toolbar stays centered; canvas-actions can never push into it. */
	.topbar {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		pointer-events: none;
		z-index: 40;
	}
	.canvas-actions {
		justify-self: end;
		display: flex;
		align-items: center;
		gap: 10px;
		padding-right: 20px;
		pointer-events: auto;
	}
	.theme-slot {
		display: flex;
		transition: opacity var(--ease-glass);
	}
	.theme-slot.hidden {
		opacity: 0;
		pointer-events: none;
	}
	.canvas-action-btn {
		width: 32px;
		height: 32px;
		border-radius: var(--r-full);
		border: none;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--c-ink);
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.canvas-action-btn:active {
		transform: scale(0.88);
	}
	.canvas-action-btn.active {
		background: var(--c-ink);
		color: var(--c-on-primary);
	}
</style>
