// Single client for the local TypeScript backend. The Tauri shell spawns the
// backend and exposes its {port, token} via the `backend_info` command; we learn
// that once, then every call carries the Bearer token so only this UI can drive
// the API. In browser-only dev (no Tauri) we hit a manually-started backend.

let cached: Promise<{ base: string; token: string }> | null = null;

function isTauri(): boolean {
	return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function connect(): Promise<{ base: string; token: string }> {
	if (isTauri()) {
		const { invoke } = await import('@tauri-apps/api/core');
		const info = await invoke<{ port: number; token: string }>('backend_info');
		return { base: `http://127.0.0.1:${info.port}`, token: info.token };
	}
	// Browser dev fallback: run `bun src/server.ts` in backend/ and pass its token.
	const token = (import.meta.env.VITE_BACKEND_TOKEN as string | undefined) ?? 'dev';
	return { base: 'http://127.0.0.1:8765', token };
}

// Resolve (and memoize) the backend base URL + token.
export function backend(): Promise<{ base: string; token: string }> {
	return (cached ??= connect());
}

// fetch against the backend with the auth header attached.
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const { base, token } = await backend();
	const headers = new Headers(init.headers);
	headers.set('Authorization', `Bearer ${token}`);
	return fetch(base + path, { ...init, headers });
}

// fetch + JSON, throwing on non-2xx.
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await apiFetch(path, init);
	if (!res.ok) throw new Error(`${path} → ${res.status} ${res.statusText}`);
	return res.json() as Promise<T>;
}

// PUT a JSON body. Returns the response (callers usually fire-and-forget).
export function apiPut(path: string, body: unknown): Promise<Response> {
	return apiFetch(path, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
}
