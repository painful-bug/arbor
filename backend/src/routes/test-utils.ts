import { createApp } from "../server.ts";

export function makeTestApp(token: string) {
	const app = createApp(token);
	const api = (path: string, init?: RequestInit) =>
		app.fetch(
			new Request(`http://localhost${path}`, {
				...init,
				headers: { Authorization: `Bearer ${token}`, ...(init?.headers ?? {}) }
			})
		);
	return { app, api };
}
