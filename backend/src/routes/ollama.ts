// Ollama local model management: list downloaded models + pull new ones.
import { Hono } from "hono";

export const ollamaRoutes = new Hono();

// Common install locations on macOS for ollama.
const OLLAMA_SEARCH_PATH = [
	"/opt/homebrew/bin",
	"/usr/local/bin",
	"/usr/bin",
	process.env.HOME ? `${process.env.HOME}/.local/bin` : "",
].filter(Boolean).join(":");

// Resolve ollama binary: prefer explicit common paths over PATH lookup,
// since the backend may be spawned by Tauri with a minimal PATH.
function ollamaCmd(...args: string[]): string[] {
	return ["/bin/sh", "-c", `export PATH="${OLLAMA_SEARCH_PATH}:$PATH"; ollama ${args.join(" ")}`];
}

// List models installed locally.
ollamaRoutes.get("/models", async (c) => {
	try {
		const proc = Bun.spawnSync(ollamaCmd("list"), { stdout: "pipe", stderr: "pipe" });
		if (proc.exitCode !== 0) return c.json({ models: [] });
		const models = proc.stdout
			.toString()
			.trim()
			.split("\n")
			.slice(1) // skip header row
			.map((l) => l.split(/\s+/)[0])
			.filter(Boolean);
		return c.json({ models });
	} catch {
		return c.json({ models: [] });
	}
});

// Pull a model — SSE stream of progress lines until done/error.
ollamaRoutes.post("/pull", async (c) => {
	const { model } = (await c.req.json()) as { model: string };
	if (!model?.trim()) return c.json({ error: "model required" }, 400);

	const { readable, writable } = new TransformStream<Uint8Array>();
	const writer = writable.getWriter();
	const enc = new TextEncoder();
	const emit = (ev: object) =>
		writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});

	(async () => {
		try {
			const proc = Bun.spawn(ollamaCmd("pull", model.trim()), {
				stdout: "pipe",
				stderr: "pipe"
			});

			// ollama writes progress to stdout; forward line by line (strip ANSI + CR).
			const pipe = async (stream: ReadableStream<Uint8Array>) => {
				const reader = stream.getReader();
				const dec = new TextDecoder();
				let buf = "";
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += dec.decode(value, { stream: true });
					// Split on newlines and carriage returns.
					const parts = buf.split(/[\r\n]+/);
					buf = parts.pop() ?? "";
					for (const line of parts) {
						// Strip ANSI escape codes.
						const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
						if (clean) emit({ type: "progress", text: clean });
					}
				}
				if (buf.trim()) emit({ type: "progress", text: buf.trim() });
			};

			await Promise.all([pipe(proc.stdout), pipe(proc.stderr)]);
			const exit = await proc.exited;
			if (exit === 0) emit({ type: "done" });
			else emit({ type: "error", message: `ollama pull exited with code ${exit}` });
		} catch (err) {
			emit({ type: "error", message: String(err) });
		} finally {
			writer.close().catch(() => {});
		}
	})();

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive"
		}
	});
});
