<script lang="ts">
	// Right side-split pane: open a file card into a full viewer/editor.
	//  - PDF  → pdf.js render + text layer, drag-select to highlight (view + highlight only)
	//  - md/text/docx → contenteditable rich edit (bold/italic/underline)
	//  - text node → MarkdownBody view with highlights + textarea edit toggle
	// Markdown/text edits save back to disk on desktop; docx is in-app only.
	import { splitSwoopIn } from '$lib/theme/animations';
	import { flow, setFilePreview, setCardText, type FileData, type TextData } from './store.svelte';
	import { isJobRunning, runMindmap, runStudy } from './studio-jobs.svelte';
	import { getFileBlob, hydrateFileBlobs, canUseFs, readFile, writeFile, openPath } from '$lib/files';
	import { renderMarkdown } from '$lib/markdown';
	import { loadHL, saveHL } from './highlights';
	import MarkdownBody from './MarkdownBody.svelte';
	import PdfViewer from './PdfViewer.svelte';
	import FindBar from './FindBar.svelte';
	import { isDocxFile, isEditableFile, isImageFile, isMarkdownFile, isPdfFile } from './kinds';
	import { resizable } from '$lib/actions/resizable';
	import { createPaneController, type PaneController } from './pane-controller.svelte';
	import { Pencil, ExternalLink, Brain, Layers, X, Bold, Italic, Underline } from '@lucide/svelte';

	let {
		fileId,
		onclose,
		initialQuery = '',
		initialPage = 0,
		hideToolbar = false,
		fill = false,
		focused = false,
		growAnim = false,
		onfocuspane,
		controller = $bindable<PaneController | undefined>(undefined),
		dirty = $bindable(false),
		saveNow = $bindable<(() => Promise<void>) | undefined>(undefined),
	}: {
		fileId: string;
		onclose: () => void;
		initialQuery?: string;
		initialPage?: number;
		hideToolbar?: boolean;
		fill?: boolean;
		focused?: boolean;
		growAnim?: boolean;
		onfocuspane?: () => void;
		controller?: PaneController;
		dirty?: boolean;
		saveNow?: () => Promise<void>;
	} = $props();

	// Per-pane control facade — PdfViewer / the rich-text editor publish into it so
	// the SplitFileView top toolbar (FileToolbar) can drive this pane when focused.
	controller ??= createPaneController();
	saveNow = () => save();

	// Primary pane only (growAnim): one-shot "grow to fill" / "restore" settle whenever
	// the pane enters or leaves split (fill toggles). Skips the initial mount so a plain
	// file open just uses its slide-in transition.
	let settling = $state(false);
	let fillSeen = false;
	$effect(() => {
		fill; // track
		if (!growAnim) return;
		if (!fillSeen) {
			fillSeen = true;
			return;
		}
		settling = true;
		const t = setTimeout(() => (settling = false), 340);
		return () => clearTimeout(t);
	});

	// Mind map / study: delegate to the module-level runner so the job survives this
	// panel closing — it runs to success (dispatches to canvas) or failure (toast),
	// never cancelled by unmount. Buttons read the shared running state.
	const mapping = $derived(isJobRunning('mindmap', fileId));
	const studying = $derived(isJobRunning('study', fileId));
	function makeMindmap() {
		if (mapping || !file) return;
		runMindmap(fileId, file.filename);
	}
	function makeStudy() {
		if (studying || !file) return;
		runStudy(fileId, file.filename);
	}

	const node = $derived(flow.nodes.find((n) => n.id === fileId));
	const isText = $derived(node?.type === 'text');
	const textData = $derived(isText ? (node?.data as TextData) : undefined);
	const file = $derived(isText ? undefined : (node?.data as FileData | undefined));
	const blob = $derived(isText ? undefined : getFileBlob(fileId));
	// Bytes are fetched on open, not held for every card (see files.ts LRU).
	let blobLoading = $state(false);
	$effect(() => {
		if (isText || blob) return;
		blobLoading = true;
		void hydrateFileBlobs([fileId]).finally(() => (blobLoading = false));
	});
	const panelTitle = $derived(
		isText
			? (textData?.text?.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Note')
			: (file?.filename ?? 'File')
	);

	let width = $state(Math.min(720, Math.round(window.innerWidth * 0.5)));
	let saveState = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
	let contentEl = $state<HTMLDivElement>();

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
	const editable = $derived(isEditableFile(file));

	async function initEditor(el: HTMLDivElement) {
		if (!file) return;
		if (isDocxFile(file)) {
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
			el.innerHTML = isMarkdownFile(file) ? renderMarkdown(text) : `<pre>${escapeHtml(text)}</pre>`;
		}
	}

	function escapeHtml(s: string): string {
		return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
	}

	function exec(cmd: 'bold' | 'italic' | 'underline') {
		editor?.focus();
		document.execCommand(cmd); // ponytail: deprecated but adequate for B/I/U; swap for a real editor only if rich features grow
		dirty = true;
	}

	// Save markdown/text back to disk. docx has no in-app writer (Open file instead).
	async function save() {
		if (!file || !editor) return;
		if (isDocxFile(file)) { dirty = false; return; }
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
			dirty = false;
		} catch {
			saveState = 'error';
		}
	}

	// Publish rich-text controls to the pane controller for the split-mode toolbar.
	// PDFs are handled inside PdfViewer; images/other panes stay 'none'.
	$effect(() => {
		if (!controller || isPdfFile(file)) return;
		if (editable) {
			controller.kind = 'text';
			controller.bold = () => exec('bold');
			controller.italic = () => exec('italic');
			controller.underline = () => exec('underline');
		} else {
			controller.kind = 'none';
		}
	});

	async function openInOs() {
		if (file?.path && canUseFs()) await openPath(file.path);
	}

	$effect(() => {
		if (editable && editor) initEditor(editor);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<aside
	class="panel"
	class:fill
	class:focused
	class:grow={settling}
	style={fill ? '' : `width: ${width}px`}
	transition:splitSwoopIn
	onpointerdown={() => onfocuspane?.()}
	onmouseenter={() => fill && onfocuspane?.()}
>
	{#if !fill}
		<div class="grip" use:resizable={{ min: 360, max: () => window.innerWidth - 120, getWidth: () => width, onwidth: (w) => (width = w) }} role="separator" aria-label="Resize" tabindex="-1"></div>
	{/if}
	<header>
		<span class="title" title={panelTitle}>{panelTitle}</span>
		<div class="actions">
			{#if isText}
				<button class="icon-label" onclick={() => (textEditing = !textEditing)}>
					{#if textEditing}Preview{:else}<Pencil size={13} /> Edit{/if}
				</button>
				{#if !textEditing && noteHL.length}
					<button onclick={clearNoteHL}>Clear marks</button>
				{/if}
			{:else}
				{#if editable && !isDocxFile(file)}
					<button onclick={save} class="save">
						{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Save (desktop)' : 'Save'}
					</button>
				{/if}
				<button class="icon-label" onclick={openInOs} disabled={!file?.path || !canUseFs()} title={file?.path ? 'Open in default app' : 'Desktop only'}><ExternalLink size={13} /> Open file</button>
			{/if}
			{#if !isText && file?.status === 'ready'}
				<button class="icon-label" onclick={makeMindmap} disabled={mapping} title="Generate a mind map from this document">
					<Brain size={13} /> {mapping ? 'Mapping…' : 'Map'}
				</button>
				<button class="icon-label" onclick={makeStudy} disabled={studying} title="Generate flashcards + quizzes from this document">
					<Layers size={13} /> {studying ? 'Studying…' : 'Study'}
				</button>
			{/if}
			<button class="icon-btn" onclick={onclose} aria-label="Close"><X size={15} /></button>
		</div>
	</header>

	{#if !isPdfFile(file)}
		<!-- ponytail: PDF has its own positional find (PdfViewer); FindBar for the rest.
		     CSS Highlight API can't reach textarea content, so edit-mode find is a gap. -->
		<FindBar target={contentEl ?? null} />
	{/if}

	<div class="content" bind:this={contentEl}>
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
				<div class="empty">Empty note — click <strong>Edit</strong> to add content.</div>
			{:else}
				<div class="note-hint">Select text to highlight</div>
				<MarkdownBody
					text={textData?.text ?? ''}
					bind:highlights={noteHL}
					onhighlight={saveNoteHL}
				/>
			{/if}
		{/if}
	{:else if !blob && !isMarkdownFile(file)}
		<div class="empty">
			{#if blobLoading}Loading "{file?.filename}"…{:else}File data not found — re-drop "{file?.filename}" to restore it.{/if}
		</div>
	{:else if isPdfFile(file)}
		<PdfViewer fileId={fileId} blob={blob} {initialQuery} {initialPage} {controller} {hideToolbar} />
	{:else if editable}
		<div class="toolbar">
			<button onclick={() => exec('bold')} aria-label="Bold"><Bold size={15} /></button>
			<button onclick={() => exec('italic')} aria-label="Italic"><Italic size={15} /></button>
			<button onclick={() => exec('underline')} aria-label="Underline"><Underline size={15} /></button>
			{#if isDocxFile(file)}<span class="note">docx — edits in-app only; use "Open file" to edit on disk</span>{/if}
		</div>
		<div class="editor" bind:this={editor} contenteditable="true" oninput={() => (dirty = true)}></div>
	{:else if isImageFile(file)}
		<div class="imgwrap">
			{#if blob}<img src={URL.createObjectURL(new Blob([blob.bytes], { type: blob.mime }))} alt={file?.filename} />{/if}
		</div>
	{:else}
		<div class="empty">No preview for this file type. Use "Open file".</div>
	{/if}
	</div>
</aside>

<style>
	.panel {
		position: relative;
		/* Above the 48px window-drag strip (+layout .titlebar-drag, z-index 30),
		   else the drag region eats clicks on the header buttons that sit in the
		   top band (Map/Study/split/close). */
		z-index: 40;
		flex: none;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: var(--c-canvas);
		border-left: 1px solid var(--c-hairline);
		overflow: hidden;
	}
	/* SplitFileView: each pane fills half the screen instead of a fixed side width.
	   flex (not fixed width) so an opened chat panel can shrink the panes responsively. */
	.panel.fill {
		flex: 1 1 0;
		min-width: 0;
	}
	/* Focused pane in split — dynamic accent ring so it's clear which pane the top
	   toolbar drives. Only meaningful in split (focused is gated there by Canvas). */
	.panel.focused {
		box-shadow: inset 0 0 0 2px var(--c-accent-magenta);
	}
	/* One-shot "grow to fill" / "restore" settle on the primary pane whenever it
	   enters or leaves split (driven by `settling`). The secondary pane animates via
	   its swoop-in mount transition instead. */
	.panel.grow {
		animation: pane-grow-in var(--spring-snappy);
	}
	@keyframes pane-grow-in {
		from {
			transform: scale(0.96);
			opacity: 0.55;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.panel.grow {
			animation: none;
		}
	}
	.content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
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
	.actions button.icon-label {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.actions button.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px 6px;
	}
	.save {
		background: var(--c-primary) !important;
		color: var(--c-on-primary);
		border-color: transparent !important;
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
