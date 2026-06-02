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

## Plan approved → Implement phase (2026-06-02)

Plan-approval gate approved by human; porch advanced to `implement`. Plan committed at 59bf52b6.

**Empirical confirmation (ws 8.20.0):** a rejected WS upgrade fires `error` with message `"Unexpected server response: <code>"` then `close` with code `1006`. So 4xx upgrade rejection (Tower's session-not-found = 404) is detectable client-side. Decision: fast-give-up on `/Unexpected server response: 4\d\d/` (any client error → retry won't help); 5xx/network stay on backoff.

**Implement decisions locked:**
- Shared marker constant `RECONNECT_LINK_TEXT = 'Click here to reconnect'` exported from terminal-adapter, imported by the link provider (prevents drift — plan risk mitigation).
- #939 link carries `context.terminal` threaded through the link object (VSCode returns same instance to handleTerminalLink) → reconnect the clicked terminal, not activeTerminal.
- Worktree had NO node_modules (postSpawn didn't install); ran `pnpm install` in worktree.

**Implementation complete (3 commits):**
- adapter (terminal-adapter.ts): MAX_RECONNECT_ATTEMPTS=6, MAX_RECONNECT_DELAY=30000, exported `RECONNECT_LINK_TEXT`; `scheduleReconnect()`/`giveUp()`/`resetStreamState()`; identity-guarded close; 4xx error fast-give-up; reset-on-open; `reconnect()` resets budget+gaveUp; `close()` clears timer.
- #939 wiring: `terminal-manager.reconnectByTerminal(terminal)`, `ReconnectTerminalLinkProvider` (threads `ctx.terminal` through the link), registered in extension.ts.
- Tests: `__tests__/terminal-adapter.test.ts` (8 cases, mocks vscode/ws/escape-buffer/codev-types, fake timers, drives real close-loop) + `__tests__/reconnect-link-provider.test.ts` (3 cases).

**Verification:** had to `pnpm --filter codev-types build` + `codev-core build` first (unbuilt dist broke vitest module resolution — even mocked deps must resolve). Then: vitest 208/208 pass (11 new), `check-types` clean, `lint` clean, esbuild bundle OK.

Next: push, `porch done 936`, dev-approval gate (human runs worktree via `afx dev pir-936`).

## Review phase (2026-06-02)

dev-approval approved by human → review phase. Wrote `codev/reviews/936-...md` (Summary/Files/Commits/Test Results/Architecture Updates/Lessons Learned/Things to Look At/How to Test). Decisions: no arch.md change (localized resilience in already-documented module; the 4× backoff-curve duplication is tracked as the area/core follow-up, not settled arch); one new lesson promoted ([From 936] Vitest mocked workspace deps must still resolve → build dist first). PR **#962** opened (Fixes #936, Fixes #939), recorded with porch. Ran single-pass 3-way consultation: **gemini=APPROVE, codex=APPROVE, claude=APPROVE** (all HIGH, zero blocking issues). `pr` gate now pending; architect notified (all-clear). Waiting for human to merge PR #962 + approve `pr` gate. Merge is gated by porch state, not pane prose — will verify `gate_status: approved` via `porch next` before `gh pr merge --merge`.
