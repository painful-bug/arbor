<script lang="ts">
	// Interactive web embed node. Poster-first: iframe only loads when user clicks "Load".
	// Drag handle = bar background (non-button areas) + frame area when not interactive.
	// Click frame once to "activate" iframe interaction; click outside to release drag.
	import { Handle, Position, NodeResizer, type NodeProps } from '@xyflow/svelte';
	import { faviconFor, labelFor, toEmbedUrl, isMediaEmbed, youtubeThumb } from '$lib/url';
	import { popOutWindow, openExternal } from '$lib/web';

	let { id, data, selected }: NodeProps = $props();
	const url = $derived((data as { url: string }).url);
	const media = $derived(isMediaEmbed(url)); // known player → skip blocked heuristic
	const thumb = $derived(youtubeThumb(url)); // YouTube poster image, else null
	const title = $derived((data as { title?: string }).title || labelFor(url));

	let shouldLoad = $state(false); // user must click to mount iframe
	let loaded = $state(false);
	let blocked = $state(false);
	let interactive = $state(false); // pointer-events on iframe
	let reloadKey = $state(0);
	let host = $state<HTMLDivElement>();

	// autoplay once the user has clicked Load (media embeds only)
	const embedUrl = $derived(toEmbedUrl(url, shouldLoad && media));

	// 3s safety-net: some browsers skip onload entirely for blocked iframes.
	// Known media players never get flagged this way (they load cross-origin).
	$effect(() => {
		if (media || !shouldLoad || loaded || blocked) return;
		const t = setTimeout(() => { if (!loaded) blocked = true; }, 3000);
		return () => clearTimeout(t);
	});

	// Deactivate iframe interaction when clicking outside the card
	$effect(() => {
		if (!interactive) return;
		function away(e: MouseEvent) {
			if (host && !host.contains(e.target as Node)) interactive = false;
		}
		document.addEventListener('click', away, true);
		return () => document.removeEventListener('click', away, true);
	});

	function load() {
		shouldLoad = true;
		blocked = false;
		loaded = false;
	}

	function reload() {
		shouldLoad = true;
		loaded = false;
		blocked = false;
		reloadKey++;
	}

	// Distinguish real load from an X-Frame-Options block. Cross-origin frames
	// (YouTube, Vimeo, most sites) expose contentDocument === null WITHOUT throwing,
	// so null means "cross-origin content loaded", NOT blocked. Only a same-origin
	// frame stuck at about:blank is genuinely blocked.
	function onIframeLoad(e: Event) {
		const iframe = e.currentTarget as HTMLIFrameElement;
		try {
			const doc = iframe.contentDocument; // null when cross-origin → loaded
			blocked = !!doc && doc.URL === 'about:blank';
		} catch {
			blocked = false; // SecurityError = cross-origin content present
		}
		loaded = !blocked;
	}

	let overlayDownX = 0, overlayDownY = 0;
	function overlayPointerDown(e: PointerEvent) {
		overlayDownX = e.clientX; overlayDownY = e.clientY;
	}
	function overlayPointerUp(e: PointerEvent) {
		// Treat as click only if pointer didn't move significantly (not a drag).
		if (Math.abs(e.clientX - overlayDownX) < 6 && Math.abs(e.clientY - overlayDownY) < 6) {
			e.stopPropagation();
			interactive = true;
		}
	}
</script>

