# PIR Plan: Terminal WebSocket reconnect loop — backoff, give-up, and one-click recovery

**Issues:** Fixes #936 (reconnect-loop fix) **and** #939 (manual-reconnect affordance).
Per architect instruction (2026-06-02), both ship in this single PR — #939 builds directly on the give-up state introduced by #936, so they are designed together.

## Understanding

### #936 — the spam loop

`packages/vscode/src/terminal-adapter.ts:137-143` reacts to a WebSocket `close` by firing a yellow `[Codev: Connection lost, reconnecting...]` notice and trusting "terminal-manager" to reconnect. Three compounding defects, all confirmed by investigation:

1. **The comment is a lie.** `terminal-manager.ts` never subscribes to the adapter's `onDidClose` and never calls `adapter.reconnect()` (verified: the only adapter-lifecycle subscription is `vscode.window.onDidCloseTerminal` at `terminal-manager.ts:373`, which only tears the terminal *down*). The adapter calls its own `reconnect()` in exactly one place — the backpressure path at `terminal-adapter.ts:169`. So on a normal close, **nothing reconnects** — the notice is printed and the socket stays dead. The "spam" is whatever upstream churn re-enters this path; there is no owned, coordinated reconnect.
2. **No rate limiting.** The notice fires synchronously on every `close`. A fast-failing connection (Tower 404s the upgrade because the session ID is gone) produces several lines per second.
3. **No give-up.** No retry bound, no backoff, no terminal failure state. It cannot resolve itself; the user must reload the window / restart Tower / close+reopen the tab.

**Root-cause framing:** the adapter must *own* a bounded, backed-off reconnect loop with a terminal give-up state, instead of emitting a notice and delegating to a subscriber that does not exist.

### #936 design-call #4 — can we detect "session unknown" and give up early?

Investigated Tower's WS server. **Tower rejects an unknown session ID with `HTTP/1.1 404` + `socket.destroy()` at the HTTP-upgrade stage, before the WebSocket handshake completes** (`tower-websocket.ts:163-166` direct route, `235-238` workspace route). It therefore sends **no WebSocket CLOSE frame** for session-not-found. The only close code Tower ever emits is `1001 "Server shutting down"` on graceful shutdown (`tower-server.ts:134`). The protocol's control-message `error` type exists (`packages/types/src/websocket.ts:13`) but is **never sent** anywhere.

So the issue's hoped-for "read the close-frame reason" signal does not exist. **However**, a failed upgrade surfaces in the `ws` client as an **`error` event** (`Error: Unexpected server response: 404`) immediately before the `close`. That *is* the "session unknown" signal — and it's the single most common cause of this bug (stale ID after Tower restart). We can exploit it for an immediate give-up rather than burning ~60s of doomed retries.

### #939 — recovery after give-up

Once #936's loop gives up, the terminal is dead and recovery is a 3-click cross-surface dance (close tab → sidebar → reopen). #939 adds a **one-click affordance** at the failure site. Architect confirmed **Shape 1 (terminal link)**: the give-up line carries a clickable token; clicking calls `adapter.reconnect()` with a fresh retry budget. Investigation confirms the mechanism is already in use — `BuilderTerminalLinkProvider` is registered at `extension.ts:761-765`, and adapters are reachable from a link handler via the `terminals` map keyed `{terminal, pty}` (`terminal-manager.ts:23`), so the handler can map `context.terminal → pty.reconnect()` by terminal identity (no token-parsing needed).

### Prior art — PR #937 (CLOSED)

