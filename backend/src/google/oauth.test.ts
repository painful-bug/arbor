// Google OAuth tests. Every test injects a fake `deps` (fetch + in-memory
// secret store) — never the real Bun.secrets keychain, which can pop a GUI
// prompt on first write and would hang an automated run.
import { describe, expect, it } from "bun:test";
import {
	authStatus,
	challengeFromVerifier,
	getAccessToken,
	logout,
	type OAuthDeps,
	pkcePair,
	startAuth,
	startLoopback,
} from "./oauth.ts";

function fakeDeps(overrides: Partial<OAuthDeps> = {}): OAuthDeps {
	const store = new Map<string, string>();
	return {
		fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
		secretGet: async (name) => store.get(name) ?? null,
		secretSet: async (name, value) => {
			store.set(name, value);
		},
		secretDelete: async (name) => {
			store.delete(name);
		},
		now: () => 1_000_000,
		loopbackTimeoutMs: 5000,
		...overrides,
	};
}

describe("PKCE", () => {
	it("computes a fixed S256 challenge for a known verifier (RFC 7636 §4.2 algorithm)", () => {
		expect(challengeFromVerifier("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		);
	});

	it("pkcePair produces a base64url verifier whose challenge matches", () => {
		const { verifier, challenge } = pkcePair();
		expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(challenge).toBe(challengeFromVerifier(verifier));
	});

	it("pkcePair is random across calls", () => {
		expect(pkcePair().verifier).not.toBe(pkcePair().verifier);
	});
});

describe("startLoopback", () => {
	it("resolves the code on a matching redirect and stops the server", async () => {
		const deps = fakeDeps();
		const { redirectUri, result } = startLoopback("state-abc", deps);
		const res = await fetch(`${redirectUri}?code=abc123&state=state-abc`);
		expect(res.status).toBe(200);
		const r = await result;
		expect(r.code).toBe("abc123");
		// Server already stopped — a further request must fail to connect.
		await Bun.sleep(20);
		await expect(fetch(redirectUri)).rejects.toThrow();
	});

	it("rejects on a state mismatch without resolving", async () => {
		const deps = fakeDeps({ loopbackTimeoutMs: 50 });
		const { redirectUri, result } = startLoopback("expected", deps);
		result.catch(() => {}); // this test never sends a matching redirect — it times out shortly after
		const res = await fetch(`${redirectUri}?code=x&state=wrong`);
		expect(res.status).toBe(400);
	});

	it("rejects when Google redirects with ?error=", async () => {
		const deps = fakeDeps();
		const { redirectUri, result } = startLoopback("state-x", deps);
		result.catch(() => {}); // attach a handler before triggering the rejection below
		await fetch(`${redirectUri}?error=access_denied&state=state-x`);
		await expect(result).rejects.toThrow(/denied/);
	});
});

describe("startAuth", () => {
	it("builds a PKCE auth URL and completes the exchange in the background", async () => {
		const store = new Map<string, string>();
		let exchangeCalled = false;
		const deps = fakeDeps({
			secretGet: async (name) => store.get(name) ?? null,
			secretSet: async (name, value) => {
				store.set(name, value);
			},
			fetchImpl: (async (url: string) => {
				if (String(url).includes("oauth2.googleapis.com/token")) {
					exchangeCalled = true;
					return new Response(
						JSON.stringify({ access_token: "at1", refresh_token: "rt1", expires_in: 3600 }),
						{ status: 200 },
					);
				}
				return new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 });
			}) as unknown as typeof fetch,
		});
		process.env.ARBOR_GOOGLE_CLIENT_ID = "test-client";
		const { authUrl } = await startAuth(deps);
		expect(authUrl).toContain("code_challenge_method=S256");
		expect(authUrl).toContain("client_id=test-client");
		const u = new URL(authUrl);
		const redirectUri = u.searchParams.get("redirect_uri")!;
		const state = u.searchParams.get("state")!;

		await fetch(`${redirectUri}?code=abc&state=${state}`);
		// Background exchange runs async — poll briefly for it to land.
		for (let i = 0; i < 20 && !exchangeCalled; i++) await Bun.sleep(10);
		expect(exchangeCalled).toBe(true);

		for (let i = 0; i < 20 && !store.has("google-oauth"); i++) await Bun.sleep(10);
		const status = await authStatus(deps);
		expect(status).toEqual({ connected: true, email: "user@example.com" });
		delete process.env.ARBOR_GOOGLE_CLIENT_ID;
	});

	it("throws GOOGLE_NO_CLIENT when no client id is configured anywhere", async () => {
		delete process.env.ARBOR_GOOGLE_CLIENT_ID;
		await expect(startAuth(fakeDeps())).rejects.toMatchObject({ code: "GOOGLE_NO_CLIENT" });
	});
});

