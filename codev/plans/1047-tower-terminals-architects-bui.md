# PIR Plan: Tower terminal freeze — oversized replay storm from unbounded no-newline buffers

> Issue #1047. Tower terminals (architects + builders) become non-responsive over time; restart is the only known recovery, and even that is **not reliably** effective.

## Understanding

### Root cause (confirmed end-to-end with captured data)

A full-screen TUI (Claude Code's UI) runs in the alternate screen buffer and redraws **in place** with cursor-addressing and carriage returns, emitting almost **no `\n`**. Several buffers in the terminal path bound themselves **by newline count**, so they never bound for such a stream. The unbounded buffer then produces a **replay payload larger than the client's 1 MB backpressure limit**, which drives the VSCode terminal client into a **tight, backoff-free disconnect/reconnect/replay loop**. That loop — re-serializing a multi-MB replay thousands of times on Tower's single event loop — is the dominant CPU sink and starves every other terminal.

The closed causal loop:

1. **Unbounded accumulation.** `RingBuffer.partial` (`ring-buffer.ts:36-51`) does `combined = this.partial + data; combined.split('\n')` every frame and keeps the trailing fragment; with no `\n`, `partial` grows without bound and each frame re-scans the whole thing (O(partial)/frame → O(n²)/session). The shellper's `ShellperReplayBuffer` (`shellper-replay-buffer.ts:45,58`, fed at `shellper-process.ts:143`) evicts only `while lineCount > maxLines`, so with zero newlines it never evicts. Neither has a byte cap (the only byte cap in the layer is the *stderr* ring's `maxLineLength=10000` at `session-manager.ts:67`).
2. **Oversized replay.** On every (re)connect, Tower sends the buffer as one frame: `ws.send(encodeData(replayLines.join('\n')))` (`tower-websocket.ts:62-65`), where `replayLines = ringBuffer.getAll()` = `[partial]`. For a no-newline session that is the entire accumulated blob.
3. **Client backpressure trips on the replay itself.** The VSCode client's `handleData` (`packages/vscode/src/terminal-adapter.ts:300-308`) does `this.queuedBytes += payload.length; if (this.queuedBytes > MAX_QUEUE /*1 MB*/) { reconnect() }`. The replay frame alone exceeds 1 MB, so it disconnects **before rendering anything**.
4. **Reconnect with no backoff.** `reconnect()` (`terminal-adapter.ts:281-296`) calls `this.backoff.reset()` and reconnects immediately → Tower re-sends the same oversized replay → back to step 3. Infinite loop.

### Captured evidence

PTY disk logs (`~/.agent-farm/logs/*.log`, exact terminal output):

| Session | Size | Newlines | Longest run without `\n` |
|---|---|---|---|
| `f2dc55d1…` (**the storming terminal**) | 1.9 MB | **0** | **1.89 MB (entire file)** |
| `f02bedcb…` (incident window) | 15 MB | **0** | 14.57 MB |
| `d8406afb…` / `4d5523cb…` (normal) | 20–24 MB | ~1.1 M | 5–7 KB |

`f2dc55d1`'s replay = 1.9 MB **> 1 MB** `MAX_QUEUE` → trips backpressure every reconnect. Byte census of the 15 MB `f02bedcb` log: 1,500,892 ESC, 164,652 CR, **0 LF** — a Claude alt-screen redraw stream (`\e[?1049h \e[2J \e[H … \e[3G \r`).

VSCode extension log (`tmp/vscode-log.txt`, 42,143 lines, 21:53→22:51, ~58 min):

- **14,026 "WebSocket connected"**, **14,015 "Backpressure exceeded 1 MB — disconnecting for replay"**, **14,026 "Connecting to"** — a 1:1:1 storm.
- **14,017 of the reconnects target the single terminal `f2dc55d1`**; every other terminal appears 1–2× (normal). One terminal drove ~14,000 oversized replays in under an hour.

Note the threshold is low: it takes only **~1 MB** of no-newline output to cross `MAX_QUEUE` and start the storm, so this is easier to hit than the 15 MB extreme suggests.

### Why this matches every observation

- **CPU ~93% (one core).** Tower re-builds (`getAll()`) and re-serializes (`encodeData`) a multi-MB replay ~14,000 times on its single event loop; the per-frame O(n²) `split` adds to it. One storming session pegs ~one core.
- **ALL terminals freeze at once.** The storm runs on the shared event loop; every other terminal's I/O starves behind it.
- **Memory rises only modestly.** The cost is CPU + GC churn (repeated multi-MB string allocation), not retained memory.
- **Input still works while render-back is frozen** (the stray-`e` screenshot): writing input is tiny and slips through; the replay storm dominates output.
- **Restart is NOT reliable.** `ShellperReplayBuffer` is also unbounded for no-newline streams, so after restart the shellper replays the multi-MB blob, Tower's fresh `partial` is re-seeded from it, the replay is oversized again, and the client re-enters the storm — unless the offending session has gone quiet/ended. That session-dependence is exactly the "not sure restart fixes it" symptom.

