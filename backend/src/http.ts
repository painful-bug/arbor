import { FETCH_BYTES_TIMEOUT_MS, HTTP_TIMEOUT_MS } from "./config.ts";
import { AppError } from "./errors.ts";

async function fetchOk(url: string, init?: RequestInit, timeoutMs = HTTP_TIMEOUT_MS) {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }).catch((e) => {
		throw e?.name === "TimeoutError"
			? new AppError(`timeout: ${url}`, 504, "UPSTREAM_TIMEOUT")
			: new AppError(`fetch failed: ${url}: ${e?.message}`, 502, "UPSTREAM");
	});
	if (!res.ok) throw new AppError(`${res.status} from ${url}`, 502, "UPSTREAM");
	return res;
}

/**
 * fetch → parsed JSON with timeout. Throws AppError(502, "UPSTREAM") on non-2xx
 * or network failure; AppError(504, "UPSTREAM_TIMEOUT") on timeout.
 */
export async function fetchJson<T>(
	url: string,
	init?: RequestInit,
	timeoutMs = HTTP_TIMEOUT_MS,
): Promise<T> {
	const res = await fetchOk(url, init, timeoutMs);
	return res.json() as Promise<T>;
}

/** Same contract as fetchJson, but returns the raw response body text. */
export async function fetchText(
	url: string,
	init?: RequestInit,
	timeoutMs = HTTP_TIMEOUT_MS,
): Promise<string> {
	const res = await fetchOk(url, init, timeoutMs);
	return res.text();
}

/** Same contract as fetchJson, but returns the raw response bytes (file downloads/exports). */
export async function fetchBytes(
	url: string,
	init?: RequestInit,
	timeoutMs = FETCH_BYTES_TIMEOUT_MS,
): Promise<Uint8Array> {
	const res = await fetchOk(url, init, timeoutMs);
	return new Uint8Array(await res.arrayBuffer());
}
