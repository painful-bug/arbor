// Agent client. Streams agent events from the backend SSE endpoint.
// Keys live in the OS keychain, managed by the backend — the webview never sees them.

export type Provider = "anthropic" | "openai" | "google" | "groq" | "openrouter" | "nim" | "ollama";

export const PROVIDERS: {
	id: Provider;
	name: string;
	requiresKey: boolean;
	defaultModel: string;
}[] = [
	{ id: "anthropic", name: "Anthropic", requiresKey: true, defaultModel: "claude-sonnet-4-5" },
	{ id: "openai", name: "OpenAI", requiresKey: true, defaultModel: "gpt-4o" },
	{ id: "google", name: "Google Gemini", requiresKey: true, defaultModel: "gemini-2.5-flash" },
	{ id: "groq", name: "Groq", requiresKey: true, defaultModel: "openai/gpt-oss-20b" },
	{
		id: "openrouter",
		name: "OpenRouter",
		requiresKey: true,
		defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
	},
	{
		id: "nim",
		name: "NVIDIA NIM",
		requiresKey: true,
		defaultModel: "nvidia/nvidia-nemotron-nano-9b-v2",
	},
	{ id: "ollama", name: "Ollama (local)", requiresKey: false, defaultModel: "llama3.2" },
];

export interface ChatMessage {
	role: "user" | "assistant";
	content: string;
}

// One streamed agent event surfaced to the UI (text, reasoning, or a tool call).
export interface AgentEvent {
	type:
		| "text_delta"
		| "thinking_delta"
		| "tool_start"
		| "tool_end"
		| "provider_switch"
		| "done"
		| "error";
	id: string;
	delta?: string;
	message?: string;
	toolId?: string;
	name?: string;
	args?: unknown;
	ok?: boolean;
	detail?: string;
	sources?: { source: string; page?: number }[]; // KB search hits, for click-through citations
	provider?: string;
	model?: string;
}

export interface AgentOptions {
	providers: { provider: Provider; model: string }[]; // ladder, tried in order; falls back on rate-limit
	systemPrompt?: string;
	workflow?: string;
	bash?: boolean;
	websearch?: boolean;
	websearchBackend?: "duckduckgo" | "tavily";
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
	onEvent: (e: AgentEvent) => void,
): Promise<void> {
	const { apiFetch } = await import("$lib/api");

	// apiFetch returns null when running in browser without a backend configured.
	let res: Response | null;
	try {
		res = await apiFetch("/api/agent/prompt", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cardId,
				messages,
				providers: opts.providers,
				systemPrompt: opts.systemPrompt,
				workflow: opts.workflow,
				bash: opts.bash ?? false,
				websearch: opts.websearch ?? false,
				websearchBackend: opts.websearchBackend ?? "duckduckgo",
				canvasTools: opts.canvasTools ?? false,
				canvas: opts.canvas,
			}),
		});
	} catch {
		res = null;
	}

	if (!res) {
		// Browser fallback: synthetic echo when backend unreachable.
		const last = messages.at(-1)?.content ?? "";
		const head = opts.providers[0];
		const text = `[Browser mode — no backend] Echo via ${head?.provider}/${head?.model}: "${last}"`;
		onEvent({ type: "thinking_delta", id: cardId, delta: "Considering how to answer…" });
		onEvent({
			type: "tool_start",
			id: cardId,
			toolId: "demo1",
			name: "read",
			args: { path: "/tmp/example.txt" },
		});
		onEvent({
			type: "tool_end",
			id: cardId,
			toolId: "demo1",
			ok: true,
			detail: "example file contents",
		});
		let i = 0;
		const tick = () => {
			i += 4;
			onEvent({ type: "text_delta", id: cardId, delta: text.slice(i - 4, i) });
			if (i < text.length) setTimeout(tick, 16);
			else onEvent({ type: "done", id: cardId });
		};
		tick();
		return;
	}

	if (!res.ok || !res.body) {
		onEvent({ type: "error", id: cardId, message: `Agent request failed (${res.status})` });
		return;
	}

	// Read the SSE stream, parse `data: <JSON>` lines, fire onEvent for each.
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const parts = buf.split("\n\n");
			buf = parts.pop()!;
			for (const part of parts) {
				if (!part.startsWith("data: ")) continue; // SSE comments (e.g. heartbeat ": ping")
				const line = part.slice("data: ".length).trim();
				if (!line) continue;
				const ev = JSON.parse(line) as AgentEvent;
				onEvent(ev);
				if (ev.type === "done" || ev.type === "error") return;
			}
		}
	} catch (err) {
		onEvent({ type: "error", id: cardId, message: String(err) });
	}
}

