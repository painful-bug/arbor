// Agent runs: streaming a card's turn, the hub session, canvas-tool application,
// and auto-titling. Mutates store state; context building lives in context.ts.
import { type AgentEvent, type ChatMessage, runAgent } from "$lib/ai/client";
import { workflowSystemPrompt } from "$lib/ai/workflows";
import {
	buildCardNode,
	type CardData,
	cardPlainText,
	cardTitle,
	lastTurn,
	nextBlock,
	type Turn,
} from "./cards";
import {
	ancestry,
	canvasDigest,
	canvasDigestWithIds,
	connectedDigest,
	connectedIds,
	pushTurns,
} from "./context";
import {
	activeLadder,
	addCard,
	addTextCard,
	currentCanvasId,
	flow,
	library,
	nextNodeId,
	renameCanvas,
	saveCanvas,
	session,
	setCardText,
	settings,
	triggerAutolink,
} from "./store.svelte";

// Write the streamed answer into the card's last (active) turn.
function setTurnAnswer(id: string, answer: string, streaming: boolean): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[])];
		turns[turns.length - 1] = { ...turns[turns.length - 1], answer };
		return { ...n, data: { ...n.data, turns, streaming } };
	});
}

// Throttle streamed answer paints: each paint re-renders the card's markdown, which
// is O(answer length) — per-token paints go quadratic on long answers. ~12fps is
// indistinguishable for text; the final (streaming=false) paint always lands now.
function makePainter(set: (answer: string, streaming: boolean) => void) {
	let pending: { answer: string; streaming: boolean } | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		timer = null;
		if (pending) {
			set(pending.answer, pending.streaming);
			pending = null;
		}
	};
	return (answer: string, streaming: boolean) => {
		pending = { answer, streaming };
		if (!streaming) {
			if (timer) clearTimeout(timer);
			flush();
		} else if (!timer) {
			timer = setTimeout(flush, 80);
		}
	};
}

// Coalesce streaming reasoning: one thinking_delta event per token would balloon the
// events array (and thus the saved doc + undo snapshots) into megabytes over a run.
// Merge consecutive deltas into one running event — AgentTimeline folds them anyway.
function appendEvent(events: AgentEvent[], ev: AgentEvent): AgentEvent[] {
	const prev = events[events.length - 1];
	if (ev.type === "thinking_delta" && prev?.type === "thinking_delta") {
		return [...events.slice(0, -1), { ...prev, delta: (prev.delta ?? "") + (ev.delta ?? "") }];
	}
	return [...events, ev];
}

// Append a streamed agent event (tool call / reasoning) to the active turn's timeline.
function pushEvent(id: string, ev: AgentEvent): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[])];
		const last = turns[turns.length - 1];
		turns[turns.length - 1] = { ...last, events: appendEvent(last.events, ev) };
		return { ...n, data: { ...n.data, turns } };
	});
}

/** Append a follow-up turn to an existing card and run it. Drives multi-turn chat. */
export function continueCard(id: string, prompt: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = [...(n.data.turns as Turn[]), { prompt, answer: "", events: [] }];
		return { ...n, data: { ...n.data, turns, streaming: true } };
	});
	void runModel(id);
}

/** Re-run the last turn from scratch (clears its answer + events). */
export function retryCard(id: string): void {
	flow.nodes = flow.nodes.map((n) => {
		if (n.id !== id) return n;
		const turns = n.data.turns as Turn[];
		const last = turns[turns.length - 1];
		const fresh = [...turns.slice(0, -1), { prompt: last.prompt, answer: "", events: [] }];
		return { ...n, data: { ...n.data, turns: fresh, streaming: true } };
	});
	void runModel(id);
}

/**
 * Run the card's active (last) turn. Context = canvas digest + ancestor threads +
 * this card's own prior turns + the new prompt. Streams into the active turn.
 */
