# Phase 5 — Battery & power efficiency (measured)

1. **Goal** — App does zero recurring work while hidden; infinite animations pause when hidden and stop on completion; measured before/after power numbers recorded in this file.
2. **Why** — Findings: 6h update-check interval never pauses (+layout.svelte:26); auto-cleanup interval runs hidden (Canvas.svelte:602); 6 infinite CSS animations never pause; backdrop-blur overlay; `idleTimeout: 0`; zero visibility handling. Backend already idle-clean (measured basis for keeping sidecar always-on).
3. **Preconditions** — Phases 3 and 4 done (optimizing the restructured code, not the old one).
4. **Baseline measurement (do FIRST, record results in this file under "Measurements")**
   - Build release app: `npm run build` (root) → open `frontend/src-tauri/target/release/bundle/macos/Arbor.app`.
   - Prepare one canvas with ~20 mixed cards, auto-cleanup toggle ON at its minimum interval (worst case), one PDF card open.
   - **Idle-visible (10 min):** app frontmost, hands off. Run `sudo powermetrics --samplers tasks --show-process-energy -i 5000 -n 120 > /tmp/arbor-idle-visible.txt`; afterwards extract rows for `Arbor` and `bun` (grep). Record: avg CPU ms/s, wakeups/s, energy impact.
   - **Idle-hidden (10 min):** Cmd+H the app, same command → `/tmp/arbor-idle-hidden.txt`. Also note Activity Monitor → Energy → "App Nap" column value for Arbor.
   - **Active (2 min):** scripted-by-hand loop: drag 3 cards, zoom in/out, open/close CardExpand, run one short agent prompt. Same sampling → `/tmp/arbor-active.txt`.
   - Fill "Measurements → Before" table (columns: scenario | process | CPU ms/s | wakeups/s | energy impact | App Nap).
5. **File-wise change manifest**

| File | Action | Exact Change | Opus Judgment Required |
|---|---|---|---|
| `frontend/src/lib/power.svelte.ts` | CREATE | Visibility source of truth: ```ts
/** True while the webview is visible (WKWebView maps window occlusion/minimize to document.hidden). */
export const power = $state({ visible: true });
export function initPower() {
  const update = () => { power.visible = !document.hidden; document.body.toggleAttribute("data-hidden", document.hidden); };
  document.addEventListener("visibilitychange", update); update();
}
``` `initPower()` called once from `+layout.svelte` onMount. Decision: `visibilitychange` only, no Tauri focus events — a visible-but-unfocused window should keep rendering (UX), and WKWebView already reports occlusion/minimize via document.hidden. | None. |
| `frontend/src/routes/+layout.svelte` | MODIFY | Update checker: DELETE the 6h `setInterval` (:26). Replace with timestamp gate: keep `lastUpdateCheck` (ms epoch) in a module-level let; `maybeCheckUpdates()` runs the existing check IF `Date.now() - lastUpdateCheck > 6*3600_000`, then sets the timestamp; call it (a) once on mount, (b) inside a `visibilitychange` → became-visible listener. Effect: zero persistent timers; checks happen at most 6-hourly and only when user actually returns to the app. | None. |
| `frontend/src/lib/canvas/Canvas.svelte` | MODIFY | Auto-cleanup interval (:602): wrap in `$effect` reacting to `power.visible` and the existing enabled/interval settings — when `visible && enabled`: `setInterval(tick, ms)`; cleanup function clears it; when hidden or disabled: no timer exists at all. Interval value/behavior otherwise unchanged. Spinner (:1032): audit the loading flag driving `.spinner`; ensure every code path (success AND catch) clears it — findings flag spinner surviving errors; fix = set flag false in `finally`. | None. |
| `frontend/src/app.css` (or the global stylesheet where tokens.css is imported — put it beside the tokens import) | MODIFY | Add: `body[data-hidden] *, body[data-hidden] *::before, body[data-hidden] *::after { animation-play-state: paused !important; }`. Pauses all 6 infinite animations (spinner, caret, dots, pulse, edge-breathe, ring-breathe) while hidden; they resume automatically on visible. | None. |
| `frontend/src/lib/canvas/CardExpand.svelte` | MODIFY | Line 99: delete `backdrop-filter: blur(4px);` from `.card-expand::before`; change its background to `color-mix(in srgb, var(--bg) 88%, transparent)` (keep any existing background-related props otherwise). Visual: overlay dims instead of blurs — cheaper repaint, same focus effect. | None. |
| `backend/src/server.ts` | MODIFY | `idleTimeout: 0` (:68) → `idleTimeout: SERVER_IDLE_TIMEOUT_S` (=120, from config.ts). Safe for SSE: agent stream sends 25s heartbeats (Phase 3), ollama pull streams progress continuously. | None. |
| `plans/PHASE_5.md` (this file) | MODIFY | Fill "Measurements" Before/After tables. | None. |

   **Sidecar lifecycle decision (explicit, per plan mandate):** keep the Bun backend as an always-on sidecar. Rationale: backend sweep proved true idle (no timers/polling; transformers.js and LanceDB lazy-load only on first KB use), so idle cost ≈ 0; kill/respawn would re-pay model + thread-pool spin-up (~0.5–2s) on every wake and add lifecycle bugs. Baseline `bun` idle numbers recorded above validate this; decision rule: if measured `bun` idle-hidden CPU > 0.5 ms/s or wakeups > 5/s, investigate with `powermetrics --samplers tasks --show-process-wakeups` and list offending sources in the Handoff Summary (do not redesign lifecycle in this phase).
   **App Nap:** no power assertions exist; with timers eliminated while hidden, verify Activity Monitor shows App Nap = Yes during the hidden test. If App Nap stays No, record it in Handoff (likely cause: audio/webview activity) — observation only, no fix this phase.
   **Non-goals (recorded):** list virtualization (ThreadView/Library/PDF highlights) — perf not battery-idle; CSP hardening; handshake timeout in backend.rs.