// Lightweight provider check (key present in keychain, or keyless) via the backend.
export async function testConnection(provider: Provider): Promise<string | null> {
	const { apiFetch } = await import("$lib/api");
	try {
		const res = await apiFetch(`/api/providers/${provider}/test`, { method: "POST" });
		if (res.ok) return null;
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		return body.error ?? `test failed (${res.status})`;
	} catch (err) {
		return String(err);
	}
}

// One-shot in-place rewrite of a selected passage (fix LaTeX, reword, etc.). Returns
// the rewritten text, or throws with a user-facing message on failure.
export async function editSelection(text: string, instruction: string): Promise<string> {
	const { apiFetch } = await import("$lib/api");
	const res = await apiFetch("/api/agent/edit-selection", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ text, instruction }),
	});
	const body = (await res.json().catch(() => ({}))) as { edited?: string; error?: string };
	if (!res.ok || !body.edited) throw new Error(body.error ?? `Edit failed (${res.status})`);
	return body.edited;
}

// ── Per-canvas knowledge base ────────────────────────────────────────────────

// Clear all KB content for a canvas.
export async function kbClear(canvas: string): Promise<void> {
	const { apiFetch } = await import("$lib/api");
	await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files`, { method: "DELETE" });
}

export async function kbContents(canvas: string): Promise<{ sources: string[]; chunks: number }> {
	const { apiFetch } = await import("$lib/api");
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
	bytes: ArrayBuffer,
): Promise<number> {
	const { apiFetch } = await import("$lib/api");
	try {
		const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files`, {
			method: "POST",
			headers: {
				"Content-Type": mime || "application/octet-stream",
				"X-Filename": encodeURIComponent(filename),
			},
			body: bytes,
		});
		if (!res.ok) {
			const body = await res.json().catch(() => ({}) as { error?: string });
			throw new Error((body as { error?: string }).error ?? `KB index failed (${res.status})`);
		}
		const data = (await res.json()) as { chunks?: number };
		return data.chunks ?? 0;
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("KB index")) throw err;
		console.warn("[kbAdd] failed:", err);
		return 0;
	}
}

