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
	ragSearchTool,
	createCardTool,
	createNoteTool,
	updateCardTool
} from "./tools.ts";
import { search as ragSearch } from "../rag/index.ts";

const SERVICE = "app.loom.canvas";
const key = (name: string) => Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

// One Agent per running card. Cancel aborts via agent.abort().
export const runs = new Map<string, Agent>();

export interface AgentEvent {
	type: "text_delta" | "thinking_delta" | "tool_start" | "tool_end" | "done" | "error";
	id: string;
	delta?: string;
	message?: string;
	toolId?: string;
	name?: string;
	args?: unknown;
	ok?: boolean;
	detail?: string;
}

export interface PromptRequest {
	cardId: string;
	messages: { role: "user" | "assistant"; content: string }[];
	provider: string;
	model: string;
	systemPrompt?: string;
	workflow?: string;
	bash?: boolean;
	websearch?: boolean;
	websearchBackend?: "duckduckgo" | "tavily";
	canvas?: string; // which canvas's RAG index to search; defaults to "default"
	canvasTools?: boolean; // enable create_card / update_card (hub session only)
}

// Condense a tool result into a one-line timeline detail.
function detailOf(result: unknown): string | undefined {
	const content = (result as { content?: { type: string; text?: string }[] })?.content;
	const text = content?.find((c) => c.type === "text")?.text;
	if (!text) return undefined;
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length > 200 ? oneLine.slice(0, 200) + "…" : oneLine;
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
	const canvas = req.canvas ?? "default";

	try {
		const apiKey = await key(req.provider);
		if (!apiKey && req.provider !== "ollama") {
			emit({ type: "error", id: cardId, message: `No API key saved for '${req.provider}'. Add it in Settings.` });
			return;
		}
		// pi-ai rejects empty-string keys even for local providers; pass a dummy value.
		const effectiveKey = apiKey ?? "ollama";

		const tavilyKey = (await key("tavily")) ?? undefined;
		const model = buildModel(req.provider, req.model);

		// Build tools the same way the sidecar did.
		const all = createCodingTools(process.cwd());
		const tools = req.bash ? all : all.filter((t) => t.name !== "bash");
		if (req.websearch) {
			tools.push(webSearchTool(req.websearchBackend ?? "duckduckgo", tavilyKey));
		}
		tools.push(scholarSearchTool(), researchPlanTool());
		// ragSearch is now in-process — no stdio, no HTTP bridge.
		tools.push(ragSearchTool((query) => ragSearch(canvas, query)));
		if (req.canvasTools) tools.push(createCardTool(), createNoteTool(), updateCardTool());

		const agent = new Agent({
			streamFn: streamSimple,
			getApiKey: () => effectiveKey,
			convertToLlm: (messages) => messages as Message[],
			initialState: {
				systemPrompt: req.systemPrompt ?? "",
				model,
				tools,
				messages: toLlmMessages(req.messages, model) as AgentMessage[]
			}
		});

		runs.set(cardId, agent);

		agent.subscribe((ev: PiEvent) => {
			switch (ev.type) {
				case "message_update": {
					const a = ev.assistantMessageEvent;
					if (a.type === "text_delta") emit({ type: "text_delta", id: cardId, delta: a.delta });
					else if (a.type === "thinking_delta") emit({ type: "thinking_delta", id: cardId, delta: a.delta });
					else if (a.type === "error")
						emit({ type: "error", id: cardId, message: a.error?.errorMessage ?? a.reason ?? "stream error" });
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
		if (err) emit({ type: "error", id: cardId, message: err });
		else emit({ type: "done", id: cardId });
	} catch (err) {
		emit({ type: "error", id: cardId, message: String((err as Error)?.message ?? err) });
	} finally {
		runs.delete(cardId);
	}
}