A third-party PR took the right shape (exp backoff + max retries) but earned REQUEST_CHANGES on three points, **all of which this plan incorporates from the outset**:
1. **Stale-close identity race** — `ws.on('close')` didn't verify the closing socket is still `this.ws`; the backpressure `reconnect()` (close-then-reopen) leaves the *old* socket's late `close` to schedule a stray retry against the healthy new connection. → **Identity guard** (capture the socket in the closure, bail if `this.ws !== captured`).
2. **Stream-state leak** — the scheduled-reconnect callback called `connect()` without the `decoder` + `EscapeBuffer` resets that the existing `reconnect()` does (`terminal-adapter.ts:156-157`); stale partial ANSI bytes garble the replay (the exact bug `EscapeBuffer`/#630 exists to prevent). → **Shared `resetStreamState()`** called on every (re)connect path.
3. **Tests** — used `sinon` (not a dep here) and exercised helpers, not the real loop. → **Vitest** (already the `src/__tests__` harness; `sinon` is not a dependency) driving the **real** `ws`-close → backoff → give-up sequence.

## Proposed Change

### Part A — #936: adapter owns a bounded reconnect loop (`terminal-adapter.ts`)

Turn the adapter into the sole owner of reconnection, mirroring `connection-manager.ts`'s backoff curve for cross-layer consistency and adding the give-up bound that layer lacks.

**New state:**
```ts
private reconnectAttempt = 0;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
private gaveUp = false;
private static readonly MAX_RECONNECT_ATTEMPTS = 6;   // ~1+2+4+8+16+30 ≈ 61s
private static readonly MAX_RECONNECT_DELAY = 30000;  // matches connection-manager.ts:25
```

**Close handler (replaces `terminal-adapter.ts:137-143`)** — capture socket identity, drop stale closes, delegate to the scheduler:
```ts
const socket = this.ws;                 // identity captured in closure (PR#937 finding 1)
this.ws.on('close', () => {
  if (this.disposed || this.ws !== socket || this.gaveUp) { return; }
  this.log('WARN', 'WebSocket closed');
  this.scheduleReconnect();
});
```

**Error handler** — fast give-up on a 404 upgrade rejection (design-call #4 signal):
```ts
this.ws.on('error', (err) => {
  this.log('ERROR', `WebSocket error: ${err.message}`);
  if (/Unexpected server response: (404|400|410)/.test(err.message)) {
    this.giveUp('this terminal session no longer exists on Tower');
  }
});
```
*(The exact `ws` error string for a non-101 upgrade response will be confirmed empirically during implement via an induced 404 — see Risks. If the match proves unreliable, we degrade gracefully to the N-retry give-up; nothing breaks.)*

**`scheduleReconnect()`** — one notice per backoff interval, bounded:
```ts
private scheduleReconnect(): void {
  if (this.disposed || this.gaveUp || this.reconnectTimer) { return; }
  if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
    this.giveUp(`unable to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
    return;
  }
  const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY);
  this.reconnectAttempt++;
  this.writeEmitter.fire(
    `\x1b[33m[Codev: Connection lost — retrying in ${delay/1000}s ` +
    `(attempt ${this.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})]\x1b[0m\r\n`);
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    this.resetStreamState();   // PR#937 finding 2
    this.connect();
  }, delay);
}
```

**`giveUp()`** — terminal failure state; the message carries the clickable token #939 matches:
```ts
private giveUp(reason: string): void {
  this.gaveUp = true;
  if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  this.writeEmitter.fire(
    `\x1b[31m[Codev: Connection lost — ${reason}. Click here to reconnect]\x1b[0m\r\n`);
}
```

**`resetStreamState()`** — extracted from the existing `reconnect()` (`L156-157`), reused everywhere:
```ts
private resetStreamState(): void {
  this.decoder = new TextDecoder('utf-8', { fatal: false });
  this.escapeBuffer = new EscapeBuffer();
}
```

**Reset on success** — in `ws.on('open')` (or right after auth) clear the loop state so a recovered connection starts fresh:
```ts
this.reconnectAttempt = 0;
this.gaveUp = false;
```

**`reconnect(wsUrl?)`** (manual + backpressure path) — now also resets the loop budget and give-up flag (full fresh chain, #939 design-call #2 default), and routes its stream reset through the shared helper:
```ts
reconnect(wsUrl?: string): void {
  if (wsUrl) { this.wsUrl = wsUrl; }
  if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
  this.reconnectAttempt = 0;
  this.gaveUp = false;
  if (this.ws) { this.ws.close(); this.ws = null; }
  this.resetStreamState();
  this.connect();
}
```

**`close()`** — clear the timer on dispose so no retry fires after teardown.

**The misleading comment** at `:141` is deleted; the new code is self-documenting ("adapter owns reconnect").

### Part B — #939: one-click recovery (Shape 1, terminal link)

**`terminal-manager.ts`** — add a terminal→adapter reverse lookup:
```ts
reconnectByTerminal(terminal: vscode.Terminal): void {
  for (const managed of this.terminals.values()) {
    if (managed.terminal === terminal) { managed.pty.reconnect(); return; }
  }
}
```
Matching by terminal identity (not by parsing the role from the token) keeps it robust for every terminal kind (`builder-*`, `architect:*`, `dev-*`, `shell-*`).

**`terminal-link-provider.ts`** — add a second, single-purpose provider:
```ts
export class ReconnectTerminalLinkProvider implements vscode.TerminalLinkProvider {
  constructor(private terminalManager: TerminalManager) {}
  provideTerminalLinks(ctx, _t) {
    // match the literal "Click here to reconnect" token emitted by giveUp()
    const marker = 'Click here to reconnect';
    const i = ctx.line.indexOf(marker);
    return i === -1 ? [] : [{ startIndex: i, length: marker.length, tooltip: 'Reconnect this terminal' }];
  }
  handleTerminalLink() {
    const term = vscode.window.activeTerminal;   // the give-up terminal is active when clicked
    if (term) { this.terminalManager.reconnectByTerminal(term); }
  }
}
```
*(Mapping the click back to its terminal: `TerminalLinkProvider.handleTerminalLink` does not itself carry the terminal, but `provideTerminalLinks(ctx)` does via `ctx.terminal`. Implementation will thread `ctx.terminal` into the returned link object — VSCode passes the same link instance back to `handleTerminalLink` — so we reconnect exactly the terminal whose line was clicked, not merely the active one. The snippet above is illustrative; the threaded-context form is the one we ship.)*

**`extension.ts`** — register alongside the existing provider (near `:761-765`):
```ts
context.subscriptions.push(
  vscode.window.registerTerminalLinkProvider(new ReconnectTerminalLinkProvider(terminalManager)),
);
```

Default VSCode link styling (auto-themes dark/light/high-contrast — #939 design-call #3 default). Because `giveUp()` re-prints the marker on every give-up cycle, the link works **every** time (#939 design-call #4 default + acceptance bullet 4); and `reconnect()` resets the attempt counter, giving a full fresh chain (#939 design-call #2 default).

## Files to Change

- `packages/vscode/src/terminal-adapter.ts` — **core of #936.** New fields + constants; rewrite `ws.on('close')` (identity guard) and `ws.on('error')` (404 fast give-up); add `scheduleReconnect()`, `giveUp()`, `resetStreamState()`; reset loop state on `open`; update `reconnect()` and `close()`; delete the wrong comment at `:141`.
- `packages/vscode/src/terminal-manager.ts` — add `reconnectByTerminal(terminal)` reverse lookup (#939).
- `packages/vscode/src/terminal-link-provider.ts` — add `ReconnectTerminalLinkProvider` (#939).
- `packages/vscode/src/extension.ts:~761-765` — register the new provider (#939).
- `packages/vscode/src/__tests__/terminal-adapter.test.ts` — **NEW** Vitest suite (mock `vscode` + `ws`, fake timers) exercising the real close loop. See Test Plan.
- `packages/vscode/src/__tests__/reconnect-link-provider.test.ts` — **NEW** Vitest test: marker match + `reconnectByTerminal` routing (#939).
- `codev/reviews/936-terminal-adapter-websocket-clo.md` — written in the Review phase (not now).

**No `package.json` change.** Per #936 design-call #2, give-up threshold is a hard-coded `6` with **no config knob in v1** (the `codev.terminalReconnectMaxAttempts` knob is the documented future escape hatch; investigation captured the exact convention if the architect wants it added — see Alternatives).

## Risks & Alternatives Considered

- **Risk — `ws` 404 error-string brittleness.** The 404 fast-give-up matches `err.message`. If the `ws` version emits a different string, the regex misses and we silently fall back to the N-retry give-up (correct, just slower). **Mitigation:** confirm the literal string empirically during implement against an induced stale-session 404; the N-retry path is the guaranteed backstop, so a miss is non-fatal. *(Per my standing practice: verify library behavior empirically rather than trusting the assumed string.)*
- **Risk — give-up message wording is now load-bearing for #939.** The link provider matches a literal substring in `giveUp()`'s output. If the two drift, the link silently disappears. **Mitigation:** define the marker as a shared exported constant imported by both the adapter and the provider, so they cannot drift; a provider unit test asserts the match against the real emitted string.
- **Risk — `handleTerminalLink` targeting the wrong terminal.** Using `activeTerminal` is fragile if focus moved. **Mitigation:** thread `ctx.terminal` from `provideTerminalLinks` into the link object (VSCode returns the same instance to the handler) and reconnect *that* terminal — see Part B note.
- **Alternative — in-place notice overwrite (`\r\x1b[K`).** The issue floats overwriting one status line. **Rejected:** fragile across renderers and interleaves badly with Tower's replayed PTY output after reconnect. One line per backoff interval already satisfies "not multiple per second / not a wall of identical lines" and survives interleaving cleanly.
- **Alternative — `codev.terminalReconnectMaxAttempts` config knob.** **Deferred** per the issue's stated v1 default. Convention is known (`package.json contributes.configuration`, `getConfiguration('codev').get<number>(...)`) and trivial to add later.
- **Alternative — wire reconnect into `terminal-manager` via `onDidClose` (restore the original comment's contract).** **Rejected:** the adapter already owns the socket lifecycle, the decoder, the EscapeBuffer, and the backpressure reconnect; splitting reconnect ownership across two files reintroduces the coordination gap that caused this bug. Adapter-owned is the simpler invariant.

## Test Plan

**Automated (Vitest, `pnpm --filter @cluesmith/codev-vscode test:unit`):** new `terminal-adapter.test.ts` mocks `vscode` (FakeEventEmitter, per the established `workspace-sse-subscriber.test.ts` pattern) and `ws` (a fake socket exposing `.on`/`.close`/`.send` and letting the test fire `open`/`close`/`error`), with `vi.useFakeTimers()`. It drives the **real** `CodevPseudoterminal`:
- **Backoff cadence:** successive closes schedule retries at 1s → 2s → 4s → 8s → 16s → 30s (cap), asserting one notice per interval (not per-event spam).
- **Give-up bound:** after the 6th failed attempt, no further timer is scheduled and a single red give-up line is emitted.
- **404 fast give-up:** an `error` event with `Unexpected server response: 404` gives up immediately (no backoff sequence).
- **Stale-close identity guard (PR#937 #1):** call `reconnect()`, then fire the *old* socket's `close` — assert it does **not** schedule a stray retry against the new socket.
- **Stream-state reset (PR#937 #2):** the scheduled-reconnect callback produces a *new* `decoder`/`EscapeBuffer` before `connect()` — assert behaviorally that a partial ANSI sequence buffered on the dead connection is not prepended to the first post-reconnect write.
- **Reset on success:** an `open` after some failed attempts clears `reconnectAttempt`/`gaveUp` so a later close restarts at the 1s base delay.
- `reconnect-link-provider.test.ts`: `provideTerminalLinks` matches the real `giveUp()` line via the shared marker constant and returns the correct span; `handleTerminalLink` routes to `terminalManager.reconnectByTerminal` for the clicked terminal.

**Manual (the `dev-approval` gate — run the worktree via `afx dev pir-936`):** induce each disconnect class and confirm the notice/backoff/give-up/recovery reads well:
1. **Tower restart mid-session** (stale ID): expect the **404 fast give-up** → red "session no longer exists" line → click "reconnect" → fresh chain.
2. **PTY death / kill the agent process:** expect backed-off retries (1s,2s,4s…) one line per interval, then give-up after 6.
3. **Transient blip** (briefly pause Tower, then resume before 6 attempts): expect a clean reconnect with buffered-output replay intact (no garbled ANSI — validates the stream-state reset) and the counter reset to 0.
4. **Click-to-reconnect repeatability:** after a give-up, click the link, let it fail and give up again, click again — link works every cycle.
5. **No regression** to the happy reconnect path: kill+restore Tower with the session still valid → clean reconnect, replay intact.

## Out of Scope (per #936/#939)

- Tower-side session-lifecycle changes (this is a client-resilience fix).
- The session-resumption / buffer-replay path (#442/#629) — assumed working; only the retry/notice surface changes.
- Shapes 2 (toast) and 3 (status-bar) from #939 — Shape 1 only, per architect.
- The move-between-groups failure (#803) — different trigger; may incidentally improve, not targeted.
