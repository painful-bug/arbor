// Google OAuth (loopback + PKCE, desktop-app flow). Tokens live in Bun.secrets
// under service "app.arbor.canvas" — name "google" is already taken by the
// Gemini provider key, so this uses "google-oauth" (tokens) and "google-client"
// (optional user-supplied client id/secret override).
//
// Every exported function takes an optional `deps` last so tests can inject a
// fake fetch + in-memory secret store instead of hitting the network or the
// real OS keychain (writing a new keychain item can pop a GUI prompt — never
// acceptable in an automated test run).
import { createHash, randomBytes } from "node:crypto";
import {
	GOOGLE_CLIENT_ID_DEFAULT,
	GOOGLE_CLIENT_SECRET_DEFAULT,
	GOOGLE_OAUTH_LOOPBACK_TIMEOUT_MS,
	GOOGLE_OAUTH_SCOPES,
} from "../config.ts";
import { AppError } from "../errors.ts";
import { log } from "../log.ts";

const SERVICE = "app.arbor.canvas";
const TOKEN_NAME = "google-oauth";
const CLIENT_NAME = "google-client";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

interface StoredTokens {
	access: string;
	refresh: string;
	/** ms epoch */
	expiry: number;
	email?: string;
}

interface ClientOverride {
	clientId: string;
	clientSecret?: string;
}

export interface OAuthDeps {
	fetchImpl: typeof fetch;
	secretGet: (name: string) => Promise<string | null>;
	secretSet: (name: string, value: string) => Promise<void>;
	secretDelete: (name: string) => Promise<void>;
	now: () => number;
	loopbackTimeoutMs: number;
}

export const realDeps: OAuthDeps = {
	fetchImpl: fetch,
	secretGet: (name) => Bun.secrets.get({ service: SERVICE, name }),
	secretSet: (name, value) =>
		Bun.secrets.set({ service: SERVICE, name, value }).then(() => undefined),
	secretDelete: (name) => Bun.secrets.delete({ service: SERVICE, name }).then(() => undefined),
	now: () => Date.now(),
	loopbackTimeoutMs: GOOGLE_OAUTH_LOOPBACK_TIMEOUT_MS,
};

function base64url(buf: Buffer): string {
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** S256 PKCE code challenge for a given verifier (RFC 7636 §4.2). Pure — exported for testing. */
export function challengeFromVerifier(verifier: string): string {
	return base64url(createHash("sha256").update(verifier).digest());
}

/** Fresh PKCE verifier/challenge pair. */
export function pkcePair(): { verifier: string; challenge: string } {
	const verifier = base64url(randomBytes(32));
	return { verifier, challenge: challengeFromVerifier(verifier) };
}

async function resolveClient(deps: OAuthDeps): Promise<{ clientId: string; clientSecret: string }> {
	const raw = await deps.secretGet(CLIENT_NAME);
	if (raw) {
		try {
			const o = JSON.parse(raw) as ClientOverride;
			if (o.clientId) return { clientId: o.clientId, clientSecret: o.clientSecret ?? "" };
		} catch {
			log.warn("google-oauth", "stored client override is corrupt JSON — ignoring");
		}
	}
	return {
		clientId: process.env.ARBOR_GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID_DEFAULT,
		clientSecret: process.env.ARBOR_GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET_DEFAULT,
	};
}

/** Store a user-supplied OAuth client (Settings → "Use your own OAuth client"). */
export async function setClientOverride(
	clientId: string,
	clientSecret?: string,
	deps: OAuthDeps = realDeps,
): Promise<void> {
	const o: ClientOverride = { clientId, ...(clientSecret ? { clientSecret } : {}) };
	await deps.secretSet(CLIENT_NAME, JSON.stringify(o));
}

async function loadTokens(deps: OAuthDeps): Promise<StoredTokens | null> {
	const raw = await deps.secretGet(TOKEN_NAME);
	return raw ? (JSON.parse(raw) as StoredTokens) : null;
}

/**
 * One-shot loopback HTTP listener for the OAuth redirect. Resolves with the
 * authorization `code` on the first request carrying the matching `state`;
 * rejects on timeout, a `?error=` redirect, or a state mismatch. Stops itself
 * either way. Exported (not just used internally) so tests can drive it
 * directly with a real port instead of going through the full auth flow.
 */
export function startLoopback(
	expectedState: string,
	deps: OAuthDeps = realDeps,
): { port: number; redirectUri: string; result: Promise<{ code: string }> } {
	let server!: ReturnType<typeof Bun.serve>;
	let settled = false;

	const result = new Promise<{ code: string }>((resolve, reject) => {
		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn();
			setTimeout(() => server.stop(true), 0);
		};
		const timer = setTimeout(() => {
			finish(() =>
				reject(
					new AppError("Google auth timed out — try connecting again", 408, "GOOGLE_AUTH_TIMEOUT"),
				),
			);
		}, deps.loopbackTimeoutMs);
		// A live listener + this timer would otherwise keep the process (and test
		// runner) alive for the full timeout window.
		(timer as unknown as { unref?: () => void }).unref?.();

		server = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch(req) {
				const url = new URL(req.url);
				const error = url.searchParams.get("error");
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				if (error) {
					finish(() => reject(new AppError(`Google auth denied: ${error}`, 401, "GOOGLE_AUTH")));
					return new Response("Authorization denied. You can close this tab.");
				}
				if (!code || state !== expectedState) {
					return new Response("Invalid or expired request.", { status: 400 });
				}
				finish(() => resolve({ code }));
				return new Response("You're connected — return to Arbor.", {
					headers: { "Content-Type": "text/html" },
				});
			},
		});
	});

	return {
		port: server.port as number,
		redirectUri: `http://127.0.0.1:${server.port}/callback`,
		result,
	};
}

