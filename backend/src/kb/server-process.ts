// Loom owns the Graphiti knowledge-base runtime. On startup we spawn two child
// processes (mirroring how the Rust shell spawns this backend):
//   1. FalkorDBLite launcher — embedded FalkorDB over TCP, persistent (AOF).
//   2. Graphiti MCP server   — uv run main.py, HTTP transport, talks to FalkorDB.
//
// The LLM/embedder config comes from the Loom settings page; the API key is read
// from the macOS keychain at spawn time and injected as an env var — it is never
// written to config.yaml on disk. restart() re-reads settings (called when the
// user changes KB settings).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../store/db.ts";
import { settings as settingsTable } from "../store/schema.ts";
import {
	GRAPHITI_DATA_DIR,
	GRAPHITI_LAUNCHER,
	GRAPHITI_MCP_DIR,
} from "../paths.ts";

const SERVICE = "app.loom.canvas";
const secret = (name: string) =>
	Bun.secrets.get({ service: SERVICE, name }).catch(() => null);

const MCP_PORT = Number(process.env.GRAPHITI_MCP_PORT || 8000);
const FALKOR_PORT = process.env.GRAPHITI_FALKOR_PORT || "6379";
export const MCP_ENDPOINT = `http://127.0.0.1:${MCP_PORT}/mcp/`;
const HEALTH_URL = `http://127.0.0.1:${MCP_PORT}/health`;
const CONFIG_PATH = join(GRAPHITI_MCP_DIR, "config.loom.yaml");

// ── Settings ─────────────────────────────────────────────────────────────────
export interface GraphitiSettings {
	llmProvider: "ollama" | "groq" | "gemini" | "custom";
	llmModel: string;
	llmApiBase: string; // only for custom OpenAI-compatible endpoints
	embedder: "ollama" | "gemini";
	embedderModel: string;
	ollamaUrl: string;
}

// Default: fully local (Ollama LLM + embedder), no API key, no rate limits.
// Groq's free tier can't fit graphiti's extraction prompt; Gemini (free, capable)
// and Groq stay selectable in Settings once a key is provided.
export const GRAPHITI_DEFAULTS: GraphitiSettings = {
	llmProvider: "ollama",
	// llama3.2:3b extracts clean entities/edges in seconds; smaller models (e.g.
	// gemma 2B) often extract nothing. Override in Settings for a stronger model.
	llmModel: "llama3.2:3b",
	llmApiBase: "",
	embedder: "ollama",
	embedderModel: "nomic-embed-text",
	ollamaUrl: "http://localhost:11434/v1",
};

// Google key may come from the keychain (Settings page) or, as a convenience,
// from a .env var (GOOGLE_API_KEY / GRAPHITI_GEMINI_API_KEY). Bun auto-loads .env.
const googleKey = async () =>
	(await secret("google")) || process.env.GOOGLE_API_KEY || process.env.GRAPHITI_GEMINI_API_KEY || "";

export function graphitiSettings(): GraphitiSettings {
	const row = db.select().from(settingsTable).where(eq(settingsTable.id, 1)).get();
	const all = row ? (JSON.parse(row.json) as { graphiti?: Partial<GraphitiSettings> }) : {};
	return { ...GRAPHITI_DEFAULTS, ...(all.graphiti ?? {}) };
}

// Known embedding dimensions. Graphiti needs this to match the model exactly.
const EMBED_DIMS: Record<string, number> = {
	"nomic-embed-text": 768,
	"mxbai-embed-large": 1024,
	"text-embedding-004": 768,
	"models/text-embedding-004": 768,
	"text-embedding-3-small": 1536,
	"text-embedding-3-large": 3072,
};
const dimsFor = (model: string) => EMBED_DIMS[model] ?? 768;

