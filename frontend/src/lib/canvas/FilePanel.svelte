<script lang="ts">
	// Right side-split pane: open a file card into a full viewer/editor.
	//  - PDF  → pdf.js render + text layer, drag-select to highlight (view + highlight only)
	//  - md/text/docx → contenteditable rich edit (bold/italic/underline)
	//  - text node → MarkdownBody view with highlights + textarea edit toggle
	// Markdown/text edits save back to disk on desktop; docx is in-app only.
	import { tick } from 'svelte';
	import { slide } from 'svelte/transition';
	import { flow, setFilePreview, setCardText, type FileData, type TextData } from './store.svelte';
	import { getFileBlob, canUseFs, readFile, writeFile, openPath } from '$lib/files';
	import { renderMarkdown } from '$lib/markdown';
	import { loadHL, saveHL } from './highlights';
	import MarkdownBody from './MarkdownBody.svelte';
	import { resizable } from '$lib/actions/resizable';

	let { fileId, onclose }: { fileId: string; onclose: () => void } = $props();

	const node = $derived(flow.nodes.find((n) => n.id === fileId));
	const isText = $derived(node?.type === 'text');
	const textData = $derived(isText ? (node?.data as TextData) : undefined);
	const file = $derived(isText ? undefined : (node?.data as FileData | undefined));
	const blob = $derived(isText ? undefined : getFileBlob(fileId));
	const panelTitle = $derived(
		isText
			? (textData?.text?.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Note')
			: (file?.filename ?? 'File')
	);

	let width = $state(Math.min(720, Math.round(window.innerWidth * 0.5)));
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');

	// ── Text note: view ↔ edit toggle + persisted highlights ──────────────────
	// Panel opens in view mode (rendered markdown + highlights), matching the
	// old TextView modal. "Edit ✎" switches to the raw textarea.
	let textEditing = $state(false);
	let noteHL = $state<string[]>([]);
	$effect(() => { noteHL = loadHL<string>(`arbor.highlights.${fileId}`); });

	function saveNoteHL(updated: string[]) {
		noteHL = updated;
		saveHL(`arbor.highlights.${fileId}`, updated);
	}

	function clearNoteHL() {
		noteHL = [];
		saveHL(`arbor.highlights.${fileId}`, []);
	}


	// ── Rich text edit (markdown / text / docx) ─────────────────────────────────
	let editor = $state<HTMLDivElement>();
	const editable = $derived(file?.kind === 'markdown' || file?.kind === 'text' || file?.kind === 'docx');

	async function initEditor(el: HTMLDivElement) {
		if (!file) return;
		if (file.kind === 'docx') {
			if (blob) {
				const mammoth = await import('mammoth');
				const { value } = await mammoth.convertToHtml({ arrayBuffer: blob.bytes });
				el.innerHTML = value;
			} else {
				el.innerHTML = file.preview ?? '';
			}
		} else {
			// markdown/text: prefer disk (freshest), fall back to dropped bytes
			let text = '';
			if (file.path && canUseFs()) {
				try {
					text = await readFile(file.path);
				} catch {
					/* fall through to blob */
				}
			}
			if (!text && blob) text = new TextDecoder().decode(blob.bytes);
			el.innerHTML = file.kind === 'markdown' ? renderMarkdown(text) : `<pre>${escapeHtml(text)}</pre>`;
		}
	}

	function escapeHtml(s: string): string {
		return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
	}

	function exec(cmd: 'bold' | 'italic' | 'underline') {
		editor?.focus();
		document.execCommand(cmd); // ponytail: deprecated but adequate for B/I/U; swap for a real editor only if rich features grow
	}

	// Save markdown/text back to disk. docx has no in-app writer (Open file instead).
	async function save() {
		if (!file || !editor) return;
		if (file.kind === 'docx') return;
		const text = editor.innerText; // contenteditable → plain text (md is text)
		setFilePreview(fileId, text.slice(0, 4000));
		if (!file.path || !canUseFs()) {
			saveState = 'error'; // no path (browser dev) → can't persist to disk
			return;
		}
		saveState = 'saving';
		try {
			await writeFile(file.path, text);
			saveState = 'saved';
		} catch {
			saveState = 'error';
		}
	}

	// ── PDF render + highlight ───────────────────────────────────────────────────
	interface HL {
		page: number;
		x: number;
		y: number;
		w: number;
		h: number;
	}
	let pages = $state<number[]>([]);
	let highlights = $state<HL[]>([]);
	$effect(() => { if (!isText) highlights = loadHL<HL>(`arbor.highlights.${fileId}`); });
	let pagesEl = $state<HTMLDivElement>();

	function saveHighlights() {
		saveHL(`arbor.highlights.${fileId}`, highlights);
	}

	async function renderPdf(container: HTMLDivElement) {
		if (!blob) return;
		const pdfjs = await import('pdfjs-dist');
		pdfjs.GlobalWorkerOptions.workerSrc = (
			await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
		).default;
		const doc = await pdfjs.getDocument({ data: blob.bytes.slice(0) }).promise;
		pages = Array.from({ length: doc.numPages }, (_, i) => i);
		await tick(); // wait for Svelte to render page divs before querying them
		for (let i = 0; i < doc.numPages; i++) {
			const page = await doc.getPage(i + 1);
			const viewport = page.getViewport({ scale: 1.4 });
			const wrap = container.querySelector(`[data-page="${i}"]`) as HTMLElement | null;
			if (!wrap) continue;
			wrap.style.width = `${viewport.width}px`;
			wrap.style.height = `${viewport.height}px`;
			const canvas = wrap.querySelector('canvas') as HTMLCanvasElement;
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			await page.render({ canvas, canvasContext: canvas.getContext('2d')!, viewport }).promise;
			const textDiv = wrap.querySelector('.textlayer') as HTMLElement;
			const tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
			await tl.render();
		}
	}

	// Drag-select inside the PDF → store normalized highlight rects per page.
	function onPdfMouseUp() {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed || !pagesEl) return;
		const rects = sel.getRangeAt(0).getClientRects();
		const added: HL[] = [];
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
				y: (r.top - b.top) / b.height,
				w: r.width / b.width,
				h: r.height / b.height
			});
		}
		if (added.length) {
			highlights = [...highlights, ...added];
			saveHighlights();
			sel.removeAllRanges();
		}
	}

	function clearHighlights() {
		highlights = [];
		saveHighlights();
	}

	async function openInOs() {
		if (file?.path && canUseFs()) await openPath(file.path);
	}

	// Mount the right renderer once the DOM node exists.
	$effect(() => {
		if (file?.kind === 'pdf' && pagesEl) renderPdf(pagesEl);
	});
	$effect(() => {
		if (editable && editor) initEditor(editor);
	});