export async function runModel(id: string): Promise<void> {
	const self = flow.nodes.find((n) => n.id === id);
	const selfData = self?.data as CardData | undefined;
	if (!selfData) return;

	const messages: ChatMessage[] = [];

	// Ancestor cards' full threads → the branch spine.
	const ancestors = ancestry(id, flow.edges);
	for (const aid of ancestors) {
		const node = flow.nodes.find((n) => n.id === aid);
		if (node && node.type === "card") pushTurns(messages, node.data as CardData);
	}

	// This card's prior turns (everything before the active one).
	const turns = selfData.turns;
	for (const t of turns.slice(0, -1)) {
		if (t.prompt) messages.push({ role: "user", content: t.prompt });
		if (t.answer) messages.push({ role: "assistant", content: t.answer });
	}

	// Active turn's prompt. Quote prefix only on the very first turn (branch origin).
	const active = turns[turns.length - 1];
	const firstTurn = turns.length === 1;
	const quote = firstTurn ? selfData.quote : undefined;
	const base = quote ? `Regarding this excerpt:\n\n> ${quote}\n\n${active.prompt}` : active.prompt;
	messages.push({ role: "user", content: base });

	const workflow = selfData.workflow ?? settings.workflow;
	const ancestorIds = new Set(ancestors);
	// Ancestors already sent as full message history.
	const connected = connectedDigest(id, ancestorIds, flow.nodes, flow.edges);
	const digest = canvasDigest(
		id,
		new Set([...ancestorIds, ...connectedIds(id, flow.edges)]),
		flow.nodes,
	);
	const systemPrompt = [workflowSystemPrompt(workflow), connected, digest]
		.filter(Boolean)
		.join("\n\n");

	let answer = "";
	const paint = makePainter((a, streaming) => setTurnAnswer(id, a, streaming));
	await runAgent(
		id,
		messages,
		{
			providers: activeLadder(),
			systemPrompt,
			workflow,
			bash: settings.bashEnabled,
			websearch: settings.websearch.enabled,
			websearchBackend: settings.websearch.backend,
			canvasTools: true,
			canvas: currentCanvasId(),
		},
		(e) => {
			switch (e.type) {
				case "text_delta":
					answer += e.delta ?? "";
					paint(answer, true);
					break;
				case "tool_start":
					applyCanvasTool(e);
					pushEvent(id, e);
					break;
				case "thinking_delta":
				case "tool_end":
					pushEvent(id, e);
					break;
				case "error":
					answer += `\n\n_[error: ${e.message}]_`;
					paint(answer, false);
					break;
				case "done":
					paint(answer, false);
					if (turns.length === 1) {
						void generateTitle(id, active.prompt, answer);
						void generateCanvasTitle();
					}
					triggerAutolink(id);
					break;
			}
		},
	);
}

