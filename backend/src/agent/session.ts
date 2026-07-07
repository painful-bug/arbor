// AgentSession builder — wraps pi-coding-agent's headless SDK so one canvas run
// gets the library's real per-model specs + built-in auto-compaction instead of the
// hand-rolled Agent loop. Everything is in-memory: no session files, no auth.json,
// no models.json on disk — keys come from Bun.secrets (run.ts) and are seeded into an
// in-memory AuthStorage, so directive #7 (secrets never touch disk) still holds.

import { join } from "node:path";
import type { AgentTool, ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Api, Model } from "@mariozechner/pi-ai";
import {
	type AgentSession,
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	defineTool,
	ModelRegistry,
	SessionManager,
	SettingsManager,
	type ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { ARBOR_DIR } from "../paths.ts";
import { PROVIDERS } from "./providers.ts";

// Isolated agent dir so DefaultResourceLoader never picks up the user's ~/.pi/agent
// extensions/skills. With the no* flags below it's barely touched, but keep it separate.
const AGENT_DIR = join(ARBOR_DIR, "pi-agent");

// Reasoning-model detection by id. These emit chain-of-thought that must be routed to
// thinking_delta (reasoning:true) instead of leaking in-band as answer text and eating
// the output budget — the root cause of long threads stopping mid-thought.
const REASONING_RE =
	/nemotron|deepseek|(^|[-/])r1\b|qwq|qwen.*think|gpt-oss|magistral|(^|[-/])o[134]\b|gemini-2\.5|thinking|reason/i;

export function isReasoningModel(id: string): boolean {
	return REASONING_RE.test(id);
}

// Build the pi-ai Model for a provider/model id, with reasoning detected from the id.
// contextWindow is a generous default — AgentSession's overflow-triggered compaction is
// the real safety net when the true window is smaller.
// ponytail: fixed 128k contextWindow; per-model catalog only if compaction fires too late.
export function buildAgentModel(provider: string, modelId: string): Model<Api> {
	const def = PROVIDERS[provider];
	if (!def) throw new Error(`unknown provider '${provider}'`);
	const id = modelId || def.defaultModel;
	const reasoning = isReasoningModel(id);
	return {
		id,
		name: id,
		api: def.api,
		provider,
		baseUrl: def.baseUrl,
		reasoning,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128000,
		// Reasoning models need headroom for the CoT + the answer in one response.
		maxTokens: reasoning ? 32000 : 16384,
	} as Model<Api>;
}

// Adapt one of Arbor's AgentTools to pi-coding-agent's ToolDefinition. The only real
// difference is ToolDefinition.execute takes a trailing ExtensionContext we ignore.
function toDefinition(t: AgentTool): ToolDefinition {
	return defineTool({
		name: t.name,
		label: t.label,
		description: t.description,
		parameters: t.parameters,
		executionMode: t.executionMode,
		execute: (id, params, signal, onUpdate) => t.execute(id, params, signal, onUpdate),
	});
}

export interface BuildSessionOptions {
	provider: string;
	model: string;
	apiKey: string;
	systemPrompt: string; // Arbor's per-workflow prompt (used verbatim as the base prompt)
	tools: AgentTool[]; // custom tools (KB/web/scholar/research/card)
	bash: boolean; // enable the built-in bash tool
	thinkingLevel?: ThinkingLevel;
}

// A neutral fallback so the session never falls back to pi's "expert coding assistant"
// default prompt when Arbor sends no workflow prompt (rare — the UI always sends one).
const DEFAULT_PROMPT =
	"You are a helpful research assistant working on an infinite canvas. Answer clearly and use the available tools when they help.";

// Build a configured AgentSession for one ladder rung. Auto-compaction is enabled so
// long runs summarise older context instead of overflowing and stopping.
export async function buildSession(opts: BuildSessionOptions): Promise<AgentSession> {
	const cwd = process.cwd();

	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(opts.provider, opts.apiKey);
	const modelRegistry = ModelRegistry.inMemory(authStorage);

	const settingsManager = SettingsManager.inMemory();
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: AGENT_DIR,
		settingsManager,
		// customPrompt: used verbatim; buildSystemPrompt only appends date + cwd lines.
		systemPrompt: opts.systemPrompt.trim() || DEFAULT_PROMPT,
		appendSystemPrompt: [],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();

	const model = buildAgentModel(opts.provider, opts.model);
	const customTools = opts.tools.map(toDefinition);
	const builtin = opts.bash ? ["read", "bash", "edit", "write"] : ["read", "edit", "write"];
	const allowed = [...builtin, ...opts.tools.map((t) => t.name)];

	const { session } = await createAgentSession({
		cwd,
		agentDir: AGENT_DIR,
		authStorage,
		modelRegistry,
		settingsManager,
		sessionManager: SessionManager.inMemory(cwd),
		resourceLoader,
		model,
		thinkingLevel: opts.thinkingLevel ?? "medium",
		customTools,
		tools: allowed,
	});

	session.setAutoCompactionEnabled(true);
	return session;
}
