<script lang="ts">
	// Self-contained PDF viewer with toolbar: fit modes, zoom, page nav, highlight
	// tool + color picker, search, and highlights persisted inside the canvas doc.
	import { tick } from 'svelte';
	import { flow, currentCanvasId, setFileHighlights, type PdfHL } from './store.svelte';
	import { kbSearchHits } from '$lib/ai/client';

	let { fileId, blob, initialQuery = '', initialPage = 0 }:
		{ fileId: string; blob: { bytes: ArrayBuffer; mime: string; name: string } | undefined; initialQuery?: string; initialPage?: number } = $props();

	// ── Highlight colors ────────────────────────────────────────────────────────
	const COLORS = [
		{ label: 'Yellow', value: 'rgba(255,222,89,0.50)' },
		{ label: 'Green',  value: 'rgba(74,222,128,0.50)' },
		{ label: 'Blue',   value: 'rgba(96,165,250,0.50)' },
		{ label: 'Pink',   value: 'rgba(251,113,133,0.50)' },
		{ label: 'Orange', value: 'rgba(251,146,60,0.50)' },
	];

	// ── State ───────────────────────────────────────────────────────────────────
	type FitMode = 'width' | 'page' | 'actual';
	type Tool = 'pan' | 'highlight';

	let pagesEl = $state<HTMLDivElement>();
	let pages = $state<number[]>([]);
	let baseSizes = $state<{ w: number; h: number }[]>([]);  // scale-1 page dims
	let fitMode = $state<FitMode>('width');
	let zoomFactor = $state(1);      // multiplier on top of fit scale
	let tool = $state<Tool>('pan');
	let activeColor = $state(COLORS[0].value);
	let currentPage = $state(1);
	let totalPages = $state(0);
	let jumpValue = $state('');
	let jumping = $state(false);     // show jump input

	let query = $state('');
	let searchIndex = $state<{ page: number; x: number; y: number; w: number; h: number; text: string }[][]>([]);
	let searchHits = $state<{ page: number; idx: number; x: number; y: number; w: number; h: number }[]>([]);
	let searchCursor = $state(0);
	// KB fallback for scanned/OCR PDFs (empty embedded text layer): page-level hits
	// from the knowledge base, since the only OCR text lives there.
	let pageHits = $state<number[]>([]); // 1-based pages, sorted, deduped
	let pageCursor = $state(0);
	const filename = $derived(
		((flow.nodes.find((n) => n.id === fileId)?.data as { filename?: string })?.filename) ?? blob?.name ?? ''
	);

	// Send-to-chat context popup
	let selectionText = $state('');
	let selPopup = $state<{ x: number; y: number } | null>(null);

	// Highlights from canvas store
	const nodeHighlights = $derived(
		((flow.nodes.find((n) => n.id === fileId)?.data as { highlights?: PdfHL[] })?.highlights) ?? []
	);
	let highlights = $state<PdfHL[]>([]);
	$effect(() => { highlights = [...nodeHighlights]; });

	// ── Container sizing ────────────────────────────────────────────────────────
	let containerW = $state(0);
	let containerH = $state(0);

	// Returns LOGICAL scale (CSS pixels per PDF point). DPR is handled separately via canvas transform.
	function effectiveScale(pageIdx: number): number {
		const base = baseSizes[pageIdx];
		if (!base || containerW <= 0) return 0;
		if (fitMode === 'actual') return zoomFactor;
		if (fitMode === 'page') {
			const sw = (containerW - 32) / base.w;
			const sh = (containerH - 32) / base.h;
			return Math.min(sw, sh) * zoomFactor;
		}
		// 'width' default
		return ((containerW - 32) / base.w) * zoomFactor;
	}

	// ── PDF load + render ────────────────────────────────────────────────────────
	let pdfDoc: import('pdfjs-dist').PDFDocumentProxy | null = null;
	let rendering = false;

	async function loadAndRender() {
		if (!blob || !pagesEl || rendering) return;
		rendering = true;
		try {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = (
				await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
			).default;
			if (pdfDoc) {
				// Re-use existing doc; just re-render with new scale
				await renderAll(pdfjs, pdfDoc);
			} else {
				pdfDoc = await pdfjs.getDocument({ data: blob.bytes.slice(0) }).promise;
				totalPages = pdfDoc.numPages;
				pages = Array.from({ length: pdfDoc.numPages }, (_, i) => i);
				// Capture base (scale-1) sizes for all pages
				const sizes: { w: number; h: number }[] = [];
				for (let i = 0; i < pdfDoc.numPages; i++) {
					const p = await pdfDoc.getPage(i + 1);
					const vp = p.getViewport({ scale: 1 });
					sizes.push({ w: vp.width, h: vp.height });
				}
				baseSizes = sizes;
				await tick();
				await renderAll(pdfjs, pdfDoc);
				await buildSearchIndex(pdfDoc);
			}
		} finally {
			rendering = false;
		}
	}

	async function renderAll(pdfjs: typeof import('pdfjs-dist'), doc: import('pdfjs-dist').PDFDocumentProxy) {
		if (!pagesEl) return;
		for (let i = 0; i < doc.numPages; i++) {
			await renderPage(pdfjs, doc, i);
		}
	}

	async function renderPage(pdfjs: typeof import('pdfjs-dist'), doc: import('pdfjs-dist').PDFDocumentProxy, i: number) {
		if (!pagesEl) return;
		const logicalScale = effectiveScale(i);
		if (logicalScale <= 0) return; // containerW not ready yet

		const page = await doc.getPage(i + 1);
		const dpr = window.devicePixelRatio || 1;
		// Logical viewport drives CSS dimensions and TextLayer span positions
		const viewport = page.getViewport({ scale: logicalScale });

		const wrap = pagesEl.querySelector(`[data-page="${i}"]`) as HTMLElement | null;
		if (!wrap) return;

		// Set CSS variables required by pdf.js v6 TextLayer for span font-size/positioning
		wrap.style.setProperty('--scale-factor', String(logicalScale));
		wrap.style.setProperty('--total-scale-factor', String(logicalScale));
		wrap.style.setProperty('--scale-round-x', '1px');
		wrap.style.setProperty('--scale-round-y', '1px');

		wrap.style.width  = `${viewport.width}px`;
		wrap.style.height = `${viewport.height}px`;

		// Canvas: render at DPR resolution for crisp output, using a transform
		const canvas = wrap.querySelector('canvas') as HTMLCanvasElement;
		canvas.width  = Math.floor(viewport.width * dpr);
		canvas.height = Math.floor(viewport.height * dpr);
		canvas.style.width  = `${viewport.width}px`;
		canvas.style.height = `${viewport.height}px`;
		const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined;
		await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport, transform }).promise;

		// TextLayer uses the SAME logical viewport — span positions match CSS pixels exactly
		const textDiv = wrap.querySelector('.textlayer') as HTMLElement;
		textDiv.innerHTML = '';
		const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
		await tl.render();
	}

	// ── Search index ────────────────────────────────────────────────────────────
	async function buildSearchIndex(doc: import('pdfjs-dist').PDFDocumentProxy) {
		const index: typeof searchIndex = [];
		for (let i = 0; i < doc.numPages; i++) {
			const page = await doc.getPage(i + 1);
			const vp = page.getViewport({ scale: 1 });
			const content = await page.getTextContent();
			const rects: (typeof searchIndex)[0] = [];
			for (const item of content.items) {
				if (!('str' in item) || !item.str.trim()) continue;
				const [a, b, c, d, e, f] = item.transform as number[];
				const x = e / vp.width;
				const y = 1 - (f + Math.abs(d)) / vp.height;
				const w = (item.width || Math.abs(a) * item.str.length) / vp.width;
				const h = Math.abs(d || b) / vp.height;
				rects.push({ page: i, x, y, w, h, text: item.str });
			}
			index.push(rects);
		}
		searchIndex = index;
	}

	let kbTimer: ReturnType<typeof setTimeout>;
	function runSearch() {
		clearTimeout(kbTimer);
		pageHits = [];
		if (!query.trim()) { searchHits = []; return; }
		const q = query.toLowerCase();
		const hits: typeof searchHits = [];
		for (let pi = 0; pi < searchIndex.length; pi++) {
			for (let ri = 0; ri < searchIndex[pi].length; ri++) {
				if (searchIndex[pi][ri].text.toLowerCase().includes(q)) {
					const { x, y, w, h } = searchIndex[pi][ri];
					hits.push({ page: pi, idx: ri, x, y, w, h });
				}
			}
		}
		searchHits = hits;
		searchCursor = 0;
		if (hits.length) { scrollToHit(0); return; }
		// Nothing in the embedded text layer (scanned/OCR PDF) → ask the KB.
		if (query.trim().length >= 2) kbTimer = setTimeout(() => void kbFallback(query.trim()), 200);
	}

	// Page-level OCR search via the KB. Hits carry their source page (added to the
	// index pipeline), so we can jump even though the viewer has no text to match.
	async function kbFallback(q: string) {
		if (!filename) return;
		const hits = await kbSearchHits(currentCanvasId() || 'default', q, 12);
		if (query.trim() !== q) return; // stale
		// Rows indexed before the page-tracking migration carry no `page` — still
		// surface them (best-effort jump to page 1) instead of dropping the match.
		const pages = [...new Set(
			hits.filter((h) => h.source === filename).map((h) => h.page ?? 1)
		)].sort((a, b) => a - b);
		pageHits = pages;
		pageCursor = 0;
		if (pages.length) scrollToPage(pages[0]);
	}

	function scrollToHit(idx: number) {
		if (!searchHits.length || !pagesEl) return;
		const hit = searchHits[idx];
		const wrap = pagesEl.querySelector(`[data-page="${hit.page}"]`);
		wrap?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	// 1-based page → 0-based [data-page] anchor.
	function scrollToPage(page: number) {
		pagesEl?.querySelector(`[data-page="${page - 1}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function prevHit() {
		if (pageHits.length) { pageCursor = (pageCursor - 1 + pageHits.length) % pageHits.length; scrollToPage(pageHits[pageCursor]); return; }
		searchCursor = (searchCursor - 1 + searchHits.length) % searchHits.length; scrollToHit(searchCursor);
	}
	function nextHit() {
		if (pageHits.length) { pageCursor = (pageCursor + 1) % pageHits.length; scrollToPage(pageHits[pageCursor]); return; }
		searchCursor = (searchCursor + 1) % searchHits.length; scrollToHit(searchCursor);
	}

	// Deep-link from global search. Once the index is built: run the query, and if the
	// embedded text layer yields nothing (scanned/OCR PDF) fall back to the KB-provided
	// page. `data-page` is 0-based; initialPage is the 1-based source page.
	let appliedInitial = '';
	$effect(() => {
		if (!searchIndex.length || (!initialQuery && !initialPage)) return;
		const key = `${initialQuery}|${initialPage}`;
		if (key === appliedInitial) return;
		appliedInitial = key;
		if (initialQuery) { query = initialQuery; runSearch(); }
		if (!searchHits.length && initialPage) {
			pagesEl?.querySelector(`[data-page="${initialPage - 1}"]`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	});

	// ── Fit/zoom effects ────────────────────────────────────────────────────────
	let renderTimer: ReturnType<typeof setTimeout>;
	$effect(() => {
		// Re-render when fit/zoom changes (containerW/H tracked via ResizeObserver)
		fitMode; zoomFactor; containerW; containerH;
		if (!pdfDoc || !pagesEl) return;
		clearTimeout(renderTimer);
		renderTimer = setTimeout(async () => {
			const pdfjs = await import('pdfjs-dist');
			pdfjs.GlobalWorkerOptions.workerSrc = (
				await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
			).default;
			await renderAll(pdfjs, pdfDoc!);
		}, 60);
	});

	// Initial load
	$effect(() => {
		if (blob && pagesEl) loadAndRender();
	});

	// ResizeObserver on the container
	$effect(() => {
		if (!pagesEl) return;
		const ro = new ResizeObserver((entries) => {
			const e = entries[0];
			containerW = e.contentRect.width;
			containerH = e.contentRect.height;
		});
		ro.observe(pagesEl);
		return () => ro.disconnect();
	});

	// IntersectionObserver for page counter
	$effect(() => {
		if (!pagesEl || !pages.length) return;
		const io = new IntersectionObserver((entries) => {
			let best = 0, bestRatio = 0;
			for (const e of entries) {
				if (e.intersectionRatio > bestRatio) { bestRatio = e.intersectionRatio; best = Number((e.target as HTMLElement).dataset.page ?? 0); }
			}
			if (bestRatio > 0) currentPage = best + 1;
		}, { root: pagesEl, threshold: [0, 0.25, 0.5, 0.75, 1] });
		for (const el of pagesEl.querySelectorAll('[data-page]')) io.observe(el);
		return () => io.disconnect();
	});

	// ── Highlighting ────────────────────────────────────────────────────────────
	function onPdfMouseUp() {
		const sel = window.getSelection();
		const txt = sel?.toString().trim() ?? '';

		// Selection popup for send-to-chat (always, regardless of tool)
		if (txt) {
			selectionText = txt;
			const r = sel!.getRangeAt(0).getBoundingClientRect();
			// Position popup above the selection, relative to viewport
			selPopup = { x: r.left + r.width / 2, y: r.top - 8 };
		} else {
			selPopup = null;
		}

		if (tool !== 'highlight' || !sel || sel.isCollapsed || !pagesEl) return;

		const rects = sel.getRangeAt(0).getClientRects();
		const added: PdfHL[] = [];
		for (const r of rects) {
			if (r.width < 2 || r.height < 2) continue;
			const cx = r.left + r.width / 2;
			const cy = r.top + r.height / 2;
			const wrap = [...pagesEl.querySelectorAll('[data-page]')].find((p) => {
				const b = p.getBoundingClientRect();
				return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom;
			}) as HTMLElement | undefined;
			if (!wrap) continue;
			const b = wrap.getBoundingClientRect();
			added.push({
				page: Number(wrap.dataset.page),
				x: (r.left - b.left) / b.width,
				y: (r.top  - b.top ) / b.height,
				w: r.width  / b.width,
				h: r.height / b.height,
				color: activeColor,
				text: txt,
			});
		}
		if (added.length) {
			highlights = [...highlights, ...added];
			setFileHighlights(fileId, highlights);
			sel.removeAllRanges();
			selPopup = null;
		}
	}

	function removeHighlight(idx: number) {
		if (tool !== 'highlight') return;
		highlights = highlights.filter((_, i) => i !== idx);
		setFileHighlights(fileId, highlights);
	}

	function clearHighlights() {
		highlights = [];
		setFileHighlights(fileId, highlights);
	}

	// ── Send-to-chat ────────────────────────────────────────────────────────────
	function sendToChat(text: string) {
		const node = flow.nodes.find((n) => n.id === fileId);
		const pos = node?.position ?? { x: 400, y: 300 };
		window.dispatchEvent(new CustomEvent('arbor:branch', {
			detail: { x: pos.x + 480, y: pos.y, parentId: fileId, quote: text }
		}));
		window.getSelection()?.removeAllRanges();
		selPopup = null;
	}

	// ── Jump to page ────────────────────────────────────────────────────────────
	function jumpToPage() {
		const n = parseInt(jumpValue);
		if (!isNaN(n) && n >= 1 && n <= totalPages && pagesEl) {
			const wrap = pagesEl.querySelector(`[data-page="${n - 1}"]`);
			wrap?.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}
		jumping = false;
		jumpValue = '';
	}

	// ── Zoom helpers ────────────────────────────────────────────────────────────
	function zoomIn()  { zoomFactor = Math.min(4, parseFloat((zoomFactor + 0.25).toFixed(2))); }
	function zoomOut() { zoomFactor = Math.max(0.25, parseFloat((zoomFactor - 0.25).toFixed(2))); }
	function zoomPct() { return `${Math.round(zoomFactor * 100)}%`; }

	// ── Cmd/Ctrl+F → focus in-PDF search ────────────────────────────────────────
	let searchEl = $state<HTMLInputElement>();

	$effect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				searchEl?.focus();
				searchEl?.select();
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="viewer">
	<!-- Toolbar -->
	<div class="toolbar">
		<!-- Zoom -->
		<div class="tool-group">
			<button onclick={zoomOut} title="Zoom out" aria-label="Zoom out">−</button>
			<span class="zoom-label">{zoomPct()}</span>
			<button onclick={zoomIn} title="Zoom in" aria-label="Zoom in">+</button>
		</div>

		<div class="divider"></div>

		<!-- Fit modes -->
		<div class="tool-group">
			<button class:active={fitMode === 'width'}  onclick={() => { fitMode = 'width';  zoomFactor = 1; }} title="Fit width">⇔</button>
			<button class:active={fitMode === 'page'}   onclick={() => { fitMode = 'page';   zoomFactor = 1; }} title="Fit page">⛶</button>
			<button class:active={fitMode === 'actual'} onclick={() => { fitMode = 'actual'; zoomFactor = 1; }} title="Actual size (100%)">1:1</button>
		</div>

		<div class="divider"></div>

		<!-- Page nav -->
		<div class="tool-group">
			<button onclick={() => { const w = pagesEl?.querySelector(`[data-page="${currentPage - 2}"]`); w?.scrollIntoView({ behavior: 'smooth' }); }} disabled={currentPage <= 1} aria-label="Previous page">‹</button>
			{#if jumping}
				<!-- svelte-ignore a11y_autofocus -->
				<input
					class="jump-input"
					type="number"
					min="1"
					max={totalPages}
					bind:value={jumpValue}
					onblur={jumpToPage}
					onkeydown={(e) => { if (e.key === 'Enter') jumpToPage(); if (e.key === 'Escape') { jumping = false; jumpValue = ''; } }}
					autofocus
				/>
			{:else}
				<button class="page-counter" onclick={() => { jumping = true; jumpValue = String(currentPage); }} title="Click to jump to page">
					{currentPage} / {totalPages}
				</button>
			{/if}
			<button onclick={() => { const w = pagesEl?.querySelector(`[data-page="${currentPage}"]`); w?.scrollIntoView({ behavior: 'smooth' }); }} disabled={currentPage >= totalPages} aria-label="Next page">›</button>
		</div>

		<div class="divider"></div>

		<!-- Highlight tool toggle -->
		<div class="tool-group">
			<button
				class:active={tool === 'highlight'}
				onclick={() => (tool = tool === 'highlight' ? 'pan' : 'highlight')}
				title="Highlight tool (H)"
				aria-label="Highlight tool"
			>🖊</button>
			{#if tool === 'highlight'}
				<div class="colors">
					{#each COLORS as c}
						<button
							class="color-swatch"
							class:selected={activeColor === c.value}
							style="background: {c.value}; border-color: {activeColor === c.value ? '#000' : 'transparent'}"
							onclick={() => (activeColor = c.value)}
							title={c.label}
							aria-label={c.label}
						></button>
					{/each}
				</div>
			{/if}
		</div>

		<div class="divider"></div>

		<!-- Search -->
		<div class="tool-group search-group">
			<input
				class="search-input"
				type="search"
				placeholder="Find…"
				bind:this={searchEl}
				bind:value={query}
				oninput={runSearch}
				onkeydown={(e) => { if (e.key === 'Enter') { e.shiftKey ? prevHit() : nextHit(); } if (e.key === 'Escape') { query = ''; searchHits = []; pageHits = []; } }}
			/>
			{#if searchHits.length}
				<span class="search-count">{searchCursor + 1}/{searchHits.length}</span>
				<button onclick={prevHit} aria-label="Previous match">‹</button>
				<button onclick={nextHit} aria-label="Next match">›</button>
			{:else if pageHits.length}
				<span class="search-count" title="Page matches from OCR text">pg {pageCursor + 1}/{pageHits.length}</span>
				<button onclick={prevHit} aria-label="Previous page match">‹</button>
				<button onclick={nextHit} aria-label="Next page match">›</button>
			{/if}
		</div>

		{#if highlights.length}
			<div class="divider"></div>
			<button class="clear-btn" onclick={clearHighlights}>Clear marks</button>
		{/if}
	</div>

	<!-- Pages -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="pages"
		class:highlight-mode={tool === 'highlight'}
		bind:this={pagesEl}
		onmouseup={onPdfMouseUp}
	>
		{#each pages as p (p)}
			<div class="page" data-page={p}>
				<canvas></canvas>
				<div class="textlayer"></div>
				<!-- Persistent highlights -->
				{#each highlights.filter((h) => h.page === p) as h, i}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div
						class="hl"
						style="left:{h.x*100}%;top:{h.y*100}%;width:{h.w*100}%;height:{h.h*100}%;background:{h.color}"
						onclick={() => removeHighlight(highlights.indexOf(h))}
						title={tool === 'highlight' ? 'Click to remove' : undefined}
					></div>
				{/each}
				<!-- Search hits -->
				{#each searchHits.filter((h) => h.page === p) as hit, si}
					<div
						class="search-hit"
						class:active-hit={searchHits[searchCursor]?.page === p && searchHits[searchCursor]?.idx === hit.idx}
						style="left:{hit.x*100}%;top:{hit.y*100}%;width:{hit.w*100}%;height:{hit.h*100}%"
					></div>
				{/each}
			</div>
		{/each}
		{#if !pages.length}
			<div class="empty">Rendering PDF…</div>
		{/if}
	</div>

	<!-- Send-to-chat popup (appears above selection) -->
	{#if selPopup}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="sel-popup"
			style="left:{selPopup.x}px;top:{selPopup.y}px"
			onmousedown={(e) => e.preventDefault()}
		>
			<button onclick={() => sendToChat(selectionText)}>↗ Send to chat</button>
		</div>
	{/if}
</div>

<style>
	.viewer {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	/* ── Toolbar ── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border-bottom: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #f8f8f8);
		flex: none;
		flex-wrap: wrap;
		min-height: 36px;
	}
	.tool-group {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	.divider {
		width: 1px;
		height: 20px;
		background: var(--c-hairline);
		margin: 0 4px;
		flex: none;
	}
	.toolbar button {
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 6px;
		padding: 3px 7px;
		font-size: 12px;
		cursor: pointer;
		line-height: 1.4;
		color: var(--c-ink);
	}
	.toolbar button:disabled { opacity: 0.35; cursor: default; }
	.toolbar button.active {
		background: var(--c-primary, #3b82f6);
		color: var(--c-on-primary, #fff);
		border-color: transparent;
	}
	.toolbar button:hover:not(:disabled):not(.active) {
		background: var(--c-canvas);
	}
	.zoom-label {
		font-size: 12px;
		min-width: 38px;
		text-align: center;
		color: var(--c-ink);
		user-select: none;
	}
	.page-counter {
		font-variant-numeric: tabular-nums;
		min-width: 56px;
		text-align: center;
	}
	.jump-input {
		width: 56px;
		border: 1px solid var(--c-hairline);
		border-radius: 6px;
		padding: 3px 6px;
		font-size: 12px;
		text-align: center;
		background: var(--c-canvas);
		color: var(--c-ink);
	}
	.jump-input::-webkit-inner-spin-button { display: none; }

	/* Highlight colors */
	.colors {
		display: flex;
		gap: 3px;
		margin-left: 4px;
	}
	.color-swatch {
		width: 18px !important;
		height: 18px !important;
		padding: 0 !important;
		border-radius: 50% !important;
		border: 2px solid transparent !important;
		cursor: pointer;
	}
	.color-swatch.selected {
		border-color: var(--c-ink) !important;
		box-shadow: 0 0 0 1px rgba(0,0,0,0.2);
	}

	/* Search */
	.search-group { gap: 3px; }
	.search-input {
		height: 26px;
		border: 1px solid var(--c-hairline);
		border-radius: 6px;
		padding: 0 8px;
		font-size: 12px;
		width: 120px;
		background: var(--c-canvas);
		color: var(--c-ink);
	}
	.search-count {
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.55);
		font-variant-numeric: tabular-nums;
		padding: 0 2px;
	}
	.clear-btn { color: rgba(var(--ink-rgb), 0.7) !important; }

	/* ── Pages scroll area ── */
	.pages {
		flex: 1;
		overflow: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		background: #525659;
		user-select: text;
		-webkit-user-select: text;
	}
	.pages.highlight-mode { cursor: text; }

	.page {
		position: relative;
		background: #fff;
		box-shadow: 0 2px 12px rgba(0,0,0,0.4);
		flex: none;
	}
	.page canvas { display: block; pointer-events: none; }

	.textlayer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		line-height: 1;
		opacity: 0.25;
	}
	.textlayer :global(span) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0 0;
	}
	.textlayer :global(::selection) {
		background: rgba(255,222,89,0.6);
	}

	/* Persistent highlight overlay */
	.hl {
		position: absolute;
		pointer-events: none;
		mix-blend-mode: multiply;
	}
	.highlight-mode .hl {
		pointer-events: auto;
		cursor: pointer;
	}
	.highlight-mode .hl:hover {
		outline: 2px solid rgba(0,0,0,0.35);
		outline-offset: 1px;
	}

	/* Search hit overlay */
	.search-hit {
		position: absolute;
		background: rgba(59,130,246,0.30);
		pointer-events: none;
		mix-blend-mode: multiply;
	}
	.search-hit.active-hit {
		background: rgba(249,115,22,0.45);
	}

	.empty {
		color: rgba(255,255,255,0.6);
		font-size: 13px;
		margin-top: 40px;
	}

	/* Send-to-chat popup */
	.sel-popup {
		position: fixed;
		transform: translate(-50%, -100%);
		z-index: 999;
		margin-top: -4px;
	}
	.sel-popup button {
		background: var(--c-primary, #3b82f6);
		color: var(--c-on-primary, #fff);
		border: none;
		border-radius: 8px;
		padding: 5px 12px;
		font-size: 12px;
		cursor: pointer;
		white-space: nowrap;
		box-shadow: 0 2px 8px rgba(0,0,0,0.3);
	}
</style>
