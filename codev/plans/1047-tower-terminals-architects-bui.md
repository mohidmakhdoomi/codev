# PIR Plan: Tower terminal freeze — oversized replay storm from unbounded no-newline buffers

> Issue #1047. Tower terminals (architects + builders) become non-responsive over time; restart is the only known recovery, and even that is **not reliably** effective.

## Understanding

### Root cause (confirmed end-to-end with captured data)

A full-screen TUI (Claude Code's UI) runs in the alternate screen buffer and redraws **in place** with cursor-addressing and carriage returns, emitting almost **no `\n`**. Several buffers in the terminal path bound themselves **by newline count**, so they never bound for such a stream. The unbounded buffer then produces a **replay payload larger than the client's 1 MB backpressure limit**, which drives the VSCode terminal client into a **tight, backoff-free disconnect/reconnect/replay loop**. That loop — re-serializing a multi-MB replay thousands of times on Tower's single event loop — is the dominant CPU sink and starves every other terminal.

The closed causal loop:

1. **Unbounded accumulation.** `RingBuffer.partial` (`ring-buffer.ts:36-51`) does `combined = this.partial + data; combined.split('\n')` every frame and keeps the trailing fragment; with no `\n`, `partial` grows without bound and each frame re-scans the whole thing (O(partial)/frame → O(n²)/session). The shellper's `ShellperReplayBuffer` (`shellper-replay-buffer.ts:45,58`, fed at `shellper-process.ts:143`) evicts only `while lineCount > maxLines`, so with zero newlines it never evicts. Neither has a byte cap (the only byte cap in the layer is the *stderr* ring's `maxLineLength=10000` at `session-manager.ts:67`).
2. **Oversized replay.** On every (re)connect, Tower sends the buffer as one frame: `ws.send(encodeData(replayLines.join('\n')))` (`tower-websocket.ts:62-65`), where `replayLines = ringBuffer.getAll()` = `[partial]`.
3. **Client backpressure trips on the replay itself.** The VSCode client's `handleData` (`packages/vscode/src/terminal-adapter.ts:300-308`) does `this.queuedBytes += payload.length; if (this.queuedBytes > MAX_QUEUE /*1 MB*/) { reconnect() }`. The replay frame alone exceeds 1 MB, so it disconnects **before rendering anything**.
4. **Reconnect with no backoff.** `reconnect()` (`terminal-adapter.ts:281-296`) calls `this.backoff.reset()` and reconnects immediately, opening the bare `/ws/terminal/<id>` (no `resume`) → Tower re-sends the same full oversized replay → back to step 3. Infinite loop.

### Captured evidence

PTY disk logs (`~/.agent-farm/logs/*.log`, exact terminal output):

| Session | Size | Newlines | Longest run without `\n` |
|---|---|---|---|
| `f2dc55d1…` (**the storming terminal**) | 1.9 MB | **0** | **1.89 MB (entire file)** |
| `f02bedcb…` (incident window) | 15 MB | **0** | 14.57 MB |
| `d8406afb…` / `4d5523cb…` (normal) | 20–24 MB | ~1.1 M | 5–7 KB |

`f2dc55d1`'s replay = 1.9 MB **> 1 MB** `MAX_QUEUE`. Byte census of the 15 MB log: 1,500,892 ESC, 164,652 CR, **0 LF** — a Claude alt-screen redraw stream (`\e[?1049h \e[2J \e[H … \e[3G \r`).

VSCode extension log (`tmp/vscode-log.txt`, 42,143 lines, ~58 min): **14,026** "WebSocket connected" / **14,015** "Backpressure exceeded 1 MB" / **14,026** "Connecting to" (1:1:1), **14,017** of them targeting the single terminal `f2dc55d1`. Only **~1 MB** of no-newline output is needed to start the storm.

### Why this matches every observation

