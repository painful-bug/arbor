// Agent runner — the sidecar's handlePrompt loop, moved in-process.
// Keys come from Bun.secrets instead of being injected per-call by Rust.
// Emits AgentEvent objects to the caller (caller streams them as SSE).
import { streamSimple, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import { Agent, type AgentEvent as PiEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { createCodingTools } from "@mariozechner/pi-coding-agent";
import { buildModel } from "./providers.ts";
import {
	webSearchTool,
	scholarSearchTool,
	researchPlanTool,
	knowledgeBaseSearchTool,
	knowledgeBaseOverviewTool,
	knowledgeBaseReadSourceTool,
	createCardTool,
	createNoteTool,
	updateCardTool
} from "./tools.ts";
import { searchGraded as kbSearchGraded, addChat, contentsOf, readSource } from "../kb/index.ts";

const SERVICE = "app.arbor.canvas";
const key = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

// One Agent per running card. Cancel aborts via agent.abort().
export const runs = new Map<string, Agent>();

export interface AgentEvent {
	type: "text_delta" | "thinking_delta" | "tool_start" | "tool_end" | "provider_switch" | "done" | "error";
	id: string;
	delta?: string;
	message?: string;
	toolId?: string;
	name?: string;
	args?: unknown;
	ok?: boolean;
	detail?: string;
	provider?: string; // set on provider_switch: the rung being switched to
	model?: string;
}

export interface PromptRequest {
	cardId: string;
	messages: { role: "user" | "assistant"; content: string }[];
	providers: { provider: string; model: string }[]; // ladder, tried in order; falls back on rate-limit
	systemPrompt?: string;
	workflow?: string;
	bash?: boolean;
	websearch?: boolean;
	websearchBackend?: "duckduckgo" | "tavily";
	canvas?: string; // which canvas's KB group to search; defaults to "default"
	canvasTools?: boolean; // enable create_card / update_card (hub session only)
}

// Matches provider rate-limit / quota errors only — other failures (bad key, bad
// request, content filter) surface immediately instead of silently trying the next rung.
const RATE_LIMIT_RE = /\b429\b|rate.?limit|too many requests|quota exceeded|RESOURCE_EXHAUSTED/i;

// Condense a tool result into a one-line timeline detail.
function detailOf(result: unknown): string | undefined {
	const content = (result as { content?: { type: string; text?: string }[] })?.content;
	const text = content?.find((c) => c.type === "text")?.text;
	if (!text) return undefined;
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine;
}

// Rewrite the provider's raw "400 ... input tokens ... context length" error into
// something a user can act on. Trimming above keeps this from firing in the normal
// case; it's a backstop for single turns too big to trim (e.g. one huge paste).
function friendlyError(message: string): string {
	if (/input tokens|context length|maximum input length/i.test(message)) {
		return "This conversation is too long for the model's context window, even after trimming older turns. Start a new conversation, or shorten this message — earlier turns are still searchable via the knowledge base.";
	}
	return message;
}

// ponytail: no real tokenizer wired in — ~4 chars/token is the standard rough
// estimate, good enough to stay under context windows without truncating mid-word.
function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

// Drop oldest turns until the conversation fits the model's context window. Safe to
// lose old turns from the prompt: every turn is also ingested into the canvas KB
// (see addChat below), so the agent can kb_search its way back to anything trimmed.
function trimToContext(
	msgs: { role: "user" | "assistant"; content: string }[],
	systemPrompt: string,
	model: Model<Api>
): { role: "user" | "assistant"; content: string }[] {
	const budget = (model.contextWindow ?? 128000) - (model.maxTokens ?? 16384) - 2000;
	let total = estimateTokens(systemPrompt);
	const kept: { role: "user" | "assistant"; content: string }[] = [];
	for (let i = msgs.length - 1; i >= 0; i--) {
		const t = estimateTokens(msgs[i].content);
		if (kept.length > 0 && total + t > budget) break; // always keep at least the latest turn
		total += t;
		kept.unshift(msgs[i]);
	}
	return kept;
}

// The webview sends plain {role, content:string} messages. pi-ai wants assistant
// content as a block array; promote each assistant turn so follow-up turns don't crash.
function toLlmMessages(
	msgs: { role: "user" | "assistant"; content: string }[],
	model: Model<Api>
): Message[] {
	const now = Date.now();
	return msgs.map((m): Message => {
		if (m.role === "assistant") {
			return {
				role: "assistant",
				content: [{ type: "text", text: m.content }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
				},
				stopReason: "stop",
				timestamp: now
			};
		}
		return { role: "user", content: m.content, timestamp: now };
	});
}

export async function handlePrompt(
	req: PromptRequest,
	emit: (e: AgentEvent) => void
): Promise<void> {
	const { cardId } = req;
	const canvas = req.canvas || "default";
	const ladder = req.providers ?? [];

	if (ladder.length === 0) {
		emit({ type: "error", id: cardId, message: "No provider configured. Add one in Settings." });
		return;
	}

	try {
		const tavilyKey = (await key("tavily")) ?? undefined;

		// Tools are provider-independent — build once, reuse across ladder rungs.
		const all = createCodingTools(process.cwd());
		const tools = req.bash ? all : all.filter((t) => t.name !== "bash");
		if (req.websearch) {
			tools.push(webSearchTool(req.websearchBackend ?? "duckduckgo", tavilyKey));
		}
		tools.push(scholarSearchTool(), researchPlanTool());
		// KB search + overview + full-source read via local hybrid RAG (LanceDB).
		tools.push(knowledgeBaseSearchTool((query) => kbSearchGraded(canvas, query)));
		tools.push(knowledgeBaseOverviewTool(() => contentsOf(canvas)));
		tools.push(knowledgeBaseReadSourceTool((source) => readSource(canvas, source)));
		if (req.canvasTools) tools.push(createCardTool(), createNoteTool(), updateCardTool());

		const systemPrompt = req.systemPrompt ?? "";
		let lastError: string | undefined;

		for (let i = 0; i < ladder.length; i++) {
			const rung = ladder[i];
			const apiKey = await key(rung.provider);
			if (!apiKey && rung.provider !== "ollama") {
				lastError = `No API key saved for '${rung.provider}'.`;
				continue; // auto-skip rungs with no saved key
			}
			// pi-ai rejects empty-string keys even for local providers; pass a dummy value.
			const effectiveKey = apiKey ?? "ollama";
			const model = buildModel(rung.provider, rung.model);
			const trimmedMessages = trimToContext(req.messages, systemPrompt, model);

			const agent = new Agent({
				streamFn: streamSimple,
				getApiKey: () => effectiveKey,
				convertToLlm: (messages) => messages as Message[],
				toolExecution: "parallel",
				initialState: {
					systemPrompt,
					model,
					tools,
					messages: toLlmMessages(trimmedMessages, model) as AgentMessage[]
				}
			});

			runs.set(cardId, agent);

			// Accumulate the response text so we can ingest the turn into the KB.
			let answerText = "";

			agent.subscribe((ev: PiEvent) => {
				switch (ev.type) {
					case "message_update": {
						const a = ev.assistantMessageEvent;
						if (a.type === "text_delta") {
							answerText += a.delta ?? "";
							emit({ type: "text_delta", id: cardId, delta: a.delta });
						} else if (a.type === "thinking_delta") {
							emit({ type: "thinking_delta", id: cardId, delta: a.delta });
						} else if (a.type === "error") {
							emit({ type: "error", id: cardId, message: a.error?.errorMessage ?? a.reason ?? "stream error" });
						}
						break;
					}
					case "tool_execution_start":
						emit({ type: "tool_start", id: cardId, toolId: ev.toolCallId, name: ev.toolName, args: ev.args });
						break;
					case "tool_execution_end":
						emit({ type: "tool_end", id: cardId, toolId: ev.toolCallId, ok: !ev.isError, detail: detailOf(ev.result) });
						break;
				}
			});

			await agent.continue();
			const err = agent.state.errorMessage;
			if (!err) {
				emit({ type: "done", id: cardId });
				// Ingest this conversation turn into the canvas KB (fire-and-forget).
				const userPrompt = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
				if (userPrompt && answerText) void addChat(canvas, cardId, userPrompt, answerText);
				return;
			}

			lastError = err;
			const next = ladder[i + 1];
			if (RATE_LIMIT_RE.test(err) && next) {
				emit({
					type: "provider_switch",
					id: cardId,
					provider: next.provider,
					model: next.model,
					message: `Rate-limited on ${rung.provider} — falling back to ${next.provider}.`
				});
				continue;
			}
			// Non-rate-limit error, or the last rung just failed: surface it and stop.
			emit({ type: "error", id: cardId, message: friendlyError(err) });
			return;
		}

		// Every rung was either skipped (no key) or rate-limited.
		emit({ type: "error", id: cardId, message: friendlyError(lastError ?? "All providers in the ladder failed.") });
	} catch (err) {
		emit({ type: "error", id: cardId, message: friendlyError(String((err as Error)?.message ?? err)) });
	} finally {
		runs.delete(cardId);
	}
}
