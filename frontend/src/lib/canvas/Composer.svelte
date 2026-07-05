<script lang="ts">
	// Shared textarea + send button used by CardChatPanel, CardExpand, and PromptBubble.
	// Callers wrap in their own .composer div and style via :global if needed.
	let {
		placeholder = '',
		disabled = false,
		focusOnMount = false,
		initialText = '',
		onsend,
		onblurempty
	}: {
		placeholder?: string;
		disabled?: boolean;
		focusOnMount?: boolean;
		initialText?: string;
		onsend: (text: string) => void;
		onblurempty?: () => void;
	} = $props();

	let draft = $state('');
	let el = $state<HTMLTextAreaElement>();

	export function focus() { el?.focus(); }

	$effect(() => {
		if (focusOnMount && el) el.focus();
	});

	// Seed the draft when the caller supplies new initial text (e.g. a quote sent from
	// a file selection). Only fires when the seed actually changes, so it never fights
	// the user's own typing.
	let lastSeed = '';
	$effect(() => {
		if (initialText && initialText !== lastSeed) {
			lastSeed = initialText;
			draft = initialText;
			el?.focus();
		}
	});

	function send() {
		const t = draft.trim();
		if (!t || disabled) return;
		onsend(t);
		draft = '';
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}
</script>

<textarea
	bind:this={el}
	bind:value={draft}
	{onkeydown}
	rows="1"
	{placeholder}
	{disabled}
	onblur={() => onblurempty && !draft.trim() && onblurempty()}
></textarea>
<button class="send" onclick={send} disabled={!draft.trim() || disabled} aria-label="Send">↵</button>

<style>
	textarea {
		flex: 1;
		border: none;
		outline: none;
		resize: none;
		background: transparent;
		font-family: var(--font-sans);
		font-size: var(--composer-font-size, 14px);
		line-height: 1.4;
		max-height: var(--composer-max-height, 110px);
		padding: 8px 0;
		color: var(--c-ink);
	}
	textarea:disabled { opacity: 0.5; }
	.send {
		flex: none;
		width: var(--composer-btn-size, 36px);
		height: var(--composer-btn-size, 36px);
		border-radius: var(--r-full);
		border: none;
		background: var(--c-primary);
		color: var(--c-on-primary);
		font-size: 15px;
		cursor: pointer;
		transition: transform var(--ease-glass);
	}
	.send:disabled { opacity: 0.35; cursor: default; }
	.send:not(:disabled):active { transform: scale(0.9); }
</style>