function buildAuthUrl(args: {
	clientId: string;
	redirectUri: string;
	challenge: string;
	state: string;
}): string {
	const params = new URLSearchParams({
		client_id: args.clientId,
		redirect_uri: args.redirectUri,
		response_type: "code",
		scope: GOOGLE_OAUTH_SCOPES.join(" "),
		code_challenge: args.challenge,
		code_challenge_method: "S256",
		state: args.state,
		access_type: "offline",
		prompt: "consent", // guarantees a refresh_token even on a re-consent
	});
	return `${AUTH_URL}?${params.toString()}`;
}

async function fetchEmail(accessToken: string, deps: OAuthDeps): Promise<string | undefined> {
	try {
		const res = await deps.fetchImpl(USERINFO_URL, {
			headers: { Authorization: `Bearer ${accessToken}` },
		});
		if (!res.ok) return undefined;
		const info = (await res.json()) as { email?: string };
		return info.email;
	} catch {
		return undefined; // best-effort — connection still succeeds without a display email
	}
}

async function exchangeCode(
	args: { code: string; verifier: string; redirectUri: string },
	deps: OAuthDeps,
): Promise<StoredTokens> {
	const { clientId, clientSecret } = await resolveClient(deps);
	const body = new URLSearchParams({
		code: args.code,
		client_id: clientId,
		redirect_uri: args.redirectUri,
		grant_type: "authorization_code",
		code_verifier: args.verifier,
		...(clientSecret ? { client_secret: clientSecret } : {}),
	});
	const res = await deps.fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok)
		throw new AppError(`Google token exchange failed: ${await res.text()}`, 401, "GOOGLE_AUTH");
	const json = (await res.json()) as {
		access_token: string;
		refresh_token?: string;
		expires_in: number;
	};
	if (!json.refresh_token) {
		throw new AppError(
			"Google did not return a refresh token — revoke Arbor's access at myaccount.google.com and reconnect",
			401,
			"GOOGLE_AUTH",
		);
	}
	const email = await fetchEmail(json.access_token, deps);
	const tokens: StoredTokens = {
		access: json.access_token,
		refresh: json.refresh_token,
		expiry: deps.now() + json.expires_in * 1000,
		email,
	};
	await deps.secretSet(TOKEN_NAME, JSON.stringify(tokens));
	return tokens;
}

let refreshing: Promise<StoredTokens> | null = null;

async function refresh(tokens: StoredTokens, deps: OAuthDeps): Promise<StoredTokens> {
	const { clientId, clientSecret } = await resolveClient(deps);
	const body = new URLSearchParams({
		refresh_token: tokens.refresh,
		client_id: clientId,
		grant_type: "refresh_token",
		...(clientSecret ? { client_secret: clientSecret } : {}),
	});
	const res = await deps.fetchImpl(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		if (text.includes("invalid_grant")) {
			await deps.secretDelete(TOKEN_NAME);
			throw new AppError(
				"Google session expired — reconnect Drive in Settings",
				401,
				"GOOGLE_AUTH",
			);
		}
		throw new AppError(`Google token refresh failed: ${text}`, 502, "UPSTREAM");
	}
	const json = (await res.json()) as { access_token: string; expires_in: number };
	const next: StoredTokens = {
		...tokens,
		access: json.access_token,
		expiry: deps.now() + json.expires_in * 1000,
	};
	await deps.secretSet(TOKEN_NAME, JSON.stringify(next));
	return next;
}

/** Start the OAuth flow: opens a loopback listener, returns the URL to send the user to. */
export async function startAuth(deps: OAuthDeps = realDeps): Promise<{ authUrl: string }> {
	const { clientId } = await resolveClient(deps);
	if (!clientId) {
		throw new AppError(
			"No Google OAuth client configured — set ARBOR_GOOGLE_CLIENT_ID or add one in Settings",
			400,
			"GOOGLE_NO_CLIENT",
		);
	}
	const { verifier, challenge } = pkcePair();
	const state = base64url(randomBytes(16));
	const { redirectUri, result } = startLoopback(state, deps);
	const authUrl = buildAuthUrl({ clientId, redirectUri, challenge, state });

	// Exchange happens in the background; the frontend polls authStatus().
	result
		.then((r) => exchangeCode({ code: r.code, verifier, redirectUri }, deps))
		.catch((err) => log.error("google-oauth", "auth flow failed", err));

	return { authUrl };
}

/** Current connection status (never returns tokens). */
export async function authStatus(
	deps: OAuthDeps = realDeps,
): Promise<{ connected: boolean; email?: string }> {
	const tokens = await loadTokens(deps);
	return tokens ? { connected: true, email: tokens.email } : { connected: false };
}

/** Revoke + drop stored tokens. Best-effort revoke — always clears local state. */
export async function logout(deps: OAuthDeps = realDeps): Promise<void> {
	const tokens = await loadTokens(deps);
	if (tokens?.access) {
		await deps
			.fetchImpl(`${REVOKE_URL}?token=${encodeURIComponent(tokens.access)}`, { method: "POST" })
			.catch(() => {});
	}
	await deps.secretDelete(TOKEN_NAME);
}

/** A valid access token, refreshing (single-flight) when it's within 60s of expiry. */
export async function getAccessToken(deps: OAuthDeps = realDeps): Promise<string> {
	const tokens = await loadTokens(deps);
	if (!tokens)
		throw new AppError("Google Drive not connected — connect it in Settings", 401, "GOOGLE_AUTH");
	if (tokens.expiry - deps.now() > 60_000) return tokens.access;
	if (!refreshing) {
		refreshing = refresh(tokens, deps).finally(() => {
			refreshing = null;
		});
	}
	const next = await refreshing;
	return next.access;
}
