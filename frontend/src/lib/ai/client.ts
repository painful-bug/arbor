// Agent client. Streams agent events from the backend SSE endpoint.
// Keys live in the OS keychain, managed by the backend — the webview never sees them.

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
	canvasTools?: boolean;
	canvas?: string; // canvas id for KB group isolation
}

// Run an agent turn. `onEvent` fires for every streamed event until `done`/`error`.
// In Tauri the backend is on 127.0.0.1:PORT (discovered at startup via backend_info).
// In browser-dev mode, fall back to a synthetic echo so the UI is exercisable without
// a running backend.
export async function runAgent(
	cardId: string,
	messages: ChatMessage[],
	opts: AgentOptions,
	onEvent: (e: AgentEvent) => void
): Promise<void> {
	const { apiFetch } = await import('$lib/api');

	// apiFetch returns null when running in browser without a backend configured.
	let res: Response | null;
	try {
		res = await apiFetch('/api/agent/prompt', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				cardId,
				messages,
				provider: opts.provider,
				model: opts.model,
				systemPrompt: opts.systemPrompt,
				workflow: opts.workflow,
				bash: opts.bash ?? false,
				websearch: opts.websearch ?? false,
				websearchBackend: opts.websearchBackend ?? 'duckduckgo',
				canvasTools: opts.canvasTools ?? false,
				canvas: opts.canvas
			})
		});
	} catch {
		res = null;
	}

	if (!res) {
		// Browser fallback: synthetic echo when backend unreachable.
		const last = messages.at(-1)?.content ?? '';
		const text = `[Browser mode — no backend] Echo via ${opts.provider}/${opts.model}: "${last}"`;
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

	if (!res.ok || !res.body) {
		onEvent({ type: 'error', id: cardId, message: `Agent request failed (${res.status})` });
		return;
	}

	// Read the SSE stream, parse `data: <JSON>` lines, fire onEvent for each.
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const parts = buf.split('\n\n');
			buf = parts.pop()!;
			for (const part of parts) {
				const line = part.replace(/^data: /, '').trim();
				if (!line) continue;
				const ev = JSON.parse(line) as AgentEvent;
				onEvent(ev);
				if (ev.type === 'done' || ev.type === 'error') return;
			}
		}
	} catch (err) {
		onEvent({ type: 'error', id: cardId, message: String(err) });
	}
}

// Lightweight provider check (key present in keychain, or keyless) via the backend.
export async function testConnection(provider: Provider): Promise<string | null> {
	const { apiFetch } = await import('$lib/api');
	try {
		const res = await apiFetch(`/api/providers/${provider}/test`, { method: 'POST' });
		if (res.ok) return null;
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return body.error ?? `test failed (${res.status})`;
	} catch (err) {
		return String(err);
	}
}

// ── Per-canvas knowledge base ────────────────────────────────────────────────

// Clear all KB content for a canvas.
export async function kbClear(canvas: string): Promise<void> {
	const { apiFetch } = await import('$lib/api');
	await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files`, { method: 'DELETE' });
}

export async function kbContents(canvas: string): Promise<{ sources: string[]; chunks: number }> {
	const { apiFetch } = await import('$lib/api');
	try {
		const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/contents`);
		if (!res.ok) return { sources: [], chunks: 0 };
		return res.json() as Promise<{ sources: string[]; chunks: number }>;
	} catch {
		return { sources: [], chunks: 0 };
	}
}

// Index a file in the canvas KB. Works in both Tauri and browser dev.
export async function kbAdd(
	canvas: string,
	filename: string,
	mime: string,
	bytes: ArrayBuffer
): Promise<number> {
	const { apiFetch } = await import('$lib/api');
	try {
		const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files`, {
			method: 'POST',
			headers: {
				'Content-Type': mime || 'application/octet-stream',
				'X-Filename': encodeURIComponent(filename)
			},
			body: bytes
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({} as { error?: string }));
			throw new Error((body as { error?: string }).error ?? `KB index failed (${res.status})`);
		}
		const data = (await res.json()) as { chunks?: number };
		return data.chunks ?? 0;
	} catch (err) {
		if (err instanceof Error && err.message.startsWith('KB index')) throw err;
		console.warn('[kbAdd] failed:', err);
		return 0;
	}
}

// ── Clean Up — semantic force-clustering ───────────────────────────────────

// Spacing-independent layout: cluster grid + each card's offset from its cell
// center. place(layout, gap) (in the canvas store) turns it into pixel positions.
export interface ArrangeLayout {
	cellBase: number;
	unit: number;
	cols: number;
	nodes: Record<string, { col: number; row: number; lx: number; ly: number }>;
}

export async function cleanupArrange(
	canvas: string,
	nodes: { id: string; text: string; w: number; h: number; x: number; y: number }[],
	edges: { source: string; target: string }[],
): Promise<ArrangeLayout | null> {
	const { apiFetch } = await import('$lib/api');
	try {
		const res = await apiFetch(`/api/cleanup/${encodeURIComponent(canvas)}/arrange`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ nodes, edges }),
			signal: AbortSignal.timeout(15000),
		});
		if (!res.ok) return null;
		const data = (await res.json()) as { layout?: ArrangeLayout | null };
		return data.layout ?? null;
	} catch {
		return null;
	}
}

// Hybrid search over indexed KB chunks (same retrieval path used by the agent).
export async function kbSearch(canvas: string, query: string, k = 8): Promise<string[]> {
	const { apiFetch } = await import('$lib/api');
	if (!query.trim()) return [];
	try {
		const res = await apiFetch(
			`/api/kb/${encodeURIComponent(canvas)}/search?q=${encodeURIComponent(query)}&k=${k}`
		);
		if (!res.ok) return [];
		const data = (await res.json()) as { results?: string[] };
		return data.results ?? [];
	} catch {
		return [];
	}
}

// Like kbSearch but keeps source + score, so a file-content hit can be mapped
// back to its file node and focused/highlighted (drives global search).
export async function kbSearchHits(
	canvas: string,
	query: string,
	k = 8
): Promise<{ text: string; source: string; score: number; page?: number }[]> {
	const { apiFetch } = await import('$lib/api');
	if (!query.trim()) return [];
	try {
		const res = await apiFetch(
			`/api/kb/${encodeURIComponent(canvas)}/search?q=${encodeURIComponent(query)}&k=${k}&detail=1`
		);
		if (!res.ok) return [];
		const data = (await res.json()) as { results?: { text: string; source: string; score: number; page?: number }[] };
		return data.results ?? [];
	} catch {
		return [];
	}
}

// Semantic neighbors of a node's text — drives background auto-linking.
export async function kbRelate(
	canvas: string,
	text: string,
	opts: { exclude?: string; k?: number; minScore?: number } = {}
): Promise<{ source: string; score: number }[]> {
	const { apiFetch } = await import('$lib/api');
	if (!text.trim()) return [];
	try {
		const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/relate`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, exclude: opts.exclude ?? '', k: opts.k ?? 3, minScore: opts.minScore ?? 0.62 })
		});
		if (!res || !res.ok) return [];
		const data = (await res.json()) as { neighbors?: { source: string; score: number }[] };
		return data.neighbors ?? [];
	} catch {
		return [];
	}
}

export async function kbRemove(canvas: string, filename: string): Promise<void> {
	const { apiFetch } = await import('$lib/api');
	try {
		await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
	} catch {}
}