// ── config.yaml generation ─────────────────────────────────────────────────────
// Returns the YAML (secrets as ${ENV} placeholders) and the env map carrying the
// real secret values. Throws with a clear message if a required key is missing.
export async function buildConfig(
	s: GraphitiSettings,
	falkorUri: string,
): Promise<{ yaml: string; env: Record<string, string> }> {
	const env: Record<string, string> = {};
	let llmBlock: string;

	if (s.llmProvider === "ollama") {
		// Local, no key. graphiti talks to Ollama's OpenAI-compatible endpoint.
		env.GRAPHITI_LLM_KEY = "ollama";
		llmBlock = `  provider: "openai"
  model: "${s.llmModel}"
  max_tokens: 4096
  providers:
    openai:
      api_key: \${GRAPHITI_LLM_KEY}
      api_url: "${s.ollamaUrl}"`;
	} else if (s.llmProvider === "groq") {
		const key = await secret("groq");
		if (!key) throw new Error("No Groq API key saved. Add it in Settings.");
		env.GROQ_API_KEY = key;
		llmBlock = `  provider: "groq"
  model: "${s.llmModel}"
  max_tokens: 4096
  providers:
    groq:
      api_key: \${GROQ_API_KEY}
      api_url: "https://api.groq.com/openai/v1"`;
	} else if (s.llmProvider === "gemini") {
		const key = await googleKey();
		if (!key) throw new Error("No Google API key saved. Add it in Settings (or .env).");
		env.GOOGLE_API_KEY = key;
		llmBlock = `  provider: "gemini"
  model: "${s.llmModel}"
  max_tokens: 4096
  providers:
    gemini:
      api_key: \${GOOGLE_API_KEY}`;
	} else {
		// custom OpenAI-compatible endpoint
		const key = (await secret("graphiti_custom")) ?? "none";
		env.GRAPHITI_LLM_KEY = key;
		llmBlock = `  provider: "openai"
  model: "${s.llmModel}"
  max_tokens: 4096
  providers:
    openai:
      api_key: \${GRAPHITI_LLM_KEY}
      api_url: "${s.llmApiBase}"`;
	}

	let embBlock: string;
	if (s.embedder === "ollama") {
		env.EMBED_API_KEY = "ollama"; // dummy; Ollama ignores it
		embBlock = `  provider: "openai"
  model: "${s.embedderModel}"
  dimensions: ${dimsFor(s.embedderModel)}
  providers:
    openai:
      api_key: \${EMBED_API_KEY}
      api_url: "${s.ollamaUrl}"`;
	} else {
		const key = await googleKey();
		if (!key) throw new Error("No Google API key saved for Gemini embeddings. Add it in Settings (or .env).");
		env.GOOGLE_API_KEY = key;
		const model = s.embedderModel || "models/text-embedding-004";
		embBlock = `  provider: "gemini"
  model: "${model}"
  dimensions: ${dimsFor(model)}
  providers:
    gemini:
      api_key: \${GOOGLE_API_KEY}`;
	}

	// graphiti-core eagerly constructs an OpenAIRerankerClient at init whose
	// constructor requires a non-empty OPENAI_API_KEY. With the RRF search recipes
	// the MCP server uses, the reranker is never actually *called*, so a dummy key
	// satisfies the constructor with zero OpenAI network traffic. (If a future
	// version routes search through the cross-encoder, swap to a local BGE reranker.)
	if (!env.OPENAI_API_KEY) env.OPENAI_API_KEY = "sk-noop-reranker-unused";

	const yaml = `# Generated by Loom — do not edit by hand. Secrets are injected via env vars.
server:
  transport: "http"
  host: "127.0.0.1"
  port: ${MCP_PORT}
llm:
${llmBlock}
embedder:
${embBlock}
database:
  provider: "falkordb"
  providers:
    falkordb:
      uri: "${falkorUri}"
      database: "default_db"
graphiti:
  group_id: "main"
`;
	return { yaml, env };
}

// ── Process management ─────────────────────────────────────────────────────────
let falkor: Bun.Subprocess | null = null;
let mcp: Bun.Subprocess | null = null;
let ready = false;

export const graphitiReady = () => ready;

function resolveUv(): string | null {
	for (const c of ["uv", join(homedir(), ".local/bin/uv"), join(homedir(), ".cargo/bin/uv")]) {
		if (c === "uv" || existsSync(c)) return c;
	}
	return "uv";
}

// PATH for child processes: Homebrew + uv install locations (Tauri may launch
// Loom with a minimal PATH).
const childPath = [
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
	join(homedir(), ".local/bin"),
	join(homedir(), ".cargo/bin"),
	process.env.PATH ?? "",
].join(":");

