// Agent client. Talks to the Rust broker (`agent_prompt`), which forwards to the
// pi sidecar and relays its events back as `loom:agent`. Keys live in Keychain and
// are injected by Rust — the webview only sends provider + model.

import type { UnlistenFn } from '@tauri-apps/api/event';

export type Provider = 'anthropic' | 'openai' | 'google' | 'groq' | 'openrouter' | 'nim' | 'ollama';

export const PROVIDERS: { id: Provider; name: string; requiresKey: boolean; defaultModel: string }[] = [
	{ id: 'anthropic', name: 'Anthropic', requiresKey: true, defaultModel: 'claude-sonnet-4-5' },
	{ id: 'openai', name: 'OpenAI', requiresKey: true, defaultModel: 'gpt-4o' },
	{ id: 'google', name: 'Google Gemini', requiresKey: true, defaultModel: 'gemini-2.5-flash' },
	{ id: 'groq', name: 'Groq', requiresKey: true, defaultModel: 'openai/gpt-oss-20b' },
	{ id: 'openrouter', name: 'OpenRouter', requiresKey: true, defaultModel: 'meta-llama/llama-3.3-70b-instruct:free' },
	{ id: 'nim', name: 'NVIDIA NIM', requiresKey: true, defaultModel: 'nvidia/nvidia-nemotron-nano-9b-v2' },
	{ id: 'ollama', name: 'Ollama (local)', requiresKey: false, defaultModel: 'llama3.2' }
];

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

// One streamed agent event surfaced to the UI (text, reasoning, or a tool call).
export interface AgentEvent {
	type: 'text_delta' | 'thinking_delta' | 'tool_start' | 'tool_end' | 'done' | 'error';
	id: string;
	delta?: string;
	message?: string;
	toolId?: string;
	name?: string;
	args?: unknown;
	ok?: boolean;
	detail?: string;
}

export interface AgentOptions {
	provider: Provider;
	model: string;
	systemPrompt?: string;
	workflow?: string;
	bash?: boolean;
	websearch?: boolean;
	websearchBackend?: 'duckduckgo' | 'tavily';
}

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Run an agent turn. `onEvent` fires for every streamed event until `done`/`error`.
export async function runAgent(
	cardId: string,
	messages: ChatMessage[],
	opts: AgentOptions,
	onEvent: (e: AgentEvent) => void
): Promise<void> {
	if (!isTauri()) {
		// Browser fallback: echo + a couple synthetic agent events so the canvas and
		// activity timeline are exercisable in dev without the Tauri sidecar.
		const last = messages.at(-1)?.content ?? '';
		const text = `[Browser mode — no Tauri] Echo via ${opts.provider}/${opts.model}: "${last}"`;
		onEvent({ type: 'thinking_delta', id: cardId, delta: 'Considering how to answer…' });
		onEvent({ type: 'tool_start', id: cardId, toolId: 'demo1', name: 'read', args: { path: '/tmp/example.txt' } });
		onEvent({ type: 'tool_end', id: cardId, toolId: 'demo1', ok: true, detail: 'example file contents' });
		let i = 0;
		const tick = () => {
			i += 4;
			onEvent({ type: 'text_delta', id: cardId, delta: text.slice(i - 4, i) });
			if (i < text.length) setTimeout(tick, 16);
			else onEvent({ type: 'done', id: cardId });
		};
		tick();
		return;
	}

	const { invoke } = await import('@tauri-apps/api/core');
	const { listen } = await import('@tauri-apps/api/event');

	const unlisteners: UnlistenFn[] = [];
	const cleanup = () => unlisteners.forEach((u) => u());

	const un = await listen<AgentEvent>('loom:agent', (e) => {
		if (e.payload.id !== cardId) return;
		onEvent(e.payload);
		if (e.payload.type === 'done' || e.payload.type === 'error') cleanup();
	});
	unlisteners.push(un);

	try {
		await invoke('agent_prompt', {
			cardId,
			messages,
			provider: opts.provider,
			model: opts.model,
			systemPrompt: opts.systemPrompt ?? null,
			workflow: opts.workflow ?? null,
			bash: opts.bash ?? false,
			websearch: opts.websearch ?? false,
			websearchBackend: opts.websearchBackend ?? null
		});
	} catch (err) {
		cleanup();
		onEvent({ type: 'error', id: cardId, message: String(err) });
	}
}

export async function cancelAgent(cardId: string): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		await invoke('agent_cancel', { cardId });
	} catch {
		/* nothing to cancel */
	}
}

// Lightweight provider check (key present in Keychain, or keyless).
export async function testConnection(provider: Provider): Promise<string | null> {
	if (!isTauri()) return 'Test only works in the desktop app.';
	const { invoke } = await import('@tauri-apps/api/core');
	try {
		await invoke('provider_test', { provider });
		return null;
	} catch (err) {
		return String(err);
	}
}

// ── Per-canvas RAG (desktop only; no-ops in browser) ────────────────────────

export const DEFAULT_CANVAS = 'default'; // ponytail: single canvas until multi-canvas exists

export async function ragAdd(
	canvas: string,
	filename: string,
	mime: string,
	bytes: ArrayBuffer
): Promise<number> {
	if (!isTauri()) return 0;
	const { invoke } = await import('@tauri-apps/api/core');
	const data = base64(bytes);
	return invoke<number>('rag_add', { canvas, filename, mime, data });
}

function base64(buf: ArrayBuffer): string {
	const bytes = new Uint8Array(buf);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin);
}
