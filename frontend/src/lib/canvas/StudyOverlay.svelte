<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { studioReview, studioDeleteItem, type StudyItem } from '$lib/ai/client';
	import { reducedMotion } from '$lib/theme/motion.svelte';
	import { currentCanvasId } from './store.svelte';

	// Study deck: flashcards (flip) + MCQs (pick) generated from KB sources and
	// stored server-side. Opens on the arbor:study event (fresh generation) or
	// standalone to review everything indexed for the canvas.
	let { open = $bindable(false) }: { open: boolean } = $props();

	let items = $state<StudyItem[]>([]);
	let loading = $state(false);
	let idx = $state(0);
	let revealed = $state(false); // flashcard flipped / mcq answered
	let picked = $state<string | null>(null); // chosen mcq choice

	const current = $derived(items[idx]);

	async function load() {
		loading = true;
		items = await studioReview(currentCanvasId() || 'default');
		idx = 0;
		reset();
		loading = false;
	}

	function reset() {
		revealed = false;
		picked = null;
	}

	// arbor:study carries a freshly generated batch so we skip a round-trip.
	function onStudyEvent(e: Event) {
		const detail = (e as CustomEvent<{ items?: StudyItem[] }>).detail;
		open = true;
		if (detail?.items?.length) {
			items = detail.items;
			idx = 0;
			reset();
			loading = false;
		} else {
			void load();
		}
	}

	$effect(() => {
		window.addEventListener('arbor:study', onStudyEvent);
		return () => window.removeEventListener('arbor:study', onStudyEvent);
	});

	// When opened by the caller (not via event), pull the stored deck.
	let wasOpen = false;
	$effect(() => {
		if (open && !wasOpen && items.length === 0) void load();
		wasOpen = open;
	});

	function next() {
		if (idx < items.length - 1) { idx += 1; reset(); }
	}
	function prev() {
		if (idx > 0) { idx -= 1; reset(); }
	}
	function flip() {
		revealed = true;
	}
	function pick(choice: string) {
		if (revealed) return;
		picked = choice;
		revealed = true;
	}

	async function discard() {
		if (!current) return;
		const id = current.id;
		await studioDeleteItem(currentCanvasId() || 'default', id);
		items = items.filter((it) => it.id !== id);
		if (idx >= items.length) idx = Math.max(0, items.length - 1);
		reset();
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { open = false; return; }
		if (e.key === 'ArrowRight') next();
		else if (e.key === 'ArrowLeft') prev();
		else if (e.key === ' ' && current?.kind === 'flashcard') { e.preventDefault(); revealed ? next() : flip(); }
	}

	function close() { open = false; }
</script>

