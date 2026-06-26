<script lang="ts">
	import { SvelteFlow, Background, Controls, useSvelteFlow } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';
	import CardNode from './CardNode.svelte';
	import FileCard from './FileCard.svelte';
	import WebCard from './WebCard.svelte';
	import CanvasToolbar from './CanvasToolbar.svelte';
	import PromptBubble from './PromptBubble.svelte';
	import CardExpand from './CardExpand.svelte';
	import CardChatPanel from './CardChatPanel.svelte';
	import {
		flow,
		ui,
		addCard,
		addFileCard,
		addWebCard,
		setFileStatus,
		setFilePreview,
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
	import { ragAdd, DEFAULT_CANVAS } from '$lib/ai/client';
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

	const { screenToFlowPosition } = useSvelteFlow();
	const nodeTypes = { card: CardNode, file: FileCard, web: WebCard };

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

	function startDeepResearch() {
		const x = window.innerWidth / 2;
		const y = 140;
		bubble = { x, y, flow: screenToFlowPosition({ x, y }), deep: true };
	}

	let expandId = $state<string | null>(null);
	let lastBranchAt = 0;

	// Chat panel open state lifted here so the flex layout can include it.
	let chatOpen = $state(false);

	function onDblClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.classList.contains('svelte-flow__pane')) return;
		bubble = {
			x: e.clientX,
			y: e.clientY,
			flow: screenToFlowPosition({ x: e.clientX, y: e.clientY })
		};
	}

	function onBranchEvent(e: Event) {
		lastBranchAt = Date.now();
		const { x, y, parentId, quote, overModal } = (e as CustomEvent).detail;
		const parent = flow.nodes.find((n) => n.id === parentId);
		const pos = parent
			? { x: parent.position.x + 60, y: parent.position.y + 260 }
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
		const radius = 100 + Math.random() * 60;
		const angle = Math.random() * 2 * Math.PI;
		const bw = 180;
		const x = Math.max(bw, Math.min(window.innerWidth - bw, cx + Math.cos(angle) * radius));
		const y = Math.max(50, Math.min(window.innerHeight - 50, cy + Math.sin(angle) * radius));
		onBranchEvent(
			new CustomEvent('loom:branch', {
				detail: { x, y, parentId, quote: text, overModal }
			})
		);
	}

	function onContinueEvent(e: Event) {
		const { cardId, x, y } = (e as CustomEvent).detail;
		bubble = { x, y, flow: screenToFlowPosition({ x, y }), continueId: cardId };
	}

	function onExpandEvent(e: Event) {
		if (Date.now() - lastBranchAt < 400) return;
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

	// Keyboard: Escape closes file preview; Cmd/Ctrl+Z undoes; Cmd/Ctrl+Shift+Z redoes.
	function onKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		const inInput =
			tag === 'INPUT' ||
			tag === 'TEXTAREA' ||
			(e.target as HTMLElement)?.isContentEditable;

		if (e.key === 'Escape' && !inInput && openFileId) {
			openFileId = null;
			e.preventDefault();
			return;
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
		window.addEventListener('loom:weburl', onWebUrlEvent);
		window.addEventListener('loom:openfile', onOpenFileEvent);
		window.addEventListener('keydown', onKeydown);
		document.addEventListener('mouseup', onDocSelect);
		document.addEventListener('paste', onPaste);

		let tauriUnlisten: (() => void) | null = null;
		if (canUseFs()) {
			(async () => {
				const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
				const { invoke } = await import('@tauri-apps/api/core');
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
							const b64 = await invoke<string>('file_read_bytes', { path: filePath });
							const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
							putFileBlob(id, bytes, mime, name);
							extractText(bytes, kind).then((t) => t && setFilePreview(id, t.slice(0, 4000))).catch(() => {});
							await ragAdd(DEFAULT_CANVAS, name, mime, bytes);
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
			window.removeEventListener('loom:weburl', onWebUrlEvent);
			window.removeEventListener('loom:openfile', onOpenFileEvent);
			window.removeEventListener('keydown', onKeydown);
			document.removeEventListener('mouseup', onDocSelect);
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
				await ragAdd(DEFAULT_CANVAS, file.name, file.type, buf);
				setFileStatus(id, 'ready');
			} catch (err) {
				console.error('rag index failed', err);
				setFileStatus(id, 'error');
			}
		}
	}

	let openFileId = $state<string | null>(null);
	function onOpenFileEvent(e: Event) {
		openFileId = (e as CustomEvent).detail.fileId;
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
					>
						<Background bgColor="var(--c-canvas)" patternColor="#ececec" gap={28} />
						<Controls showLock={false} />
					</SvelteFlow>

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

					<CanvasToolbar onDeepResearch={startDeepResearch} />
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
</style>