<!-- Side handles — same IDs as CardNode so onNodeDragStop remaps them correctly -->
<Handle type="source" position={Position.Top} id="top-s" />
<Handle type="target" position={Position.Top} id="top-t" />
<Handle type="source" position={Position.Right} id="right-s" />
<Handle type="target" position={Position.Right} id="right-t" />
<Handle type="source" position={Position.Bottom} id="bottom-s" />
<Handle type="target" position={Position.Bottom} id="bottom-t" />
<Handle type="source" position={Position.Left} id="left-s" />
<Handle type="target" position={Position.Left} id="left-t" />
<!-- bind:this needed for outside-click detection -->
<div class="web" class:selected bind:this={host}>
	<NodeResizer minWidth={320} minHeight={240} isVisible={selected} />

	<!-- nodrag only on individual interactive elements, not the whole bar, so the
	     bar background area remains a draggable grab-handle. -->
	<header class="bar">
		{#if faviconFor(url)}
			<img class="fav nodrag" src={faviconFor(url)} alt="" aria-hidden="true" />
		{/if}
		<!-- svelte-ignore a11y_invalid_attribute -->
		<a
			class="title nodrag"
			href={url}
			title={url}
			onclick={(e) => { e.preventDefault(); openExternal(url); }}
		>{title}</a>
		<button class="ico nodrag" title="Reload" aria-label="Reload" onclick={reload}>↻</button>
		<button class="ico nodrag" title="Open in window" aria-label="Open in window" onclick={() => popOutWindow(url)}>⧉</button>
		<button class="ico nodrag" title="Open externally" aria-label="Open externally" onclick={() => openExternal(url)}>↗</button>
	</header>

	<!-- Frame: NOT nodrag so it acts as drag surface when iframe is inactive.
	     Pointer-events on the iframe are toggled instead. -->
	<div class="frame">
		{#if shouldLoad}
			{#key reloadKey}
				<iframe
					src={embedUrl}
					{title}
					sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
					allow="autoplay; fullscreen; encrypted-media; picture-in-picture; web-share"
					allowfullscreen
					referrerpolicy={media ? 'strict-origin-when-cross-origin' : 'no-referrer'}
					style="pointer-events: {interactive ? 'auto' : 'none'}"
					onload={onIframeLoad}
					onerror={() => (blocked = !media)}
				></iframe>
			{/key}
			<!-- Transparent overlay: dragging this moves the node; single click activates iframe -->
			{#if !interactive && !blocked}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="overlay" onpointerdown={overlayPointerDown} onpointerup={overlayPointerUp} title="Click to interact · drag to move"></div>
			{/if}
		{:else}
			<!-- Poster: nodrag so d3-drag doesn't swallow the click event. -->
			{#if thumb}
				<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
				<div class="poster thumb nodrag" style="background-image:url({thumb})" onclick={load} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && load()}>
					<span class="play nodrag" aria-hidden="true">▶</span>
					<span class="poster-title over nodrag">{title}</span>
				</div>
			{:else}
				<div class="poster nodrag" onclick={load} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && load()}>
					{#if faviconFor(url)}
						<img class="poster-fav nodrag" src={faviconFor(url)} alt="" aria-hidden="true" />
					{/if}
					<span class="poster-title nodrag">{title}</span>
					<span class="load-hint nodrag">Click to load</span>
				</div>
			{/if}
		{/if}

		{#if blocked}
			<div class="fallback">
				<p>{media ? "Can't play here — open in a window." : 'This site blocks embedding.'}</p>
				<button class="nodrag" onclick={() => popOutWindow(url)}>{media ? '▶ Play in window' : 'Open in window ↗'}</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.web {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border-radius: var(--r-lg);
		border: 1px solid rgba(0, 0, 0, 0.1);
		box-shadow: var(--elev-2);
		box-sizing: border-box;
		background: var(--c-surface, #fff);
	}
	.web.selected {
		box-shadow: 0 0 0 2px var(--c-ink);
	}
	.bar {
		display: flex;
		align-items: center;
		gap: var(--s-xs);
		padding: 6px 8px;
		border-bottom: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		background: var(--c-surface-soft, rgba(0, 0, 0, 0.03));
		cursor: grab;
	}
	.bar:active {
		cursor: grabbing;
	}
	.fav {
		width: 16px;
		height: 16px;
		flex: none;
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 12px;
		color: var(--c-ink);
		text-decoration: none;
	}
	.title:hover {
		text-decoration: underline;
	}
	.ico {
		flex: none;
		width: 24px;
		height: 24px;
		border: none;
		border-radius: var(--r-sm, 6px);
		background: transparent;
		cursor: pointer;
		font-size: 13px;
		color: var(--c-ink);
	}
	.ico:hover {
		background: rgba(0, 0, 0, 0.08);
	}
	.frame {
		position: relative;
		flex: 1;
		min-height: 0;
	}
	iframe {
		width: 100%;
		height: 100%;
		border: none;
		background: #fff;
		display: block;
	}
	.overlay {
		position: absolute;
		inset: 0;
		background: transparent;
		cursor: default;
		z-index: 1;
	}
	.poster {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-xs);
		color: rgba(0, 0, 0, 0.5);
		font-size: 13px;
		cursor: pointer;
	}
	.poster:hover .load-hint {
		opacity: 1;
	}
	.poster.thumb {
		background-size: cover;
		background-position: center;
		background-color: #000;
		justify-content: center;
	}
	.poster.thumb .play {
		font-size: 28px;
		color: #fff;
		width: 64px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.55);
		border-radius: 12px;
		transition: background 0.15s;
	}
	.poster.thumb:hover .play {
		background: #f00;
	}
	.poster-title.over {
		position: absolute;
		bottom: 8px;
		left: 8px;
		right: 8px;
		max-width: none;
		color: #fff;
		text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
		text-align: center;
	}
	.poster-fav {
		width: 32px;
		height: 32px;
		opacity: 0.7;
	}
	.poster-title {
		font-size: 12px;
		max-width: 80%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.load-hint {
		font-size: 11px;
		opacity: 0.5;
		transition: opacity 0.15s;
		font-family: var(--font-mono);
	}
	.fallback {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: var(--s-sm);
		background: var(--c-surface, #fff);
		font-size: 13px;
		z-index: 2;
	}
	.fallback p {
		margin: 0;
		color: rgba(0, 0, 0, 0.5);
	}
	.fallback button {
		padding: 8px 14px;
		border: none;
		border-radius: var(--r-pill, 999px);
		background: var(--c-primary);
		color: var(--c-on-primary);
		cursor: pointer;
	}
</style>
