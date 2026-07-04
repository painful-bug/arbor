// Ollama route tests against a fake `ollama` shell script (no real ollama
// needed). ARBOR_OLLAMA_DIR points binary resolution at the fake.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeTestApp } from "./test-utils.ts";

const { api } = makeTestApp("test-ollama-token");

const dir = mkdtempSync(join(tmpdir(), "arbor-ollama-"));
const pidFile = join(dir, "pull.pid");

const SCRIPT = `#!/bin/sh
case "$1" in
	list)
		printf 'NAME\\tID\\tSIZE\\tMODIFIED\\n'
		printf 'llama3:latest\\tabc\\t4GB\\tnow\\n'
		printf 'phi3:mini\\tdef\\t2GB\\tnow\\n'
		;;
	pull)
		echo "$$" > "${pidFile}"
		echo "pulling manifest"
		sleep 30
		;;
esac
`;

beforeAll(() => {
	writeFileSync(join(dir, "ollama"), SCRIPT);
	chmodSync(join(dir, "ollama"), 0o755);
	process.env.ARBOR_OLLAMA_DIR = dir;
});

afterAll(() => {
	delete process.env.ARBOR_OLLAMA_DIR;
	rmSync(dir, { recursive: true, force: true });
});

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe("ollama routes", () => {
	it("GET /api/ollama/models parses the list output", async () => {
		const res = await api("/api/ollama/models");
		expect(res.status).toBe(200);
		const body = (await res.json()) as { models: string[] };
		expect(body.models).toEqual(["llama3:latest", "phi3:mini"]);
	});

	it("POST /api/ollama/pull rejects a missing model name", async () => {
		const res = await api("/api/ollama/pull", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "  " }),
		});
		expect(res.status).toBe(400);
	});

	it("client abort kills the pull subprocess within 1s", async () => {
		const ac = new AbortController();
		const res = await api("/api/ollama/pull", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ model: "llama3" }),
			signal: ac.signal,
		});
		expect(res.status).toBe(200);

		// Wait for the first progress event — the script writes its PID before it.
		const reader = res.body!.getReader();
		const { value } = await reader.read();
		expect(new TextDecoder().decode(value)).toContain("pulling manifest");
		const pid = Number(readFileSync(pidFile, "utf8").trim());
		expect(alive(pid)).toBe(true);

		ac.abort();
		let dead = false;
		for (let i = 0; i < 20 && !dead; i++) {
			await Bun.sleep(50);
			dead = !alive(pid);
		}
		expect(dead).toBe(true);
	}, 10_000);
});
