// Central home for cross-module constants. Values are unchanged from their
// original sites — this file only gives them one address.

/** Loopback host the backend binds to (localhost trust boundary). */
export const HOST = "127.0.0.1";
/** First port tried by the free-port scan. */
export const FIRST_PORT = 8765;

/** Target chunk size (chars) for KB text splitting. */
export const KB_CHUNK_SIZE = 800;
/** Overlap (chars) between adjacent KB chunks. */
export const KB_CHUNK_OVERLAP = 120;

/** Reranker sigmoid score above which a KB hit is a confident answer. */
export const RERANK_STRONG = 0.5;
/** Reranker score below which the KB almost certainly lacks the answer. */
export const RERANK_WEAK = 0.05;

/** Similarity links per node in the arrange graph. */
export const ARRANGE_SIM_K = 4;
/** Minimum cosine similarity to draw an arrange link. */
export const ARRANGE_SIM_FLOOR = 0.3;
/** Force-simulation ticks per cluster settle. */
export const ARRANGE_TICKS = 400;
/** Extra px added to each card's collision radius (breathing room). */
export const ARRANGE_PAD = 36;
/** Gutter (avg-radius units) the simulation is solved at. */
export const ARRANGE_REF_GAP = 8;

/** Chunks contextualized per parallel LLM batch. */
export const CONTEXTUALIZE_BATCH = 5;

/** SSE comment-ping interval — under typical 30s proxy/TCP idle cutoffs. */
export const HEARTBEAT_MS = 25_000;

/** Default timeout for outbound HTTP requests (see http.ts). */
export const HTTP_TIMEOUT_MS = 15_000;

/** Timeout for one-shot LLM completions — generation is far slower than a plain fetch. */
export const LLM_TIMEOUT_MS = 120_000;

/** Bun.serve idleTimeout in seconds. Above LLM_TIMEOUT_MS so a slow completion
 *  times out upstream (clean 504) rather than getting its socket dropped. */
export const SERVER_IDLE_TIMEOUT_S = 180;

/** Timeout for outbound file downloads (Drive export/download can be large). */
export const FETCH_BYTES_TIMEOUT_MS = HTTP_TIMEOUT_MS * 4;

/**
 * Fallback Google OAuth client, used when no user override (Settings) and no
 * ARBOR_GOOGLE_CLIENT_ID/SECRET env var is set. Empty until a real Google
 * Cloud OAuth client is provisioned for distribution — until then, users must
 * supply their own client (Settings → Google account → "Use your own OAuth
 * client") or set the env vars.
 */
export const GOOGLE_CLIENT_ID_DEFAULT = "";
export const GOOGLE_CLIENT_SECRET_DEFAULT = "";

/** Scopes requested for Drive read access + basic profile (shows connected email). */
export const GOOGLE_OAUTH_SCOPES = [
	"https://www.googleapis.com/auth/drive.readonly",
	"openid",
	"email",
];

/** How long the one-shot OAuth loopback listener waits for the browser redirect. */
export const GOOGLE_OAUTH_LOOPBACK_TIMEOUT_MS = 5 * 60_000;
