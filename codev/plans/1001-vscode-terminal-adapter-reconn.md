# PIR Plan: Overwrite-in-place reconnect notices, wiped on successful reconnect

Issue: #1001 — `vscode: terminal-adapter reconnect notices accumulate as orphaned scrollback lines; not cleared on successful reconnect`

## Understanding

When a Codev terminal's WebSocket drops, `CodevPseudoterminal.scheduleReconnect()` writes a yellow status notice to the terminal pane on each backoff attempt. Today each notice is terminated with `\r\n` (`packages/vscode/src/terminal-adapter.ts:204-207`), so successive attempts stack as separate scrollback lines:

```
[Codev: Connection lost — retrying in 1s (attempt 1/6)]
[Codev: Connection lost — retrying in 2s (attempt 2/6)]
...
```

Two defects, both rooted in the `#936` implementation taking the "one line per attempt" path without the in-place-overwrite mechanic the `#936` PR body described:

1. **Notices stack instead of overwriting.** The `\r\n` terminator advances to a new line each attempt rather than rewriting the same line.
2. **No success-side wipe.** There is no symmetric handler at the reconnect-success point (`ws.on('open')`, terminal-adapter.ts:132-151) that clears the notice when the connection comes back. After `#991` made in-budget reconnects the common case, the orphaned `[Codev: Connection lost…]` line is left dangling in scrollback above the resumed output until the user closes and reopens the pane.

