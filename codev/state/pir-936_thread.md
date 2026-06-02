# PIR #936 — terminal-adapter WS reconnect-loop fix (+ #939 recovery affordance)

## Plan phase (started 2026-06-02)

**Scope (architect-expanded):** single PR fixing BOTH #936 (reconnect-loop: backoff + give-up + identity-checked close + real reconnect) and #939 (manual-reconnect affordance, Shape 1 = `registerTerminalLinkProvider`). PR closes both (`Fixes #936`, `Fixes #939`).

**Prior art — PR #937 (CLOSED, third-party):** had the right shape (exp backoff + max-retries) but 3 REQUEST_CHANGES findings:
1. Race: `ws.on('close')` didn't check the closing socket is still `this.ws` → stray reconnect after intentional `reconnect()` (backpressure path closes+reopens; old socket's close fires late).
2. State leak: `scheduleReconnect()` timer callback called `connect()` without resetting `this.decoder` + `this.escapeBuffer` (existing `reconnect()` does at L156-157) → garbled replay (EscapeBuffer #630 class bug).
3. Tests: used `sinon` (architect says use **Vitest** — already a vscode devDep) and didn't exercise the real ws-close→backoff→give-up sequence. Must drive the real `CodevPseudoterminal` close handler, not helpers.

**Backoff reference (`connection-manager.ts:172-185`):** `delay = Math.min(1000 * Math.pow(2, attempt), 30000)`, increments attempt, resets to 0 on success. No max-attempts (SSE retries forever). Terminal adapter will add a give-up bound (proposed N=6, ~63s).

**Open design calls (resolve at plan-approval):**
- #936: backoff cap (30s, match conn-mgr) / give-up N (6) / config knob (none v1) / session-unknown early give-up (depends on Tower close-frame — under investigation).
- #939: Shape 1 confirmed by architect / reconnect resets attempt counter to 0 / default VSCode link styling / link works every cycle.

Launched investigation workflow (wf_0df35ed1-fc8): Tower close-frame semantics, terminal-manager wiring, Vitest test patterns, registerTerminalLinkProvider integration, config conventions.