### Pathway summary

Output (broken render-back direction): shellper `pty.onData` → `ShellperReplayBuffer.append` **[unbounded]** → socket → Tower `onPtyData` → `RingBuffer.pushData` **[O(n²) + unbounded]** + per-frame `fs.writeSync` **[secondary blocker]** → on (re)connect `getAll()` → `ws.send` a multi-MB replay → client `handleData` **[backpressure trips on replay]** → `reconnect()` **[no backoff]** → loop. Input path (WS → `session.write` → shellper) stays cheap and responsive, matching the symptom.

The earlier EventEmitter listener-leak hypothesis is **demoted to an optional defensive cleanup** — it explains none of the captured evidence (the oversized replay, the 14k-cycle storm, the restart-unreliability), whereas this chain explains all of it.

## Proposed Change

Three coordinated fixes. A + B remove the oversized replay at the source (which alone breaks the storm); C makes the client structurally immune to any future oversized replay (defense-in-depth, and it stops the infinite loop directly).

### Fix A (primary, Tower) — `RingBuffer.pushData`: scan only new data + byte-cap `partial`

- Scan only the incoming `data` for newlines instead of re-splitting `partial + data`, making per-frame work O(|data|) and killing the O(n²) re-scan. Behavior-preserving for replay (same lines, same partial).
- Cap `partial` to a byte limit (`MAX_PARTIAL_BYTES`, comfortably **under** the client's 1 MB `MAX_QUEUE` — e.g. 256 KB), front-trimming when an unbroken run exceeds it. This guarantees `getAll()`/replay stays small, so the client never trips backpressure on a replay. Front-trim (not synthetic `\n` injection) avoids corrupting a TUI replay; reconnect drives a full repaint that self-heals the trimmed prefix.

### Fix B (primary, shellper) — `ShellperReplayBuffer`: byte cap

Add a `maxBytes` cap alongside `maxLines` (it already tracks `totalBytes`): evict oldest chunks while `totalBytes > maxBytes`, with a single-chunk front-trim edge case mirroring the line logic. Bounds shellper memory for no-newline streams and bounds the REPLAY frame so a restart can't re-seed an oversized buffer — making restart-as-recovery deterministic.

### Fix C (primary, VSCode client) — break the backpressure infinite loop

`terminal-adapter.ts` must not enter an unbounded, backoff-free reconnect loop when the replay itself exceeds `MAX_QUEUE`. Direction (final mechanism settled in implementation, validated at `dev-approval`):

- Do **not** `backoff.reset()` on a backpressure-triggered reconnect; apply normal backoff so repeated backpressure can't busy-loop, and/or add a guard so an immediate re-trip after reconnect does not instantly reconnect again.
- Prefer routing the initial replay burst through the already-paced `writeChunked` path (which yields via `setImmediate`) **outside** the live-backpressure budget, rather than counting it as instantaneous overload. The half-present `pause`/`resume` control protocol (`terminal-adapter.ts:345-355`; server would bracket the replay) is the clean way to mark "this is replay, don't count it" — completing that bracket is the preferred long-term shape.

Net: the live-streaming backpressure guard keeps protecting against genuine runaway output, but the **replay** path can no longer cause an infinite disconnect storm.

### Instrumentation (targeted, cheap)

On the existing 30 s SSE heartbeat, log per-session `ringBuffer` partial length and shellper replay byte size, and `WARN` (with terminal id) when a partial exceeds a threshold. Directly observes this cause and confirms the fix holds in production.

### Explicitly out of scope

- Per-frame `fs.writeSync` → async/batched disk log (smaller separate optimization; note for follow-up if profiling after A still shows it).
- The listener-hygiene cleanup (`attachShellper` idempotency, `createSessionRaw` teardown at `pty-manager.ts:161`) — optional; include only if it doesn't bloat the change, else spin to a follow-up issue.
- Default `tower stop` shellper-survival (#274/#832/#999/#991); cron `ReferenceError` (#1048); spawn-failure sibling (#1038).

## Files to Change

- `packages/codev/src/terminal/ring-buffer.ts` — `pushData`: scan-only-data + byte-cap `partial`; add `MAX_PARTIAL_BYTES`.
- `packages/codev/src/terminal/shellper-replay-buffer.ts` — add `maxBytes` cap + byte eviction; thread a default (and a bytes option from `shellper-process.ts:97` if needed).
- `packages/vscode/src/terminal-adapter.ts` — backpressure path: backoff/guard + replay-burst handling so it can't infinite-loop (`handleData` ~300-308, `reconnect` ~281-296; possibly complete the `pause`/`resume` replay bracket).
- `packages/codev/src/agent-farm/servers/tower-websocket.ts` — if the `pause`/`resume` replay bracket is adopted, wrap the replay send (`62-75`).
- `packages/codev/src/agent-farm/servers/tower-server.ts:236-262` — partial/replay-size instrumentation on the SSE heartbeat.
- Tests: `packages/codev/src/terminal/__tests__/` and `packages/vscode/` (see Test Plan).
- VSCode CHANGELOG + `docs/releases/UNRELEASED.md` — user-facing entry for the terminal-freeze fix (per repo convention for vscode-affecting changes).

## Risks & Alternatives Considered

- **Risk: byte-trimming `partial` corrupts a no-newline TUI replay** (loses early escape state). Mitigation: reconnect drives a full TUI repaint; the accelerated test asserts a *normal* newline stream replays byte-identically (no change for the common case); the reviewer validates a live reconnect at `dev-approval`.
- **Risk: the cap clips a legitimately long single line** (e.g. a 200 KB single-line JSON). Mitigation: `MAX_PARTIAL_BYTES` set well above realistic single-line sizes but under `MAX_QUEUE`; it only bounds pathological multi-MB unbroken runs.
- **Risk: Fix C alone (without A/B) only hides the storm.** Mitigation: A/B remove the oversized replay at the source; C is defense-in-depth. We ship all three so neither a Tower-side nor a client-side regression can resurrect the storm.
- **Alternative — only instrument + bisect v3.1.5..v3.1.7.** Rejected as primary: captured data already pins the mechanism without a 12 h+ soak and bisect lands no fix. Bisect stays a fallback if a post-fix soak still shows growth.
- **Alternative — raise the client `MAX_QUEUE`.** Rejected: it only moves the threshold; a larger no-newline stream still crosses it, and it does nothing for the Tower-side O(n²)/memory.

## Test Plan

Run from the worktree (`pnpm --filter @cluesmith/codev …` for core; build the VSCode package for C).

- **Unit — CPU bound (core):** feed a synthetic no-newline stream of M bytes / K frames into `RingBuffer.pushData`; assert `partial.length` stays ≤ cap and per-frame cost stays flat as the stream grows. (Today: partial → M, unbounded re-scan.)
- **Unit — replay correctness (no regression):** a normal newline stream yields byte-identical `getAll()`/`getSince()` before and after.
- **Unit — shellper buffer:** zero-newline stream exceeding `maxBytes` keeps `ShellperReplayBuffer.size ≤ maxBytes`; `getReplayData()` returns the bounded tail.
- **Unit/component — client loop:** simulate a replay frame > `MAX_QUEUE` into `terminal-adapter`'s data path; assert it does **not** enter an unbounded instant-reconnect loop (bounded attempts / backoff applied / replay paced), and that the terminal still renders.
- **Build + suites:** core `pnpm --filter @cluesmith/codev build && … test`; build the VSCode extension.
- **Manual / live (at `dev-approval`):** start Tower on this branch; open an architect terminal running Claude's full-screen UI; let it redraw past ~1 MB of no-newline output. Confirm via `afx tower log -f` that the partial size **plateaus at the cap** and Tower CPU stays low, and via the VSCode terminal log that there is **no** connect→backpressure→reconnect storm (contrast with the 14k-cycle capture). Reconnect the tab and confirm the screen repaints correctly. Optionally restart Tower against a still-busy session and confirm CPU does **not** re-saturate.
- **Soak (post-merge / verify, non-gating):** several hours on a real workload; CPU stays flat, no storms in the VSCode log.

## Open Questions for the Reviewer

1. **Cap sizes:** `MAX_PARTIAL_BYTES` ~256 KB (must stay < the client's 1 MB `MAX_QUEUE`) and `ShellperReplayBuffer maxBytes` ~ a few MB. OK, or make them env-configurable?
2. **Fix C shape:** minimal (backoff + re-trip guard) now, or the fuller `pause`/`resume` replay-bracket so replay never counts toward backpressure? The latter is cleaner but touches both client and Tower.
3. **Listener hygiene:** include the optional defensive cleanup here, or split to a follow-up to keep this PR scoped to the storm fix?