</script>

<aside class="panel" style="width: {width}px" transition:slide={{ axis: 'x', duration: 220 }}>
	<div class="grip" use:resizable={{ min: 360, max: () => window.innerWidth - 120, getWidth: () => width, onwidth: (w) => (width = w) }} role="separator" aria-label="Resize" tabindex="-1"></div>
	<header>
		<span class="title" title={panelTitle}>{panelTitle}</span>
		<div class="actions">
			{#if isText}
				<button onclick={() => (textEditing = !textEditing)}>
					{textEditing ? 'Preview' : 'Edit ✎'}
				</button>
				{#if !textEditing && noteHL.length}
					<button onclick={clearNoteHL}>Clear marks</button>
				{/if}
			{:else}
				{#if editable && file?.kind !== 'docx'}
					<button onclick={save} class="save">
						{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Save (desktop)' : 'Save'}
					</button>
				{/if}
				{#if file?.kind === 'pdf' && highlights.length}
					<button onclick={clearHighlights}>Clear marks</button>
				{/if}
				<button onclick={openInOs} disabled={!file?.path || !canUseFs()} title={file?.path ? 'Open in default app' : 'Desktop only'}>Open file ↗</button>
			{/if}
			<button onclick={onclose} aria-label="Close">✕</button>
		</div>
	</header>

	{#if isText}
		{#if textEditing}
			<div class="text-editor-hint">Markdown — renders live on the card</div>
			<textarea
				class="text-editor"
				value={textData?.text ?? ''}
				oninput={(e) => setCardText(fileId, (e.target as HTMLTextAreaElement).value)}
				placeholder="Write your note in markdown…"
				spellcheck="false"
			></textarea>
		{:else}
			{#if !textData?.text?.trim()}
				<div class="empty">Empty note — click <strong>Edit ✎</strong> to add content.</div>
			{:else}
				<div class="note-hint">Select text to highlight</div>
				<MarkdownBody
					text={textData?.text ?? ''}
					bind:highlights={noteHL}
					onhighlight={saveNoteHL}
				/>
			{/if}
		{/if}
	{:else if !blob && file?.kind !== 'markdown'}
		<div class="empty">File bytes not loaded — re-drop "{file?.filename}" to view. (Bytes aren't persisted across reloads.)</div>
	{:else if file?.kind === 'pdf'}
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="pages" bind:this={pagesEl} onmouseup={onPdfMouseUp}>
			{#each pages as p (p)}
				<div class="page" data-page={p}>
					<canvas></canvas>
					<div class="textlayer"></div>
					{#each highlights.filter((h) => h.page === p) as h, i (i)}
						<div class="hl" style="left:{h.x * 100}%;top:{h.y * 100}%;width:{h.w * 100}%;height:{h.h * 100}%"></div>
					{/each}
				</div>
			{/each}
			{#if !pages.length}<div class="empty">Rendering PDF…</div>{/if}
		</div>
	{:else if editable}
		<div class="toolbar">
			<button onclick={() => exec('bold')}><b>B</b></button>
			<button onclick={() => exec('italic')}><i>I</i></button>
			<button onclick={() => exec('underline')}><u>U</u></button>
			{#if file?.kind === 'docx'}<span class="note">docx — edits in-app only; use "Open file" to edit on disk</span>{/if}
		</div>
		<div class="editor" bind:this={editor} contenteditable="true"></div>
	{:else if file?.kind === 'image'}
		<div class="imgwrap">
			{#if blob}<img src={URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime }))} alt={file.filename} />{/if}
		</div>
	{:else}
		<div class="empty">No preview for this file type. Use "Open file".</div>
	{/if}
</aside>

<style>
	.panel {
		position: relative;
		flex: none;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--c-canvas);
		border-left: 1px solid var(--c-hairline);
		overflow: hidden;
	}
	.grip {
		position: absolute;
		left: -3px;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
		z-index: 2;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--s-sm);
		padding: var(--s-sm) var(--s-md);
		border-bottom: 1px solid var(--c-hairline);
	}
	.title {
		font-weight: 600;
		font-size: 13px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.actions {
		display: flex;
		gap: 6px;
		flex: none;
	}
	.actions button {
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 8px;
		padding: 4px 8px;
		font-size: 12px;
		cursor: pointer;
	}
	.actions button:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.save {
		background: var(--c-primary) !important;
		color: var(--c-on-primary);
		border-color: transparent !important;
	}
	.pages {
		flex: 1;
		overflow: auto;
		padding: var(--s-md);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--s-md);
		background: #525659;
	}
	.page {
		position: relative;
		background: #fff;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
	}
	.page canvas {
		display: block;
	}
	.textlayer {
		position: absolute;
		inset: 0;
		overflow: hidden;
		line-height: 1;
		opacity: 0.25;
	}
	/* pdf.js text-layer spans are absolutely positioned; keep them selectable + invisible-ish */
	.textlayer :global(span) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0 0;
	}
	.textlayer :global(::selection) {
		background: rgba(255, 222, 89, 0.6);
	}
	.hl {
		position: absolute;
		background: rgba(255, 222, 89, 0.45);
		pointer-events: none;
		mix-blend-mode: multiply;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px var(--s-md);
		border-bottom: 1px solid var(--c-hairline);
	}
	.toolbar button {
		width: 30px;
		height: 28px;
		border: 1px solid var(--c-hairline);
		background: var(--c-canvas);
		border-radius: 6px;
		cursor: pointer;
	}
	.toolbar .note {
		margin-left: auto;
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.45);
	}
	.editor {
		flex: 1;
		overflow: auto;
		padding: var(--s-lg) var(--s-xl);
		font-size: 15px;
		line-height: 1.6;
		outline: none;
	}
	.editor :global(pre) {
		white-space: pre-wrap;
		word-break: break-word;
		font-family: var(--font-mono);
		font-size: 13px;
	}
	.imgwrap {
		flex: 1;
		overflow: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--s-md);
		background: #2b2b2b;
	}
	.imgwrap img {
		max-width: 100%;
		height: auto;
	}
	.empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: var(--s-xl);
		font-size: 13px;
		color: rgba(var(--ink-rgb), 0.5);
	}
	.note-hint {
		padding: 4px var(--s-md);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.4);
		border-bottom: 1px solid var(--c-hairline);
		flex: none;
	}
	.text-editor-hint {
		padding: 4px var(--s-md);
		font-size: 11px;
		color: rgba(var(--ink-rgb), 0.4);
		border-bottom: 1px solid var(--c-hairline);
		flex: none;
	}
	.text-editor {
		flex: 1;
		width: 100%;
		border: none;
		outline: none;
		resize: none;
		padding: var(--s-lg) var(--s-xl);
		font-family: var(--font-mono);
		font-size: 13px;
		line-height: 1.6;
		background: transparent;
		color: var(--c-ink);
		box-sizing: border-box;
	}
	.text-editor::placeholder {
		color: rgba(var(--ink-rgb), 0.3);
	}
</style>