async function readHandshake(proc: Bun.Subprocess, marker: string, timeoutMs: number): Promise<string> {
	const reader = (proc.stdout as ReadableStream).getReader();
	const dec = new TextDecoder();
	const scan = (async () => {
		let buf = "";
		for (;;) {
			const { value, done } = await reader.read();
			if (done) throw new Error("stream closed before handshake");
			buf += dec.decode(value, { stream: true });
			const line = buf.split("\n").find((l) => l.includes(marker));
			if (line) return line;
		}
	})();
	const timeout = new Promise<never>((_, rej) =>
		setTimeout(() => rej(new Error(`timed out waiting for '${marker}'`)), timeoutMs),
	);
	try {
		return await Promise.race([scan, timeout]);
	} finally {
		try {
			reader.releaseLock(); // throws if a read is still pending (after timeout) — ignore
		} catch {
			/* proc will be killed on failure */
		}
	}
}

async function waitHealth(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
			if (r.ok) return true;
		} catch {
			/* not up yet */
		}
		await Bun.sleep(2000);
	}
	return false;
}

export async function startGraphiti(): Promise<void> {
	if (!existsSync(GRAPHITI_LAUNCHER) || !existsSync(join(GRAPHITI_MCP_DIR, "main.py"))) {
		console.warn("[kb] Graphiti not installed (run setup_graphiti.sh) — knowledge base disabled.");
		return;
	}
	const uv = resolveUv();
	mkdirSync(GRAPHITI_DATA_DIR, { recursive: true });

	// 1. FalkorDBLite launcher → read the actual bound port from its handshake.
	falkor = Bun.spawn([uv!, "run", "python", GRAPHITI_LAUNCHER], {
		cwd: GRAPHITI_MCP_DIR,
		env: { ...process.env, PATH: childPath, FALKOR_PORT, FALKOR_DATA: GRAPHITI_DATA_DIR },
		stdout: "pipe",
		stderr: "inherit",
	});
	let falkorPort = FALKOR_PORT;
	try {
		const line = await readHandshake(falkor, "LOOM_FALKOR", 45000);
		falkorPort = String(JSON.parse(line.slice(line.indexOf("{"))).port);
	} catch (e) {
		console.warn(`[kb] FalkorDB handshake failed (${e}); assuming port ${FALKOR_PORT}.`);
	}
	const falkorUri = `redis://localhost:${falkorPort}`;

	// 2. Generate config.yaml from settings + spawn the MCP server.
	let cfg: { yaml: string; env: Record<string, string> };
	try {
		cfg = await buildConfig(graphitiSettings(), falkorUri);
	} catch (e) {
		console.warn(`[kb] cannot start Graphiti: ${(e as Error).message}`);
		await stopGraphiti();
		return;
	}
	writeFileSync(CONFIG_PATH, cfg.yaml);

	mcp = Bun.spawn([uv!, "run", "main.py", "--config", CONFIG_PATH, "--transport", "http"], {
		cwd: GRAPHITI_MCP_DIR,
		env: {
			...process.env,
			PATH: childPath,
			...cfg.env,
			SEMAPHORE_LIMIT: process.env.SEMAPHORE_LIMIT || "3", // groq free-tier 429 guard
			GRAPHITI_TELEMETRY_ENABLED: "false",
		},
		stdout: "inherit",
		stderr: "inherit",
	});

	ready = await waitHealth(90000);
	if (ready) console.log(`[kb] Graphiti MCP up at ${MCP_ENDPOINT} (FalkorDB ${falkorUri})`);
	else console.warn("[kb] Graphiti MCP did not become healthy in time — knowledge base degraded.");
}

export async function stopGraphiti(): Promise<void> {
	ready = false;
	for (const p of [mcp, falkor]) {
		try {
			p?.kill();
		} catch {
			/* ignore */
		}
	}
	mcp = null;
	falkor = null;
}

export async function restartGraphiti(): Promise<void> {
	await stopGraphiti();
	await Bun.sleep(500);
	await startGraphiti();
}