- **CPU ~93% (one core), all terminals freeze at once:** Tower re-builds + re-serializes a multi-MB replay ~14,000 times on its single event loop, starving every other terminal. Input stays responsive (tiny); output is frozen — matching the stray-`e` screenshot.
- **Memory barely moves:** the cost is CPU + GC churn, not retained memory.
- **Restart is NOT reliable:** `ShellperReplayBuffer` is also unbounded, so after restart the shellper replays the multi-MB blob, Tower re-seeds an oversized `partial`, and the storm resumes unless the offending session has gone quiet/ended.

The earlier EventEmitter listener-leak hypothesis is **demoted to a defensive cleanup** (folded in below) — it explains none of the captured evidence, whereas this chain explains all of it.

### Local vs remote hosting raises the stakes

Tower can run on loopback (same machine as VSCode) or remotely (cloud / via the tunnel). Three things flip when remote, and they shape the fix:

- **Reconnects are frequent remotely** (WAN blips, tunnel timeouts, sleep/wake) — so a *full replay on every reconnect* is paid routinely, not just during the storm. Reconnect-path leaks also accumulate proportionally faster.
- **Bytes cost money and bandwidth remotely** — 14k × 1.9 MB ≈ 26 GB/hr for one terminal; even a *bounded* buffer re-shipped on every reconnect is wasteful.
- **"Reconnect to relieve backpressure" is harmful remotely** — it re-downloads the whole buffer over the congested link. Notably Tower's *live-output* side already does the resilient thing (`if (ws.bufferedAmount < WS_HIGH_WATER_MARK) ws.send(...)` — it **drops** ephemeral frames, `tower-websocket.ts:47`); the client's remedy is the opposite and must be brought into line.

## Proposed Change

One coordinated change built on four resilience principles (correct regardless of hosting; load-bearing remotely): bound by bytes, make reconnect a cheap delta, separate replay from live overload, and keep a hard last-resort safety net.

### Fix A (Tower) — `RingBuffer`: scan-only, byte-cap, and byte-addressable resume

- **Scan only the incoming `data`** for newlines instead of re-splitting `partial + data` → per-frame work O(|data|), killing the O(n²) re-scan. Behavior-preserving for replay.
- **Byte-cap `partial`** (`MAX_PARTIAL_BYTES`), front-trimming an over-cap unbroken run. Bounds CPU/memory/bandwidth. Front-trim (not synthetic `\n`) avoids corrupting a TUI replay; reconnect drives a full repaint that self-heals.
- **Byte-addressable sequence:** advance a monotonic byte counter on every `pushData` (not only on completed lines), and make `getSince(seq)` return the bytes after that offset (reconstructed across the retained lines + partial). Today `seq` only moves on a completed line, so for a no-newline stream `currentSeq` stays 0 and resume returns the whole partial — defeating resume exactly when it's needed most. This is what makes Fix C's delta-reconnect actually work for TUI streams. If a client's position is older than the retained window, fall back to a bounded full replay (≤ cap).

### Fix B (shellper) — `ShellperReplayBuffer`: byte cap

Add a `maxBytes` cap alongside `maxLines` (it already tracks `totalBytes`): evict oldest chunks while `totalBytes > maxBytes`, with a single-chunk front-trim edge case mirroring the line logic. Bounds shellper memory and the REPLAY frame so restart can't re-seed an oversized buffer.

### Fix C (VSCode client) — reconnect/backpressure redesign (`terminal-adapter.ts`)