// Strip quotes/trailing punctuation from a generated title.
function cleanTitle(raw: string): string {
	return raw
		.trim()
		.replace(/^["'`]+|["'`]+$/g, "")
		.replace(/[.!?]+$/, "")
		.trim();
}

async function generateTitle(id: string, prompt: string, answer: string): Promise<void> {
	const messages: ChatMessage[] = [
		{
			role: "user",
			content: `Write a short descriptive title (5 words max, no quotes, no trailing punctuation) that captures what this Q&A is about:\n\nQ: ${prompt.slice(0, 300)}\nA: ${answer.slice(0, 500)}`,
		},
	];
	let title = "";
	await runAgent(
		`__title_${id}`,
		messages,
		{ providers: activeLadder(), canvas: currentCanvasId() },
		(e) => {
			if (e.type === "text_delta") title += e.delta ?? "";
			else if (e.type === "done" && title.trim()) {
				const clean = cleanTitle(title);
				if (clean) {
					flow.nodes = flow.nodes.map((n) =>
						n.id === id ? { ...n, data: { ...n.data, title: clean } } : n,
					);
				}
			}
		},
	);
}

async function generateCanvasTitle(): Promise<void> {
	const currentId = currentCanvasId();
	const meta = library.list.find((c) => c.id === currentId);
	if (!meta || !/^Canvas \d+$/.test(meta.name)) return;
	const parts: string[] = [];
	for (const n of flow.nodes) {
		if (n.type === "card")
			parts.push(((n.data as CardData).title || lastTurn(n.data as CardData)?.prompt || "").trim());
		else if (n.type === "file")
			parts.push(((n.data as { filename: string }).filename || "").trim());
	}
	const content = parts.filter(Boolean).join(", ");
	if (!content) return;
	const messages: ChatMessage[] = [
		{
			role: "user",
			content: `Write a short descriptive title (5 words max, no quotes, no trailing punctuation) for a research canvas containing: ${content}`,
		},
	];
	let title = "";
	await runAgent("__canvas_title__", messages, { providers: activeLadder() }, (e) => {
		if (e.type === "text_delta") title += e.delta ?? "";
		else if (e.type === "done" && title.trim()) {
			const clean = cleanTitle(title);
			if (clean) void renameCanvas(currentId, clean);
		}
	});
}

// ── Hub session (canvas-wide agent chat) ────────────────────────────────────

// Create a finished Q&A card from agent output — no streaming, placed to the right
// of the rightmost existing node.
function createCardFromAgent(title: string, content: string): string {
	const id = nextNodeId();
	const maxX = flow.nodes.reduce((m, n) => Math.max(m, n.position.x + (n.width ?? 400)), 0);
	const position = { x: maxX > 0 ? maxX + 40 : 80, y: 80 };
	const data: CardData = {
		title,
		turns: [{ prompt: title, answer: content, events: [] }],
		streaming: false,
		block: nextBlock(),
	};
	flow.nodes = [...flow.nodes, buildCardNode({ kind: "card", id, position, data })];
	saveCanvas();
	triggerAutolink(id);
	return id;
}

// Replace an existing card's content. ref = node id OR case-insensitive title match.
// Q&A card → overwrites last turn's answer. Text card → overwrites body.
function updateCardContent(ref: string, content: string): boolean {
	const node =
		flow.nodes.find((n) => n.id === ref) ??
		flow.nodes.find((n) => {
			const d = n.data as Record<string, unknown>;
			return typeof d.title === "string" && d.title.toLowerCase() === ref.toLowerCase();
		});
	if (!node) return false;
	if (node.type === "text") {
		setCardText(node.id, content);
	} else {
		// Q&A card: replace last turn's answer (replace, not append — per user choice).
		flow.nodes = flow.nodes.map((n) => {
			if (n.id !== node.id) return n;
			const turns = [...(n.data.turns as Turn[])];
			turns[turns.length - 1] = { ...turns[turns.length - 1], answer: content };
			return { ...n, data: { ...n.data, turns, streaming: false } };
		});
	}
	saveCanvas();
	return true;
}

function setSessionAnswer(answer: string, streaming: boolean): void {
	const turns = [...session.turns];
	if (!turns.length) return;
	turns[turns.length - 1] = { ...turns[turns.length - 1], answer };
	session.turns = turns;
	session.streaming = streaming;
}

function pushSessionEvent(ev: AgentEvent): void {
	const turns = [...session.turns];
	if (!turns.length) return;
	const last = turns[turns.length - 1];
	turns[turns.length - 1] = { ...last, events: appendEvent(last.events, ev) };
	session.turns = turns;
}

// Apply a canvas tool invocation from a tool_start SSE event.
function applyCanvasTool(ev: AgentEvent): void {
	const args = ev.args as Record<string, string> | undefined;
	if (!args) return;
	if (ev.name === "create_card") {
		createCardFromAgent(args.title ?? "", args.content ?? "");
	} else if (ev.name === "create_note") {
		const maxX = flow.nodes.reduce((m, n) => Math.max(m, n.position.x + (n.width ?? 400)), 0);
		const pos = { x: maxX > 0 ? maxX + 40 : 80, y: 80 };
		const noteId = addTextCard(pos, args.content ?? "");
		saveCanvas();
		triggerAutolink(noteId);
	} else if (ev.name === "update_card") {
		updateCardContent(args.card ?? "", args.content ?? "");
	}
}

/** Run a hub session turn. Mirrors runModel but targets session state + canvasTools. */
export async function runSession(prompt: string): Promise<void> {
	session.turns = [...session.turns, { prompt, answer: "", events: [] }];
	session.streaming = true;
	saveCanvas();

	const messages: ChatMessage[] = [];
	for (const t of session.turns.slice(0, -1)) {
		if (t.prompt) messages.push({ role: "user", content: t.prompt });
		if (t.answer) messages.push({ role: "assistant", content: t.answer });
	}
	messages.push({ role: "user", content: prompt });

	const workflow = settings.workflow;
	const digest = canvasDigestWithIds(flow.nodes);
	const toolHint =
		"\n\n## Hub Session Rules\n" +
		'You are the canvas-level assistant. The full content of every canvas card is provided IN THIS SYSTEM PROMPT in the "Canvas cards" section below — read it directly to answer questions about card contents. ' +
		"DO NOT call knowledge_base_search to find card content; KB tools only work for files the user has explicitly uploaded (PDFs, docx, images, etc.), not for canvas cards.\n\n" +
		"**Bias toward action over clarification.** If the user's intent is clear enough to attempt, execute it immediately without asking questions. " +
		"Call create_card once per card you want to create — do not batch them into one card. " +
		"Ask a question only if you genuinely cannot proceed without the answer.\n\n" +
		"## Canvas Tools\n" +
		"- create_card(title, content): creates a new Q&A card on the canvas. Call this once per card — multiple calls = multiple cards.\n" +
		"- create_note(title?, content): creates a standalone markdown note card — for drafted prose, summaries, emails, outlines.\n" +
		"- update_card(card, content): replaces an existing card's content (use card id when available).";
	const systemPrompt = workflowSystemPrompt(workflow) + toolHint + (digest ? `\n\n${digest}` : "");

	let answer = "";
	const paint = makePainter(setSessionAnswer);
	await runAgent(
		"__session__",
		messages,
		{
			providers: activeLadder(),
			systemPrompt,
			workflow,
			bash: false,
			websearch: settings.websearch.enabled,
			websearchBackend: settings.websearch.backend,
			canvasTools: true,
			canvas: currentCanvasId(),
		},
		(e) => {
			switch (e.type) {
				case "text_delta":
					answer += e.delta ?? "";
					paint(answer, true);
					break;
				case "tool_start":
					applyCanvasTool(e);
					pushSessionEvent(e);
					break;
				case "thinking_delta":
				case "tool_end":
					pushSessionEvent(e);
					break;
				case "error":
					answer += `\n\n_[error: ${e.message}]_`;
					paint(answer, false);
					saveCanvas();
					break;
				case "done":
					paint(answer, false);
					saveCanvas();
					break;
			}
		},
	);
}

/**
 * Synthesize ≥2 selected cards into a new chat card: gathers their plain text
 * (prefixed `[Card: <title>]`), creates the card below the selection's bounding
 * box, and runs it under the `synthesize` workflow.
 */
export function synthesizeSelection(ids: string[]): string {
	const selected = flow.nodes.filter((n) => ids.includes(n.id));
	if (selected.length < 2) return "";

	const prompt = selected
		.map((n) => `[Card: ${cardTitle(n)}]\n${cardPlainText(n)}`)
		.join("\n\n---\n\n");

	const minX = Math.min(...selected.map((n) => n.position.x));
	const maxX = Math.max(...selected.map((n) => n.position.x + (n.width ?? 400)));
	const maxY = Math.max(...selected.map((n) => n.position.y + (n.height ?? 280)));
	const position = { x: (minX + maxX) / 2 - 200, y: maxY + 80 };

	const id = addCard(position, prompt, { workflow: "synthesize" });
	void runModel(id);
	return id;
}
