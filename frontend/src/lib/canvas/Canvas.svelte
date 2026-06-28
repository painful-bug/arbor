<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';
	import CardNode from './CardNode.svelte';
	import FileCard from './FileCard.svelte';
	import WebCard from './WebCard.svelte';
	import UserTextCard from './UserTextCard.svelte';
	import TextView from './TextView.svelte';
	import CanvasToolbar from './CanvasToolbar.svelte';
	import PromptBubble from './PromptBubble.svelte';
	import CardExpand from './CardExpand.svelte';
	import CardChatPanel from './CardChatPanel.svelte';
	import {
		flow,
		tool,
		ui,
		addCard,
		addFileCard,
		addWebCard,
		addTextCard,
		setFileStatus,
		setFilePreview,
		cycleCardBlock,
		duplicateNode,
		addManualEdge,
		runModel,
		continueCard,
		saveCanvas,
		pushHistory,
		undo,
		redo,
		init
	} from './store.svelte';
	import Library from './Library.svelte';
	import FilePanel from './FilePanel.svelte';
	import { asUrl } from '$lib/url';
	import { putFileBlob, kindOf, extractText, mimeFromExt, canUseFs, hydrateFileBlobs } from '$lib/files';
	import { kbAdd, kbClear, kbContents } from '$lib/ai/client';
	import { currentCanvasId } from './store.svelte';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { reducedMotion } from '$lib/theme/motion.svelte';

	// Swoop: spring scale + drop. Out = canvas falls away to the Library; in = a
	// canvas springs back into view. Shared by both layers so they cross-fade.
	function swoop(_node: Element) {
		if (reducedMotion()) return { duration: 0 };
		return {
			duration: 460,
			easing: backOut,
			css: (t: number, u: number) =>
				`transform: scale(${0.86 + 0.14 * t}) translateY(${u * 48}px); opacity: ${t}`
		};
	}

	const { screenToFlowPosition, fitView } = useSvelteFlow();
	const nodeTypes = { card: CardNode, file: FileCard, web: WebCard, text: UserTextCard };

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

	function doFitView() {
		requestAnimationFrame(() => fitView({ duration: 300, padding: 0.1 }));
	}

	function startDeepResearch() {
		const x = window.innerWidth / 2;
		const y = 140;
		bubble = { x, y, flow: screenToFlowPosition({ x, y }), deep: true };
	}

	let expandId = $state<string | null>(null);
	let viewTextId = $state<string | null>(null);
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

	// Pane click: text tool places a note card.
	function onPaneClick({ event }: { event: MouseEvent }) {
		if (tool.active !== 'text') return;
		const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		const id = addTextCard(pos);
		flow.selected = id;
		// Open editor immediately; revert to hand tool.
		window.dispatchEvent(new CustomEvent('loom:openfile', { detail: { fileId: id } }));
		tool.active = 'hand';
	}

	// Node click: duplicate / color / connect tool dispatch.
	function onNodeClick(node: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number }) {
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
					addManualEdge(tool.connectFrom, node.id, bestSide(sc, tc) + '-s', bestSide(tc, sc) + '-t');
				}
				tool.connectFrom = null;
			}
		}
	}

	function onViewTextEvent(e: Event) {
		viewTextId = (e as CustomEvent).detail.cardId;
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
		onBranchEvent(new CustomEvent('loom:branch', { detail: { x, y, parentId, quote, overModal } }));
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

	// Auto-reconnect edges to the nearest side handle when a node is dragged.
	// All node types (card, file, web) now share the same handle ID convention:
	// top-s/top-t, right-s/right-t, bottom-s/bottom-t, left-s/left-t.
	const SIDE_HANDLE_RE = /^(top|right|bottom|left)-(s|t)$/;

	function nodeCenter(node: { position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number }) {
		const w = (node.measured?.width ?? node.width ?? 400);
		const h = (node.measured?.height ?? node.height ?? 200);
		return { x: node.position.x + w / 2, y: node.position.y + h / 2 };
	}

	function bestSide(from: { x: number; y: number }, to: { x: number; y: number }): string {
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'bottom' : 'top');
	}

	function onNodeDragStop({ nodes }: { targetNode: unknown; nodes: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; width?: number; height?: number }[]; event: MouseEvent | TouchEvent }) {
		const movedIds = new Set<string>(nodes.map((n) => n.id));
		flow.edges = flow.edges.map((edge) => {
			if (!movedIds.has(edge.source) && !movedIds.has(edge.target)) return edge;
			const src = flow.nodes.find((n) => n.id === edge.source);
			const tgt = flow.nodes.find((n) => n.id === edge.target);
			if (!src || !tgt) return edge;
			// Only remap side handles (named or null/undefined from old saves).
			// Skip corner handles and any other custom handles.
			const srcHandle = edge.sourceHandle;
			const tgtHandle = edge.targetHandle;
			const srcOk = srcHandle == null || SIDE_HANDLE_RE.test(srcHandle);
			const tgtOk = tgtHandle == null || SIDE_HANDLE_RE.test(tgtHandle);
			if (!srcOk || !tgtOk) return edge;
			const sc = nodeCenter(src);
			const tc = nodeCenter(tgt);
			return {
				...edge,
				sourceHandle: bestSide(sc, tc) + '-s',
				targetHandle: bestSide(tc, sc) + '-t'
			};
		});
	}

	function onWebUrlEvent(e: Event) {
		const { url, parentId } = (e as CustomEvent).detail;
		const parent = parentId && flow.nodes.find((n) => n.id === parentId);
		const pos = parent
			? { x: parent.position.x + (parent.width ?? 560) + 48, y: parent.position.y }
			: screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		flow.selected = addWebCard(pos, url, { parentId: parent ? parentId : undefined });
	}

	function onPaste(e: ClipboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA') return;
		const url = asUrl(e.clipboardData?.getData('text') ?? '');
		if (!url) return;
		e.preventDefault();
		const pos = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
		flow.selected = addWebCard(pos, url);
	}

	// Keyboard: tool hotkeys, Escape, Cmd/Ctrl+Z undo/redo.
	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		const inInput =
			tag === 'INPUT' ||
			tag === 'TEXTAREA' ||
			(e.target as HTMLElement)?.isContentEditable;

		if (!inInput) {
			if (e.key === 'Enter' && pendingBranch) { e.preventDefault(); confirmBranch(); return; }

			// Escape: close panels/modals in priority order; last resort → reset to hand.
			if (e.key === 'Escape') {
				if (pendingBranch) { dismissBranch(); e.preventDefault(); return; }
				if (openFileId) { openFileId = null; e.preventDefault(); return; }
				if (viewTextId) { viewTextId = null; e.preventDefault(); return; }
				if (expandId) { expandId = null; e.preventDefault(); return; }
				if (tool.active !== 'hand' || tool.connectFrom) {
					tool.active = 'hand';
					tool.connectFrom = null;
					e.preventDefault();
					return;
				}
			}
			// Tool hotkeys (no modifier).
			if (!e.metaKey && !e.ctrlKey && !e.altKey) {
				if (e.key === 'h' || e.key === 'H') { tool.active = 'hand'; tool.connectFrom = null; e.preventDefault(); }
				else if (e.key === 't' || e.key === 'T') { tool.active = 'text'; e.preventDefault(); }
				else if (e.key === 'd' || e.key === 'D') { tool.active = 'duplicate'; e.preventDefault(); }
				else if (e.key === 'c' || e.key === 'C') { tool.active = 'connect'; e.preventDefault(); }
				else if (e.key === 'u' || e.key === 'U') { undo(); e.preventDefault(); }
				else if (e.key === 'f' || e.key === 'F') { doFitView(); e.preventDefault(); }
			}
		}

		if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !inInput) {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
		}
	}

	// Click on the canvas region closes the file preview (FilePanel is a sibling,
	// so its clicks don't bubble here).
	function onWrapPointerDown() {
		if (openFileId) openFileId = null;
	}

	onMount(() => {
		// Async init: load canvas from ~/.loom, then hydrate file bytes.
		void init().then(() => {
			const fileIds = flow.nodes.filter((n) => n.type === 'file').map((n) => n.id);
			if (fileIds.length) void hydrateFileBlobs(fileIds);
		});

		window.addEventListener('loom:branch', onBranchEvent);
		window.addEventListener('loom:continue', onContinueEvent);
		window.addEventListener('loom:expand', onExpandEvent);
		window.addEventListener('loom:viewtext', onViewTextEvent);
		window.addEventListener('loom:weburl', onWebUrlEvent);
		window.addEventListener('loom:openfile', onOpenFileEvent);
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
					for (const filePath of paths) {
						const name = filePath.split(/[/\\]/).pop() ?? filePath;
						const ext = name.split('.').pop()?.toLowerCase() ?? '';
						const mime = mimeFromExt(ext);
						const kind = kindOf(name, mime);
						const id = addFileCard(pos, name, { mime, kind, path: filePath });
						pos = { x: pos.x + 30, y: pos.y + 30 };
						try {
							const res = await apiFetch(`/api/files/read-bytes?path=${encodeURIComponent(filePath)}`);
							const b64 = await res.text();
							const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
							putFileBlob(id, bytes, mime, name);
							extractText(bytes, kind).then((t) => t && setFilePreview(id, t.slice(0, 4000))).catch(() => {});
							await kbAdd(currentCanvasId() || 'default', name, mime, bytes);
							setFileStatus(id, 'ready');
						} catch (err) {
							console.error('tauri file drop read failed', err);
							setFileStatus(id, 'error');
						}
					}
				});
			})();
		}

		return () => {
			window.removeEventListener('loom:branch', onBranchEvent);
			window.removeEventListener('loom:continue', onContinueEvent);
			window.removeEventListener('loom:expand', onExpandEvent);
			window.removeEventListener('loom:viewtext', onViewTextEvent);
			window.removeEventListener('loom:weburl', onWebUrlEvent);
			window.removeEventListener('loom:openfile', onOpenFileEvent);
			window.removeEventListener('keydown', onKeydown);
			document.removeEventListener('mouseup', onDocSelect);
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('paste', onPaste);
			tauriUnlisten?.();
		};
	});

	// Autosave + push undo snapshot on change; debounced so streaming doesn't thrash.
	// Skip the first run: it's the initial empty state before init() loads real data.
	let saveTimer: ReturnType<typeof setTimeout>;
	let mounted = false;
	$effect(() => {
		flow.nodes;
		flow.edges; // track
		if (!mounted) {
			mounted = true;
			return;
		}
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			saveCanvas();
			pushHistory();
		}, 400);
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
		for (const file of files) {
			const kind = kindOf(file.name, file.type);
			const id = addFileCard(pos, file.name, { mime: file.type, kind });
			pos = { x: pos.x + 30, y: pos.y + 30 };
			try {
				const buf = await file.arrayBuffer();
				putFileBlob(id, buf, file.type, file.name);
				extractText(buf, kind)
					.then((t) => t && setFilePreview(id, t.slice(0, 4000)))
					.catch(() => {});
				await kbAdd(currentCanvasId() || 'default', file.name, file.type, buf);
				setFileStatus(id, 'ready');
			} catch (err) {
				console.error('kb index failed', err);
				setFileStatus(id, 'error');
			}
		}
	}

	let openFileId = $state<string | null>(null);
	function onOpenFileEvent(e: Event) {
		openFileId = (e as CustomEvent).detail.fileId;
	}

	// ── KB overlay ───────────────────────────────────────────────────────────────
	let kbOpen = $state(false);
	let kbData = $state<{ nodes: string[]; facts: string[] } | null>(null);
	let kbLoading = $state(false);
	let kbClearing = $state(false);
	let kbClearConfirm = $state(false);

	async function openKB() {
		kbOpen = true;
		kbData = null;
		kbLoading = true;
		kbClearConfirm = false;
		kbData = await kbContents(currentCanvasId() || 'default');
		kbLoading = false;
	}

	async function doKBClear() {
		if (!kbClearConfirm) { kbClearConfirm = true; return; }
		kbClearing = true;
		await kbClear(currentCanvasId() || 'default');
		kbClearConfirm = false;
		// Re-read after the backend has cleared + drained its queue, so the viewer
		// reflects the now-empty graph instead of a stale snapshot.
		kbData = await kbContents(currentCanvasId() || 'default');
		kbClearing = false;
	}

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
						zoomOnDoubleClick={false}
						proOptions={{ hideAttribution: true }}
						onnodedragstop={onNodeDragStop}
						onpaneclick={onPaneClick}
						onnodeclick={({ node }) => onNodeClick(node)}
					>
						<Background bgColor="var(--c-canvas)" patternColor="#ececec" gap={28} />
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

					<CanvasToolbar onDeepResearch={startDeepResearch} onFit={doFitView} onUndo={undo} onKB={openKB} />
				</div>

				{#if openFileId}
					<FilePanel fileId={openFileId} onclose={() => (openFileId = null)} />
				{/if}

				<!-- Chat panel tiles as third column; open state lifted here -->
				<CardChatPanel bind:open={chatOpen} />
			</div>

			{#if expandId}
				<CardExpand cardId={expandId} onclose={() => (expandId = null)} />
			{/if}

			{#if viewTextId}
				<TextView cardId={viewTextId} onclose={() => (viewTextId = null)} />
			{/if}

			{#if kbOpen}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="kb-backdrop" onpointerdown={() => { kbOpen = false; kbClearConfirm = false; }}>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="kb-panel" onpointerdown={(e) => e.stopPropagation()}>
						<header class="kb-header">
							<span class="kb-title">Knowledge Base</span>
							<div class="kb-actions">
								<button
									class="kb-btn kb-clear"
									class:confirm={kbClearConfirm}
									onclick={doKBClear}
									disabled={kbClearing}
								>
									{kbClearing ? 'Clearing…' : kbClearConfirm ? 'Confirm clear?' : 'Clear KB'}
								</button>
								{#if kbClearConfirm}
									<button class="kb-btn" onclick={() => (kbClearConfirm = false)}>Cancel</button>
								{/if}
								<button class="kb-btn" onclick={openKB} disabled={kbLoading} title="Refresh">↺</button>
								<button class="kb-btn" onclick={() => { kbOpen = false; kbClearConfirm = false; }}>✕</button>
							</div>
						</header>
						<div class="kb-body">
							{#if kbLoading}
								<div class="kb-empty">Loading…</div>
							{:else if !kbData || (kbData.nodes.length === 0 && kbData.facts.length === 0)}
								<div class="kb-empty">KB is empty — drop files onto the canvas to index them.</div>
							{:else}
								{#if kbData.nodes.length}
									<section>
										<h3>Entities ({kbData.nodes.length})</h3>
										<ul>
											{#each kbData.nodes as n (n)}
												<li>{n}</li>
											{/each}
										</ul>
									</section>
								{/if}
								{#if kbData.facts.length}
									<section>
										<h3>Facts ({kbData.facts.length})</h3>
										<ul>
											{#each kbData.facts as f (f)}
												<li>{f}</li>
											{/each}
										</ul>
									</section>
								{/if}
							{/if}
						</div>
					</div>
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
	}
	.wrap {
		flex: 1;
		min-width: 0;
		height: 100%;
		overflow: hidden;
		position: relative;
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
		color: rgba(0, 0, 0, 0.32);
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

	/* Cursor overrides per tool */
	.wrap.cursor-text :global(.svelte-flow__pane) { cursor: text; }
	.wrap.cursor-copy :global(.svelte-flow__pane) { cursor: copy; }
	.wrap.cursor-crosshair :global(.svelte-flow__pane) { cursor: crosshair; }

	/* ── KB overlay ──────────────────────────────────────────────────────────── */
	.kb-backdrop {
		position: absolute;
		inset: 0;
		z-index: 80;
		background: rgba(0, 0, 0, 0.28);
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 64px;
	}
	.kb-panel {
		width: min(680px, 92vw);
		max-height: 72vh;
		background: var(--c-canvas);
		border-radius: 14px;
		border: 1px solid var(--c-hairline);
		box-shadow: var(--elev-3, 0 12px 48px rgba(0,0,0,0.18));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.kb-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--c-hairline);
		flex: none;
	}
	.kb-title {
		font-weight: 600;
		font-size: 14px;
	}
	.kb-actions {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.kb-btn {
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 8px;
		padding: 4px 10px;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
	}
	.kb-btn:disabled { opacity: 0.5; cursor: default; }
	.kb-btn.kb-clear { color: #c0392b; border-color: #f5c6c6; }
	.kb-btn.kb-clear.confirm { background: #c0392b; color: #fff; border-color: #c0392b; }
	.kb-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		font-size: 13px;
		line-height: 1.55;
	}
	.kb-empty {
		color: rgba(0,0,0,0.45);
		text-align: center;
		padding: 32px 0;
	}
	.kb-body section { margin-bottom: 20px; }
	.kb-body h3 {
		font-size: 11px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: rgba(0,0,0,0.45);
		margin: 0 0 8px;
	}
	.kb-body ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.kb-body li {
		padding: 5px 10px;
		background: var(--c-surface-soft, rgba(0,0,0,0.03));
		border-radius: 6px;
		font-family: var(--font-mono);
		font-size: 12px;
		word-break: break-word;
	}
</style>