describe("authStatus / logout", () => {
	it("reports disconnected with no stored tokens", async () => {
		expect(await authStatus(fakeDeps())).toEqual({ connected: false });
	});

	it("logout clears stored tokens even if revoke fails", async () => {
		const store = new Map([
			["google-oauth", JSON.stringify({ access: "a", refresh: "r", expiry: 0 })],
		]);
		const deps = fakeDeps({
			secretGet: async (name) => store.get(name) ?? null,
			secretDelete: async (name) => {
				store.delete(name);
			},
			fetchImpl: (async () => {
				throw new Error("network down");
			}) as unknown as typeof fetch,
		});
		await logout(deps);
		expect(store.has("google-oauth")).toBe(false);
	});
});

describe("getAccessToken", () => {
	it("returns the cached access token when far from expiry", async () => {
		const store = new Map([
			[
				"google-oauth",
				JSON.stringify({ access: "cached", refresh: "r", expiry: 1_000_000 + 3_600_000 }),
			],
		]);
		const deps = fakeDeps({ secretGet: async (name) => store.get(name) ?? null });
		expect(await getAccessToken(deps)).toBe("cached");
	});

	it("refreshes when within 60s of expiry and persists the new token", async () => {
		const store = new Map([
			["google-oauth", JSON.stringify({ access: "old", refresh: "r1", expiry: 1_000_000 + 1000 })],
		]);
		const deps = fakeDeps({
			secretGet: async (name) => store.get(name) ?? null,
			secretSet: async (name, value) => {
				store.set(name, value);
			},
			fetchImpl: (async () =>
				new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), {
					status: 200,
				})) as unknown as typeof fetch,
		});
		expect(await getAccessToken(deps)).toBe("fresh");
		expect(JSON.parse(store.get("google-oauth")!).access).toBe("fresh");
	});

	it("single-flights concurrent refreshes into one token request", async () => {
		const store = new Map([
			["google-oauth", JSON.stringify({ access: "old", refresh: "r1", expiry: 1_000_000 + 1000 })],
		]);
		let calls = 0;
		const deps = fakeDeps({
			secretGet: async (name) => store.get(name) ?? null,
			secretSet: async (name, value) => {
				store.set(name, value);
			},
			fetchImpl: (async () => {
				calls++;
				return new Response(JSON.stringify({ access_token: "fresh", expires_in: 3600 }), {
					status: 200,
				});
			}) as unknown as typeof fetch,
		});
		const [a, b] = await Promise.all([getAccessToken(deps), getAccessToken(deps)]);
		expect(a).toBe("fresh");
		expect(b).toBe("fresh");
		expect(calls).toBe(1);
	});

	it("clears tokens and throws a 401 AppError on invalid_grant", async () => {
		const store = new Map([
			["google-oauth", JSON.stringify({ access: "old", refresh: "bad", expiry: 1_000_000 + 1000 })],
		]);
		const deps = fakeDeps({
			secretGet: async (name) => store.get(name) ?? null,
			secretDelete: async (name) => {
				store.delete(name);
			},
			fetchImpl: (async () =>
				new Response("invalid_grant", { status: 400 })) as unknown as typeof fetch,
		});
		await expect(getAccessToken(deps)).rejects.toMatchObject({ status: 401, code: "GOOGLE_AUTH" });
		expect(store.has("google-oauth")).toBe(false);
	});

	it("throws GOOGLE_AUTH when nothing is connected", async () => {
		await expect(getAccessToken(fakeDeps())).rejects.toMatchObject({ code: "GOOGLE_AUTH" });
	});
});
