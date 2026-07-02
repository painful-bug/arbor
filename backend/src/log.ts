// ponytail: leveled console wrapper, no dep — sidecar stays lean; swap for pino
// if log volume ever matters. The ARBOR_BACKEND handshake line in server.ts is
// protocol, not logging — it stays a raw console.log.
type Level = "info" | "warn" | "error";

const ORDER = { info: 0, warn: 1, error: 2 } as const;
const MIN: Level = (process.env.ARBOR_LOG_LEVEL as Level) ?? "info";

function emit(level: Level, scope: string, msg: string, data?: unknown) {
	if (ORDER[level] < ORDER[MIN]) return;
	const line = `[${scope}] ${msg}`;
	if (data === undefined) console[level](line);
	else console[level](line, data);
}

/** Structured, leveled logger. Scope = module tag, e.g. "kb", "agent". */
export const log = {
	info: (s: string, m: string, d?: unknown) => emit("info", s, m, d),
	warn: (s: string, m: string, d?: unknown) => emit("warn", s, m, d),
	error: (s: string, m: string, d?: unknown) => emit("error", s, m, d),
};