The give-up state (`#939`'s red `[… Click here to reconnect]` notice, terminal-adapter.ts:230-232) is the terminal *failure* state and must remain visible — only in-progress retry notices should be wiped.

A key enabling fact: on every reconnect, Tower pauses, replays its full scrollback buffer, then resumes (the `pause`/`resume` control messages handled at terminal-adapter.ts:311-321; replayed bytes flow through `handleData` → `writeEmitter`). So any real terminal content transiently erased by an ANSI clear-line is re-rendered by the replay — the notice only ever needs to occupy one transient line.

## Proposed Change

Adopt the overwrite-in-place pattern from the original `#936` intent. Three coordinated edits in `packages/vscode/src/terminal-adapter.ts`, plus tests.

### 1. Add a `hadReconnectNotice` flag

Alongside the existing reconnect-loop state (terminal-adapter.ts:55-57):

```ts
private hadReconnectNotice = false;
```

Tracks whether a wipeable in-progress retry notice currently occupies the terminal's current line. Guards against emitting cursor-control sequences on the happy-path first connect (where no notice was ever written).

### 2. Retry notices overwrite in place (no trailing newline)

In `scheduleReconnect()` (terminal-adapter.ts:204-207), replace the trailing `\r\n` with a leading `\r\x1b[2K` (carriage return + erase-entire-line) and set the flag:

```ts
this.hadReconnectNotice = true;
this.writeEmitter.fire(
  `\r\x1b[2K\x1b[33m[Codev: Connection lost. retrying in ${delay / 1000}s ` +
  `(attempt ${this.backoff.attempt}/${MAX_RECONNECT_ATTEMPTS})]\x1b[0m`,
);
```

Each attempt rewrites the same line; the attempt counter ticks `1/6 → 6/6` in place. (The em dash is dropped from the message text per project convention, as the issue requests.)

### 3. Wipe the notice on successful reconnect

Add a small guarded helper and call it from the `ws.on('open')` handler (terminal-adapter.ts:132-151), right after the existing `this.gaveUp = false;`:

```ts
private clearReconnectNotice(): void {
  if (this.hadReconnectNotice) {
    this.writeEmitter.fire('\r\x1b[2K');
    this.hadReconnectNotice = false;
  }
}
```

Emits exactly one `\r\x1b[2K` to clear the single notice line before Tower's replayed buffer / normal output resumes. No-ops (and emits nothing) when no notice was written — so the happy-path first `open` stays silent.

### 4. Give-up overwrites the retry notice, then stays put

`giveUp()` (terminal-adapter.ts:222-233) transitions from the retry state into the terminal failure state. When reached via the exhausted-budget path, a yellow retry notice is sitting on the current line; the red give-up notice should *replace* it rather than append below it. When reached via the immediate-4xx path (no prior notice), it should not disturb the current line. So prefix the clear conditionally on the flag, and clear the flag (the line now holds the give-up notice, which must NOT be wiped by a later success):

```ts
const prefix = this.hadReconnectNotice ? '\r\x1b[2K' : '';
this.hadReconnectNotice = false;
this.writeEmitter.fire(
  `${prefix}\x1b[31m[Codev: Connection lost. ${reason}. ${RECONNECT_LINK_TEXT}]\x1b[0m\r\n`,
);
```

The give-up notice keeps its trailing `\r\n` (it is the final state — a newline keeps any later output off its line) and is never wiped, satisfying acceptance criterion 3. The em dash in this message is also dropped for consistency, since the line is being edited anyway (minor; see Risks).

## Files to Change

- `packages/vscode/src/terminal-adapter.ts`
  - `:55-57` — add `private hadReconnectNotice = false;`
  - `:132-151` — call `this.clearReconnectNotice()` in the `ws.on('open')` handler after `this.gaveUp = false;`
  - `:204-207` — retry notice: leading `\r\x1b[2K`, drop trailing `\r\n`, set `hadReconnectNotice`, drop em dash
  - `:222-233` — `giveUp()`: conditional `\r\x1b[2K` prefix, clear the flag, drop em dash
  - add the `clearReconnectNotice()` private helper
- `packages/vscode/src/__tests__/terminal-adapter.test.ts`
  - new assertions for overwrite-in-place + success wipe + give-up-stays (see Test Plan)

## Risks & Alternatives Considered

- **Risk: the leading `\r\x1b[2K` on the first retry notice erases a partial last line of real output** (e.g. a drop mid-stream of `yes | head -200`). Mitigation: Tower replays its full buffer on reconnect, so the erased content is re-rendered; the notice is wiped before replay output resumes. The notice never occupies more than one line, so a single clear suffices. Covered by acceptance criterion 4 in the manual test.
- **Risk: editing the give-up message text is slightly beyond the issue's literal request** (the issue only calls out dropping the em dash in the retry notice). Mitigation: `giveUp()` is already being edited for the conditional clear prefix; aligning its em dash is a one-character consistency change with no behavior impact. If the reviewer prefers strict surgical scope, the give-up em dash can be left as-is — flag at the gate.
- **Alternative: a "walk back up N lines and clear" success handler** (as the issue's "why the bug landed" section imagines). Rejected: unnecessary once notices overwrite in place — there is only ever one notice line, so one `\r\x1b[2K` clears it. Simpler and avoids assuming how many lines scrolled.
- **Alternative: keep `\r\n` and clear on success only.** Rejected: leaves the stacking behavior during an active multi-attempt cycle (criterion 1 unmet).

## Test Plan

Unit (`packages/vscode/src/__tests__/terminal-adapter.test.ts`, extending the existing `#936` suite which already drives real `ws` lifecycle events through the adapter):

- **Overwrite-in-place**: drive a multi-attempt reconnect; assert each retry notice contains the erase-line prefix (`\r\x1b[2K`) and no trailing `\r\n`, and that the cumulative buffer contains the latest `(attempt N/6)` as the only live notice line.
- **Wipe on success**: drive one retry notice, then `emit('open')`; assert the post-success writes contain a `\r\x1b[2K` wipe and that no `Connection lost` notice survives un-wiped.
- **Happy-path silence**: a first `open` with no prior close emits no cursor-control wipe (`hadReconnectNotice` false).
- **Give-up stays**: burn the 6-attempt budget; assert the red give-up notice is present, contains `RECONNECT_LINK_TEXT`, overwrote the last retry notice (`\r\x1b[2K` prefix present), and is NOT wiped by any subsequent write.
- **Immediate 4xx give-up**: no retry notice was written, so the give-up notice has no `\r\x1b[2K` prefix (does not disturb the current line) — preserves the existing test's intent.
- Confirm the existing suite (one-notice-per-close, backoff reset, identity guard, EscapeBuffer reset) still passes with the new format.

Build + unit run: `pnpm --filter @cluesmith/codev-vscode test` (and `pnpm --filter @cluesmith/codev-vscode build`) — exact filter confirmed against the package during implement.

Manual (at the `dev-approval` gate, on the running dev host):
- Force a quick Tower bounce within the first 2-3 backoff intervals; confirm the terminal shows a single notice line ticking the attempt counter in place, and **no orphaned `[Codev: Connection lost…]` line** remains after reconnect.
- Run `yes | head -200` and bounce Tower mid-stream; confirm the `\r\x1b[2K` does not leave the pane garbled after reconnect (replay restores the output).
- Exhaust the budget (keep Tower down past 6 attempts); confirm the red `Click here to reconnect` give-up notice remains visible and is not wiped.