// Web clipper: backend fetches + extracts + indexes the URL into the canvas KB,
// returns the page title + readable text (dropped as an offline card by the caller).
export async function kbClip(
	canvas: string,
	url: string,
): Promise<{ title: string; text: string; chunks: number }> {
	const { apiFetch } = await import("$lib/api");
	const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/clip`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ url }),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		throw new Error(body.error ?? `Clip failed (${res.status})`);
	}
	return (await res.json()) as { title: string; text: string; chunks: number };
}

// Studio mind-map: backend distills a KB source into a topic tree (nodes with
// parent pointers). Throws with a friendly message when no provider is configured.
export interface MindNode {
	id: string;
	title: string;
	summary: string;
	parent: string | null;
}
export async function studioMindmap(canvas: string, source: string): Promise<MindNode[]> {
	const { apiFetch } = await import("$lib/api");
	const res = await apiFetch(`/api/studio/${encodeURIComponent(canvas)}/mindmap`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source }),
	});
	const data = (await res.json().catch(() => ({}))) as { nodes?: MindNode[]; error?: string };
	if (!res.ok) {
		const msg =
			data.error === "no_provider"
				? "Set an AI provider key in Settings to generate a mind map."
				: data.error === "parse" || data.error === "empty"
					? "The model couldn't produce a mind map for this source."
					: `Mind map failed (${res.status})`;
		throw new Error(msg);
	}
	return data.nodes ?? [];
}

// Studio study set: flashcards + MCQs generated (and stored) from a KB source.
export interface StudyItem {
	id: string;
	kind: "flashcard" | "mcq";
	question: string;
	answer: string;
	choices: string[] | null;
}

async function studioReq(path: string, init?: RequestInit): Promise<Response> {
	const { apiFetch } = await import("$lib/api");
	return apiFetch(path, init);
}

export async function studioGenerate(canvas: string, source: string): Promise<StudyItem[]> {
	const res = await studioReq(`/api/studio/${encodeURIComponent(canvas)}/generate`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source }),
	});
	const data = (await res.json().catch(() => ({}))) as { items?: StudyItem[]; error?: string };
	if (!res.ok) {
		const msg =
			data.error === "no_provider"
				? "Set an AI provider key in Settings to generate study cards."
				: data.error === "parse" || data.error === "empty"
					? "The model couldn't produce study cards for this source."
					: `Study generation failed (${res.status})`;
		throw new Error(msg);
	}
	return data.items ?? [];
}

export async function studioReview(canvas: string): Promise<StudyItem[]> {
	const res = await studioReq(`/api/studio/${encodeURIComponent(canvas)}/review`);
	const data = (await res.json().catch(() => ({}))) as { items?: StudyItem[] };
	return data.items ?? [];
}

export async function studioDeleteItem(canvas: string, id: string): Promise<void> {
	await studioReq(`/api/studio/${encodeURIComponent(canvas)}/review/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
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
	const { apiFetch } = await import("$lib/api");
	try {
		const res = await apiFetch(`/api/cleanup/${encodeURIComponent(canvas)}/arrange`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
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

export interface NameCluster {
	id: string;
	members: { id: string; source?: string; text?: string; kind?: string }[];
}

export async function cleanupName(
	canvas: string,
	clusters: NameCluster[],
): Promise<Record<string, string>> {
	const { apiFetch } = await import("$lib/api");
	try {
		const res = await apiFetch(`/api/cleanup/${encodeURIComponent(canvas)}/name`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clusters }),
			// Small models are often reasoning models — naming can take 30-40s.
			signal: AbortSignal.timeout(60000),
		});
		if (!res.ok) return {};
		const data = (await res.json()) as { names?: Record<string, string> };
		return data.names ?? {};
	} catch {
		return {};
	}
}

// Hybrid search over indexed KB chunks (same retrieval path used by the agent).
export async function kbSearch(canvas: string, query: string, k = 8): Promise<string[]> {
	const { apiFetch } = await import("$lib/api");
	if (!query.trim()) return [];
	try {
		const res = await apiFetch(
			`/api/kb/${encodeURIComponent(canvas)}/search?q=${encodeURIComponent(query)}&k=${k}`,
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
	k = 8,
): Promise<{ text: string; source: string; score: number; page?: number }[]> {
	const { apiFetch } = await import("$lib/api");
	if (!query.trim()) return [];
	try {
		const res = await apiFetch(
			`/api/kb/${encodeURIComponent(canvas)}/search?q=${encodeURIComponent(query)}&k=${k}&detail=1`,
		);
		if (!res.ok) return [];
		const data = (await res.json()) as {
			results?: { text: string; source: string; score: number; page?: number }[];
		};
		return data.results ?? [];
	} catch {
		return [];
	}
}

// Semantic neighbors of a node's text — drives background auto-linking.
export async function kbRelate(
	canvas: string,
	text: string,
	opts: { exclude?: string; k?: number; minScore?: number } = {},
): Promise<{ source: string; score: number }[]> {
	const { apiFetch } = await import("$lib/api");
	if (!text.trim()) return [];
	try {
		const res = await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/relate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text,
				exclude: opts.exclude ?? "",
				k: opts.k ?? 3,
				minScore: opts.minScore ?? 0.62,
			}),
		});
		if (!res?.ok) return [];
		const data = (await res.json()) as { neighbors?: { source: string; score: number }[] };
		return data.neighbors ?? [];
	} catch {
		return [];
	}
}

export async function kbRemove(canvas: string, filename: string): Promise<void> {
	const { apiFetch } = await import("$lib/api");
	try {
		await apiFetch(`/api/kb/${encodeURIComponent(canvas)}/files/${encodeURIComponent(filename)}`, {
			method: "DELETE",
		});
	} catch {}
}
