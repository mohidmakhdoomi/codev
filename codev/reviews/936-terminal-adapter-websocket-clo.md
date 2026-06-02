# PIR Review: Terminal WebSocket reconnect loop — backoff, give-up, and one-click recovery

Fixes #936
Fixes #939

## Summary

The VSCode terminal adapter (`terminal-adapter.ts`) used to react to a WebSocket close by printing `[Codev: Connection lost, reconnecting...]` and delegating reconnection to `terminal-manager` — which never subscribed to that event and never reconnected. The result was an unbounded notice loop with no backoff, no give-up, and no actual reconnect. This change makes the adapter the **sole owner** of a bounded reconnect loop: exponential backoff (`1s→2s→4s→8s→16s→30s`, mirroring `connection-manager.ts`), give-up after 6 attempts, an immediate give-up on a 4xx upgrade rejection (Tower's stale-session signal), and a terminal failure state. On top of that give-up state (#939) the failure line carries a clickable "reconnect" affordance via a terminal link provider, mapping the click back to the originating terminal's adapter for a fresh retry chain.

## Files Changed

- `packages/vscode/src/terminal-adapter.ts` (+125 / -9) — adapter-owned reconnect loop: backoff scheduler, give-up state, identity-guarded close handler, 4xx fast-give-up, shared stream-state reset, reset-on-open; deleted the misleading "handled by terminal-manager" comment
- `packages/vscode/src/terminal-manager.ts` (+16) — `reconnectByTerminal(terminal)` reverse lookup (#939)
- `packages/vscode/src/terminal-link-provider.ts` (+32) — `ReconnectTerminalLinkProvider` (#939)
- `packages/vscode/src/extension.ts` (+9 / -1) — register the new provider
- `packages/vscode/src/__tests__/terminal-adapter.test.ts` (+218) — Vitest suite driving the real ws-close → backoff → give-up loop
- `packages/vscode/src/__tests__/reconnect-link-provider.test.ts` (+54) — Vitest suite for the affordance
- `codev/resources/lessons-learned.md` (+1) — Vitest "mocked deps must still resolve" gotcha

## Commits

- `fc69dfdb` [PIR #936] Adapter-owned reconnect: backoff, give-up, identity guard, 4xx fast-give-up
- `898935a2` [PIR #939] Click-to-reconnect affordance on terminal give-up state
- `235856fe` [PIR #936] Vitest regression tests for reconnect loop + recovery affordance
- `b96e205a` [PIR #936] Update builder thread (implement phase)

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass (eslint clean)
- esbuild bundle: ✓ pass
- `vitest run` (porch `build` + `tests` checks): ✓ 208 tests pass, **11 new** (8 adapter close-loop + 3 link provider)
- Manual verification (human, at `dev-approval` gate, running the worktree via `afx dev pir-936`): induced-disconnect scenarios per the plan's Test Plan — Tower restart (stale-session 404 fast-give-up), PTY death (backed-off retries → give-up), transient blip (clean reconnect + replay), click-to-reconnect repeatability, and the happy-path reconnect regression.

## Architecture Updates

No `arch.md` change. The adapter-owned reconnect loop is localized resilience behavior *inside* an already-documented module (`terminal-adapter.ts` — "Pseudoterminal ↔ WebSocket binary protocol", arch.md:1141); it introduces no new module boundary or cross-cutting pattern. The one architecture-adjacent fact this work surfaced — the exponential-backoff reconnect curve is now duplicated across four sites (`connection-manager.ts`, `terminal-adapter.ts`, `dashboard/Terminal.tsx`, `agent-farm/lib/tunnel-client.ts`) with divergent give-up policy (6 vs 50 attempts; session-unknown detection present vs absent) — is being tracked as a **separate `area/core` follow-up issue** (extract a transport-agnostic reconnect policy to `@cluesmith/codev-core`, adopt in vscode + dashboard). That is unsettled design pending an architect call on the canonical policy, so it does not belong in `arch.md` as settled architecture yet.

## Lessons Learned Updates

One durable, repo-specific gotcha promoted to `codev/resources/lessons-learned.md` ([From 936]): in a fresh worktree, `vi.mock('@cluesmith/codev-*')` still fails with "Failed to resolve entry for package" until the mocked workspace dep is built, because Vitest resolves the module ID before substituting the factory and the package `exports` point at an unbuilt `dist/`. Build workspace deps before `vitest run` even for deps you mock.

Two further lessons are already captured by existing entries, so they were **not** duplicated:
- The give-up message text and the link-provider matcher must stay byte-identical or the affordance silently disappears. Solved with a single shared exported constant (`RECONNECT_LINK_TEXT`) imported by both. This is a direct application of the existing lesson [From 818] ("the only durable enforcement is one shared function/symbol both consumers import; extract when the second consumer lands").
- The 4-way backoff-curve duplication is an instance of [From 0134] ("the most impactful deduplication targets are incomplete abstraction layers, not scattered constants") — `EscapeBuffer` was already extracted to core and shared by both terminals, but the reconnect *policy* around it was not. Hence the follow-up issue rather than a fifth in-place copy.

## Things to Look At During PR Review

- **4xx detection robustness** (`terminal-adapter.ts` error handler): the fast-give-up keys off the `ws` library's `error` message `Unexpected server response: 4\d\d`. I verified this empirically against `ws@8.20.0` with a probe server (4xx upgrade → `error` with that exact string, then `close` 1006). If a future `ws` bump changes the string, the match degrades gracefully to the N-retry give-up — non-fatal, just slower. This is the most "library-behavior-dependent" line in the diff.
- **Identity guard** (close handler captures `socket` and bails if `this.ws !== socket`): this is what prevents the backpressure `reconnect()` path (close-then-reopen) from letting the *old* socket's late `close` schedule a stray retry against the healthy new connection. It was finding #1 on the prior closed PR #937; the regression test `ignores a stale socket's close after an intentional reconnect` pins it.
- **Stream-state reset ordering**: the scheduled-reconnect timer resets `decoder` + `EscapeBuffer` *before* `connect()` (prior-PR finding #2 / #630). The test `resets decoder + EscapeBuffer before the scheduled reconnect` asserts the new buffer is constructed on the timer, not eagerly on close.
- **Affordance terminal targeting**: `ReconnectTerminalLinkProvider` threads `context.terminal` through the link object (VSCode hands the same link instance back to `handleTerminalLink`) so we reconnect the terminal whose line was clicked, not merely the active one.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-936` → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-936`
- **What to verify**:
  - Kill Tower mid-session (stale ID) → expect an immediate red "session no longer exists" line with a clickable reconnect token (no yellow retry spam)
  - Kill the PTY/agent → expect one yellow "retrying in Ns (attempt n/6)" line per backoff interval, then a red give-up after the 6th
  - Briefly pause then resume Tower before 6 attempts → clean reconnect with buffered-output replay intact (no garbled ANSI)
  - Click the reconnect link after give-up, let it fail and give up again, click again → works every cycle
  - Happy path: kill + restore Tower with the session still valid → clean reconnect, replay intact (no regression)