<svelte:window onkeydown={open ? onKey : undefined} />

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="sd-backdrop" transition:fade={{ duration: reducedMotion() ? 0 : 150 }} onpointerdown={close}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="sd-panel"
			role="dialog"
			aria-modal="true"
			aria-label="Study deck"
			tabindex="-1"
			transition:scale={{ duration: reducedMotion() ? 0 : 220, start: 0.96, easing: backOut, opacity: 0 }}
			onpointerdown={(e) => e.stopPropagation()}
		>
			<header class="sd-header">
				<span class="sd-title">Study{items.length ? ` · ${idx + 1}/${items.length}` : ''}</span>
				<div class="sd-actions">
					{#if current}
						<span class="sd-kind">{current.kind === 'mcq' ? 'Quiz' : 'Flashcard'}</span>
						<button class="sd-btn sd-del" onclick={discard} title="Remove this card">Delete</button>
					{/if}
					<button class="sd-btn" onclick={close} aria-label="Close">✕</button>
				</div>
			</header>

			<div class="sd-body">
				{#if loading}
					<div class="sd-empty"><span class="spinner"></span> Loading…</div>
				{:else if !current}
					<div class="sd-empty">No study cards yet. Open a document and click <strong>🎴 Study</strong>.</div>
				{:else}
					<div class="sd-card">
						<div class="sd-q">{current.question}</div>

						{#if current.kind === 'flashcard'}
							{#if revealed}
								<div class="sd-a">{current.answer}</div>
							{:else}
								<button class="sd-reveal" onclick={flip}>Show answer</button>
							{/if}
						{:else}
							<ul class="sd-choices">
								{#each current.choices ?? [] as choice (choice)}
									<li>
										<button
											class="sd-choice"
											class:correct={revealed && choice === current.answer}
											class:wrong={revealed && choice === picked && choice !== current.answer}
											disabled={revealed}
											onclick={() => pick(choice)}
										>
											{choice}
										</button>
									</li>
								{/each}
							</ul>
							{#if revealed}
								<div class="sd-verdict" class:ok={picked === current.answer}>
									{picked === current.answer ? 'Correct' : `Answer: ${current.answer}`}
								</div>
							{/if}
						{/if}
					</div>
				{/if}
			</div>

			{#if current}
				<footer class="sd-footer">
					<button class="sd-btn" onclick={prev} disabled={idx === 0}>← Prev</button>
					<button class="sd-btn" onclick={next} disabled={idx >= items.length - 1}>Next →</button>
				</footer>
			{/if}
		</div>
	</div>
{/if}

<style>
	.sd-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 12vh;
		background: rgba(0, 0, 0, 0.28);
	}
	.sd-panel {
		width: min(620px, 92vw);
		max-height: 76vh;
		background: var(--c-canvas, #fff);
		border-radius: 14px;
		border: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		box-shadow: var(--elev-3, 0 18px 50px rgba(0, 0, 0, 0.25));
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.sd-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--c-hairline, rgba(0, 0, 0, 0.08));
		flex: none;
	}
	.sd-title { font-weight: 600; font-size: 14px; color: var(--c-ink); }
	.sd-actions { display: flex; gap: 6px; align-items: center; }
	.sd-kind {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: rgba(var(--ink-rgb), 0.45);
	}
	.sd-btn {
		border: none;
		background: transparent;
		border-radius: var(--r-pill, 999px);
		padding: 5px 10px;
		font-size: 12px;
		font-weight: 500;
		color: var(--c-ink);
		cursor: pointer;
		transition: background 0.12s;
	}
	.sd-btn:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.06); }
	.sd-btn:disabled { opacity: 0.4; cursor: default; }
	.sd-del { color: rgb(255, 80, 80); }
	.sd-del:hover { background: rgba(255, 80, 80, 0.1); }
	.sd-body {
		flex: 1;
		overflow-y: auto;
		padding: 24px 20px;
		display: flex;
		flex-direction: column;
	}
	.sd-empty {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: rgba(var(--ink-rgb), 0.5);
		text-align: center;
		padding: 32px 12px;
		font-size: 13px;
	}
	.sd-card { display: flex; flex-direction: column; gap: 16px; }
	.sd-q { font-size: 17px; font-weight: 600; line-height: 1.45; color: var(--c-ink); }
	.sd-a {
		font-size: 15px;
		line-height: 1.6;
		padding: 14px 16px;
		background: var(--c-surface-soft, rgba(0, 0, 0, 0.03));
		border-radius: 10px;
		border: 1px solid var(--c-hairline);
	}
	.sd-reveal {
		align-self: flex-start;
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 10px;
		padding: 8px 14px;
		font-size: 13px;
		cursor: pointer;
	}
	.sd-choices { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
	.sd-choice {
		width: 100%;
		text-align: left;
		border: 1px solid var(--c-hairline);
		background: var(--c-surface-soft, #fff);
		border-radius: 10px;
		padding: 10px 14px;
		font-size: 14px;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.sd-choice:hover:not(:disabled) { background: rgba(var(--ink-rgb), 0.05); }
	.sd-choice:disabled { cursor: default; }
	.sd-choice.correct { border-color: #16a34a; background: rgba(22, 163, 74, 0.12); }
	.sd-choice.wrong { border-color: #dc2626; background: rgba(220, 38, 38, 0.1); }
	.sd-verdict { font-size: 13px; font-weight: 600; color: #dc2626; }
	.sd-verdict.ok { color: #16a34a; }
	.sd-footer {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 12px 16px;
		border-top: 1px solid var(--c-hairline);
		flex: none;
	}
	.sd-footer .sd-btn {
		border: 1px solid var(--c-hairline);
		border-radius: 10px;
		padding: 6px 14px;
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
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
