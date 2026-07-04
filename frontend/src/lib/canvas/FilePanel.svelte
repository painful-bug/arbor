<script lang="ts">
	// Right side-split pane: open a file card into a full viewer/editor.
	//  - PDF  → pdf.js render + text layer, drag-select to highlight (view + highlight only)
	//  - md/text/docx → contenteditable rich edit (bold/italic/underline)
	//  - text node → MarkdownBody view with highlights + textarea edit toggle
	// Markdown/text edits save back to disk on desktop; docx is in-app only.
	import { slide } from 'svelte/transition';
	import { flow, setFilePreview, setCardText, currentCanvasId, type FileData, type TextData } from './store.svelte';
	import { getFileBlob, hydrateFileBlobs, canUseFs, readFile, writeFile, openPath } from '$lib/files';
	import { renderMarkdown } from '$lib/markdown';
	import { loadHL, saveHL } from './highlights';
	import MarkdownBody from './MarkdownBody.svelte';
	import PdfViewer from './PdfViewer.svelte';
	import FindBar from './FindBar.svelte';
	import { isDocxFile, isEditableFile, isImageFile, isMarkdownFile, isPdfFile } from './kinds';
	import { resizable } from '$lib/actions/resizable';

	let { fileId, onclose, onSplit, initialQuery = '', initialPage = 0 }:
		{ fileId: string; onclose: () => void; onSplit?: (fileId: string) => void; initialQuery?: string; initialPage?: number } = $props();

	// Mind map: distill this file's indexed content into a tree of linked cards.
	let mapState = $state<'idle' | 'mapping'>('idle');
	let mapError = $state('');
	async function makeMindmap() {
		if (mapState === 'mapping' || !file) return;
		mapState = 'mapping';
		mapError = '';
		try {
			const { studioMindmap } = await import('$lib/ai/client');
			const nodes = await studioMindmap(currentCanvasId() || 'default', file.filename);
			window.dispatchEvent(new CustomEvent('arbor:mindmap', { detail: { parentId: fileId, nodes } }));
		} catch (err) {
			mapError = err instanceof Error ? err.message : 'Mind map failed';
		} finally {
			mapState = 'idle';
		}
	}

	// Study: generate flashcards + quizzes from this file's indexed content, then
	// open the review deck (StudyOverlay listens for arbor:study).
	let studyState = $state<'idle' | 'generating'>('idle');
	let studyError = $state('');
	async function makeStudy() {
		if (studyState === 'generating' || !file) return;
		studyState = 'generating';
		studyError = '';
		try {
			const { studioGenerate } = await import('$lib/ai/client');
			const items = await studioGenerate(currentCanvasId() || 'default', file.filename);
			window.dispatchEvent(new CustomEvent('arbor:study', { detail: { items } }));
		} catch (err) {
			studyError = err instanceof Error ? err.message : 'Study generation failed';
		} finally {
			studyState = 'idle';
		}
	}

	// Split-view picker: other openable nodes (files + text notes) to show beside this one.
	let splitMenu = $state(false);
	const splitTargets = $derived(
		onSplit
			? flow.nodes
					.filter((n) => (n.type === 'file' || n.type === 'text') && n.id !== fileId)
					.map((n) => ({
						id: n.id,
						label:
							n.type === 'text'
								? ((n.data as TextData).text?.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Note')
								: ((n.data as FileData).filename ?? 'File')
					}))
			: []
	);

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
	}

	// Save markdown/text back to disk. docx has no in-app writer (Open file instead).
	async function save() {
		if (!file || !editor) return;
		if (isDocxFile(file)) return;
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

	async function openInOs() {
		if (file?.path && canUseFs()) await openPath(file.path);
	}

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
				{#if editable && !isDocxFile(file)}
					<button onclick={save} class="save">
						{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : saveState === 'error' ? 'Save (desktop)' : 'Save'}
					</button>
				{/if}
				<button onclick={openInOs} disabled={!file?.path || !canUseFs()} title={file?.path ? 'Open in default app' : 'Desktop only'}>Open file ↗</button>
			{/if}
			{#if onSplit && splitTargets.length}
				<div class="split-wrap">
					<button onclick={() => (splitMenu = !splitMenu)} title="Open a file beside this one" aria-label="Split view">⇆</button>
					{#if splitMenu}
						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<div class="split-menu" onmouseleave={() => (splitMenu = false)}>
							{#each splitTargets as t (t.id)}
								<button class="split-item" onclick={() => { onSplit?.(t.id); splitMenu = false; }} title={t.label}>{t.label}</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
			{#if !isText && file?.status === 'ready'}
				<button onclick={makeMindmap} disabled={mapState === 'mapping'} title="Generate a mind map from this document">
					{mapState === 'mapping' ? 'Mapping…' : '🧠 Map'}
				</button>
				<button onclick={makeStudy} disabled={studyState === 'generating'} title="Generate flashcards + quizzes from this document">
					{studyState === 'generating' ? 'Studying…' : '🎴 Study'}
				</button>
			{/if}
			<button onclick={onclose} aria-label="Close">✕</button>
		</div>
	</header>
	{#if mapError}
		<div class="map-error" role="alert">{mapError} <button class="dismiss" onclick={() => (mapError = '')} aria-label="Dismiss">✕</button></div>
	{/if}
	{#if studyError}
		<div class="map-error" role="alert">{studyError} <button class="dismiss" onclick={() => (studyError = '')} aria-label="Dismiss">✕</button></div>
	{/if}

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
	{:else if !blob && !isMarkdownFile(file)}
		<div class="empty">
			{#if blobLoading}Loading "{file?.filename}"…{:else}File data not found — re-drop "{file?.filename}" to restore it.{/if}
		</div>
	{:else if isPdfFile(file)}
		<PdfViewer fileId={fileId} blob={blob} {initialQuery} {initialPage} />
	{:else if editable}
		<div class="toolbar">
			<button onclick={() => exec('bold')}><b>B</b></button>
			<button onclick={() => exec('italic')}><i>I</i></button>
			<button onclick={() => exec('underline')}><u>U</u></button>
			{#if isDocxFile(file)}<span class="note">docx — edits in-app only; use "Open file" to edit on disk</span>{/if}
		</div>
		<div class="editor" bind:this={editor} contenteditable="true"></div>
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
	.map-error {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 6px var(--s-md);
		font-size: 12px;
		color: #b91c1c;
		background: rgba(220, 38, 38, 0.08);
		border-bottom: 1px solid var(--c-hairline);
	}
	.map-error .dismiss {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 4px;
	}
	.split-wrap {
		position: relative;
	}
	.split-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 4px);
		z-index: 20;
		min-width: 180px;
		max-width: 280px;
		max-height: 320px;
		overflow-y: auto;
		background: var(--c-surface, #fff);
		border: 1px solid var(--c-hairline);
		border-radius: 10px;
		box-shadow: 0 6px 20px rgba(0,0,0,0.2);
		padding: 4px;
	}
	.split-item {
		display: block;
		width: 100%;
		text-align: left;
		border: none !important;
		background: transparent !important;
		padding: 6px 8px !important;
		border-radius: 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.split-item:hover {
		background: var(--c-surface-soft, rgba(0,0,0,0.05)) !important;
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