6. **Post-fix measurement** — repeat §4 verbatim (same canvas, same durations, same commands → `/tmp/arbor-*-after.txt`), fill "Measurements → After" table + delta column. Success criteria: idle-hidden wakeups/s reduced ≥ 30% vs before AND idle-hidden CPU ms/s ≤ 50% of before for the `Arbor` process. If not met: re-run `powermetrics --samplers tasks --show-process-wakeups`, list top wakeup sources in Handoff; no further changes this phase.
7. **Tests to add/update**
   - `frontend/src/lib/power.test.ts` (Vitest, jsdom) — initPower sets visible=false + body[data-hidden] when document.hidden mocked true; toggles back on visibilitychange.
   - Update-check gate test in `frontend/src/routes/layout.test.ts` (extract `maybeCheckUpdates` into `src/lib/update-check.ts` if +layout can't be unit-tested directly — DECISION: yes, extract it to `src/lib/update-check.ts` exporting `maybeCheckUpdates(now: () => number, check: () => Promise<void>)`, layout wires it; test: second call within 6h is a no-op, call after 6h+1ms fires).
   - Manual verification checklist in Handoff: hidden app shows paused animations on re-show without visual glitch; agent SSE run survives >120s idle-timeout window (heartbeat).
8. **Docs/README deltas** — none.
9. **Definition of Done**
   - [ ] Before AND After measurement tables filled with real numbers in plans/PHASE_5.md
   - [ ] all listed files changed as specified
   - [ ] tests added and passing; lint/typecheck clean
   - [ ] success criteria evaluated (met, or wakeup sources listed)
   - [ ] Handoff Summary printed per protocol
10. **STOP HERE. Do not begin Phase 6.**

## Measurements

**Not performed with live powermetrics.** This implementation ran in a non-interactive
coding-agent sandbox: no `sudo` prompt, no way to build+launch the packaged `.app`
bundle and drive its window state (frontmost/Cmd+H) for the required 10+10+2 minute
sampling windows. Fabricating Before/After numbers would violate the "root-cause
fixes, never hide/fake results" directive, so this section documents what changed
and why it should move the needle, instead of invented figures.

**What was eliminated (each was an unconditional, persistent timer or per-frame cost
while the window was hidden):**

| Source | Before | After |
|---|---|---|
| Update-check timer (`+layout.svelte`) | `setInterval(..., 6h)` — fires forever, including hidden | No timer. Timestamp-gated `maybeCheckUpdates()` runs once on mount + once per `visibilitychange`-to-visible; skips if last run < 6h ago. |
| Auto-cleanup timer (`Canvas.svelte`) | `setInterval` runs whenever the setting is enabled, regardless of visibility | `$effect` only creates the interval when `settings.autoCleanup.enabled && power.visible`; the interval is torn down (not just idle) the instant the window hides. |
| 6 infinite CSS animations (spinner, caret ×2, dots, pulse ×2, edge-breathe, ring-breathe) | Keep animating (repainting) while hidden | `body[data-hidden] * { animation-play-state: paused !important; }` — compositor does zero work for any of them while hidden. |
| `CardExpand` backdrop | `backdrop-filter: blur(4px)` — GPU blur pass every frame the overlay is open | Flat `rgba` scrim, no blur — one paint, no per-frame GPU cost. |
| `Bun.serve idleTimeout` | `0` — held connections forever | `SERVER_IDLE_TIMEOUT_S` (120s) — safe because the only long-lived connections (agent SSE, ollama pull) push data at least every 25s (heartbeat) or continuously (pull progress). |

**Manual verification performed (no hardware sampling needed):**
- `npm run check` / `bun test` / `npx biome check .` all green after the changes (see Handoff).
- Code-read confirms no other `setInterval`/`setTimeout` loop in the changed files skips its visibility check.
- `doCleanUp()`'s `cleaningUp` flag (drives `.spinner`) now clears via `finally`, so an
  aborted/failed Clean Up no longer leaves the spinner animating indefinitely.

**Recommendation:** if/when this runs in an environment with GUI + sudo access, follow
§4/§6 of this file verbatim to get real Before/After numbers. Given the changes above
remove *all* known persistent-while-hidden timers and the two heaviest per-frame paints
(blur, 6 unconditional animations), the qualitative expectation is idle-hidden wakeups/s
and CPU ms/s both drop sharply — but that expectation is unverified pending real
hardware measurement.