- **Delta reconnect:** reconnect with `?resume=<lastSeq>` (the client already tracks `lastSeq` from `seq` control frames — it's currently dead code) so a reconnect ships only new bytes, not the whole buffer. The biggest remote win.
- **Replay excluded from backpressure:** deliver the replay burst through the already-paced `writeChunked` path (yields via `setImmediate`) and do **not** count it toward `queuedBytes`. Use the half-present `pause`/`resume` control bracket (`terminal-adapter.ts:345-355`) to mark "this is replay" so the client renders any replay size without tripping. This also removes the hard cross-package `MAX_PARTIAL_BYTES < MAX_QUEUE` coupling — once replay never counts as backpressure, the caps are about Tower cost, not client safety.
- **Live overload drops, not reconnects:** when *live* (post-replay) output exceeds the budget, drop/coalesce frames (terminal output is ephemeral; the next repaint heals it), mirroring Tower's `bufferedAmount` drop. Reconnect becomes a last resort, never the routine remedy.
- **Hard safety net kept:** do not `backoff.reset()` on a backpressure-driven reconnect; retain the backoff curve + give-up so no Tower bug, tunnel flap, or future regression can busy-loop.

### Fix D (Tower) — replay bracket + resume wiring (`tower-websocket.ts`)

Bracket the replay send with `pause` → replay data → `resume` control frames so the client can exclude it from backpressure; honor `?resume=<seq>` via `attachResume` (already present) using Fix A's byte-aware `getSince`; emit the byte-aware `seq`.

### Fix E (Tower) — reconnect-path listener hygiene (folded in)

`attachShellper` (`pty-session.ts:119-197`) becomes idempotent (remove prior `data`/`exit`/`close` listeners before re-subscribing); the on-the-fly reconnect / `createSessionRaw` path (`pty-manager.ts:161`) tears down any pre-existing PtySession under a reused id before replacing it. Frequent remote reconnects make this matter more than it does locally.

### Cap configuration + invariant

`MAX_PARTIAL_BYTES` (~256 KB) and `ShellperReplayBuffer maxBytes` (~ a few MB) configurable via env for cloud tuning. With Fix C the `< MAX_QUEUE` relationship is no longer correctness-critical, but keep a startup assertion/log if both are set so a misconfig is visible rather than silent.

### Instrumentation

On the existing 30 s SSE heartbeat, log per-session `ringBuffer` partial length + shellper replay byte size, and `WARN` (with terminal id) when a partial exceeds a threshold.

### Explicitly out of scope

- Per-frame `fs.writeSync` → async/batched disk log (separate optimization; note for follow-up if profiling after A still shows it).
- Default `tower stop` shellper-survival (#274/#832/#999/#991); cron `ReferenceError` (#1048); spawn-failure sibling (#1038).

## Files to Change

- `packages/codev/src/terminal/ring-buffer.ts` — scan-only `pushData`; byte-cap `partial`; byte-addressable `seq` + `getSince`. `MAX_PARTIAL_BYTES`.
- `packages/codev/src/terminal/shellper-replay-buffer.ts` — `maxBytes` cap + byte eviction; thread default/option from `shellper-process.ts:97`.
- `packages/vscode/src/terminal-adapter.ts` — delta reconnect (`?resume=`), replay-excluded-from-backpressure (`pause`/`resume` bracket), live-overload drop, keep backoff/give-up (`handleData` ~300-321, `reconnect` ~281-296, `connect` ~130-160).
- `packages/codev/src/agent-farm/servers/tower-websocket.ts` — bracket replay with `pause`/`resume`; resume via byte-aware `getSince`; emit byte-aware `seq` (`53-75`).
- `packages/codev/src/terminal/pty-session.ts` — `attachShellper` idempotency (Fix E).
- `packages/codev/src/terminal/pty-manager.ts:161` — `createSessionRaw` teardown of reused-id session (Fix E).
- `packages/codev/src/agent-farm/servers/tower-server.ts:236-262` — instrumentation + cap-config validation.
- Possibly `@cluesmith/codev-types` / `ws-protocol` — only if the `pause`/`resume`/`seq` control shapes need additions (they appear to exist already).
- Tests under `packages/codev/src/terminal/__tests__/`, `packages/codev/src/agent-farm/__tests__/`, and `packages/vscode/` (see Test Plan).
- `packages/vscode/CHANGELOG.md` + `docs/releases/UNRELEASED.md` — user-facing entry.

This is a large, multi-package change. It is sequenced so commits are independently reviewable (A → B → D → C → E → instrumentation), and the `dev-approval` reviewer can exercise it incrementally. The minimal safety net (Fix C backoff/give-up) means even a partial landing cannot regress into a storm.

## Risks & Alternatives Considered

- **Risk: byte-addressable resume is subtle** (reconstructing the delta across the line/partial boundary; off-by-one re-sends or gaps). Mitigation: unit tests asserting `getSince(seq)` returns exactly the bytes after `seq` for newline and no-newline streams; the bounded-full-replay fallback covers the out-of-window case; the backpressure-exclusion (Fix C) means even a wrong-but-large resume can't storm.
- **Risk: front-trimming `partial` drops early escape state** (e.g. alt-screen enter). Mitigation: reconnect drives a full TUI repaint; replay-correctness test asserts a normal newline stream is byte-identical before/after.
- **Risk: dropping live frames loses output.** Mitigation: only under genuine sustained overload (same regime Tower already drops in); terminal output is ephemeral and repainted; this is strictly better than the freeze it replaces.
- **Risk: PR size / blast radius across core + shellper + vscode.** Mitigation: sequenced commits; each fix is independently correct; behind no feature flag but each is small and locally testable; `dev-approval` gates the running result.
- **Alternative — land A/B/C-minimal now, resume/E as fast-follow.** Considered and set aside per decision to do it all together; the remote-resilience value of resume + clean reconnect path is the point.
- **Alternative — just raise `MAX_QUEUE`.** Rejected: moves the threshold, fixes neither the Tower O(n²)/memory nor the remote bandwidth cost.

## Test Plan

Run from the worktree (`pnpm --filter @cluesmith/codev …` for core; build the VSCode package).

- **Unit — RingBuffer:** (a) no-newline stream keeps `partial.length ≤ cap` and per-frame cost flat; (b) normal newline stream replays byte-identically (no regression); (c) `getSince(seq)` returns exactly the post-`seq` bytes for both newline and no-newline streams, with the bounded fallback when out of window.
- **Unit — ShellperReplayBuffer:** zero-newline stream over `maxBytes` keeps `size ≤ maxBytes`; `getReplayData()` returns the bounded tail.
- **Unit/component — client (`terminal-adapter`):** (a) a replay frame > `MAX_QUEUE` renders (paced) and does **not** enter a reconnect loop; (b) reconnect issues `?resume=<lastSeq>`; (c) sustained live overload drops/coalesces rather than reconnecting; (d) repeated genuine backpressure backs off and eventually gives up (no busy-loop).
- **Unit — Fix E:** many reconnect/re-attach cycles keep shellper-client listener counts and live PtySession count bounded; a single data frame is processed exactly once.
- **Build + suites:** core build + test green; VSCode extension builds.
- **Manual / live (at `dev-approval`), both hosting modes:**
  - *Local:* open an architect terminal running Claude's full-screen UI; drive it past ~1 MB of no-newline output. Confirm via `afx tower log -f` that partial size plateaus at the cap and CPU stays low, and via the VSCode terminal log that there is **no** connect→backpressure→reconnect storm (contrast the 14k-cycle capture). Reconnect the tab and confirm correct repaint and that the reconnect used `resume` (delta, small payload).
  - *Remote-ish:* repeat against a Tower reached over the tunnel (or with induced latency/drops); confirm reconnects ship deltas not full buffers, no storm, and the terminal stays usable across forced disconnects.
- **Soak (post-merge / verify, non-gating):** several hours on a real workload; CPU flat, no storms in the VSCode log.

## Decisions (confirmed with architect — "do all together")

1. **Caps:** env-configurable; `MAX_PARTIAL_BYTES` ~256 KB, `ShellperReplayBuffer maxBytes` ~ a few MB; invariant no longer correctness-critical thanks to Fix C, but surfaced if misconfigured.
2. **Fix C:** the full design — delta `resume` reconnect + replay-excluded-from-backpressure + live-overload-drops + retained backoff/give-up.
3. **Listener hygiene (Fix E):** folded into this PR.
4. **Resume/delta reconnect (incl. byte-addressable seq):** included — the remote-resilience centerpiece.
