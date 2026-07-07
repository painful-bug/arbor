// Ollama local model management: list downloaded models + pull new ones.
import { Hono } from "hono";
import { ollamaBinName, ollamaSearchDirs, PATH_SEP } from "../platform.ts";

export const ollamaRoutes = new Hono();

/**
 * Absolute path to the ollama binary, or null when not installed. Searches
 * ARBOR_OLLAMA_DIR (test hook), the common per-OS install locations, then the
 * inherited PATH — the backend may be spawned by Tauri with a minimal PATH.
 * Spawning the resolved binary directly (no shell wrapper) means proc.kill()
 * reaches ollama itself, not an intermediate sh.
 */
function ollamaBin(): string | null {
	const dirs = [process.env.ARBOR_OLLAMA_DIR, ...ollamaSearchDirs(), process.env.PATH].filter(
		Boolean,
	);
	return Bun.which(ollamaBinName, { PATH: dirs.join(PATH_SEP) });
}

// List models installed locally.
ollamaRoutes.get("/models", async (c) => {
	try {
		const bin = ollamaBin();
		if (!bin) return c.json({ models: [] });
		const proc = Bun.spawnSync([bin, "list"], { stdout: "pipe", stderr: "pipe" });
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
		// justified: missing/broken ollama degrades to an empty model list.
		return c.json({ models: [] });
	}
});

// Pull a model — SSE stream of progress lines until done/error. The subprocess
// is killed when the client disconnects so an abandoned pull doesn't keep
// downloading gigabytes.
ollamaRoutes.post("/pull", async (c) => {
	const { model } = (await c.req.json()) as { model: string };
	if (!model?.trim()) return c.json({ error: "model required" }, 400);

	const { readable, writable } = new TransformStream<Uint8Array>();
	const writer = writable.getWriter();
	const enc = new TextEncoder();
	const emit = (ev: object) =>
		// justified: a failed write means the stream already closed.
		writer.write(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)).catch(() => {});

	(async () => {
		let proc: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
		try {
			const bin = ollamaBin();
			if (!bin) {
				emit({ type: "error", message: "ollama binary not found" });
				return;
			}
			proc = Bun.spawn([bin, "pull", model.trim()], {
				stdout: "pipe",
				stderr: "pipe",
			});
			// Client gone (cancel, window closed) → stop the download immediately.
			c.req.raw.signal.addEventListener("abort", () => proc?.kill());

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
						// biome-ignore lint/suspicious/noControlCharactersInRegex: \x1b is the ANSI escape prefix being stripped
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
			proc?.kill();
			emit({ type: "error", message: String(err) });
		} finally {
			writer.close().catch(() => {}); // justified: double-close is a no-op we ignore.
		}
	})();

	return new Response(readable, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
});
