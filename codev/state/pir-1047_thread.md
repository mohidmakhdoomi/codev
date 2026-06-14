# PIR #1047 — Tower terminals freeze until restart

## Phase: plan (in progress)

### Investigation summary
- Symptom (from issue + 4 diagnostic comments): CPU climbs linearly with uptime (0.6% → 93% over ~10h), ALL PTY terminals freeze, restart fixes it, memory grows only +76MB (minor), FD growth glacial. SSE clients churn/marked-dead is a *secondary* symptom of CPU starvation (and SSE 5-min max-age eviction is by-design, not the bug).
- Leak-shape: CPU-bound work proportional to a growing in-memory collection, iterated on a per-data-frame or per-tick hot path. Regression window points at PIR #991 (terminal reconnect / successor-session resolution).
- Comments already ruled out: cron firing (bursty, bounded), the SSE pump itself (well-defended), GC-stall/memory mechanism (RSS minor).

### Code findings (grounded)
- `PtySession.onPtyData` (pty-session.ts:251-281) is the per-data-frame hot path: pushes ring buffer, writes disk log, iterates `this.clients`, emits `'data'`. The shellper `client.on('data')` fan-out (attachShellper, pty-session.ts:142) feeds it.
- HAZARD 1: `createSessionRaw` (pty-manager.ts:126-163) does `this.sessions.set(id, session)` with NO teardown of a pre-existing entry under the same id. Its safety comment ("map is empty at reconcile time, can't collide") only holds at startup reconcile, NOT the on-the-fly reconnect path (tower-terminals.ts:923) which runs live.
- HAZARD 2: `attachShellper` (pty-session.ts:119-197) adds `data`/`exit`/`close` listeners to the shellper client with no prior-listener removal; nothing explicitly detaches the OLD PtySession from its OLD client on reconnect (relies on GC, which fails if the old client stays referenced/alive).
- On-the-fly reconnect (tower-terminals.ts:860-958) is guarded by `!session`, so it fires once per lost-session window (NOT every poll — the subagent over-claimed "every poll"). Exact trigger for repeated accumulation is not confirmable by static read alone.

### Plan direction (initial draft — superseded)
First draft led with an EventEmitter listener-leak theory + instrumentation. Demoted after empirical work below.

### ROOT CAUSE CONFIRMED (empirical, 2026-06-15)
Architect pushed back: do we have a real hypothesis, and is restart actually the fix? Investigated the live state + on-disk PTY logs.

- Tower currently DOWN; 12 shellpers persist (by design).
- Measured `~/.agent-farm/logs/*.log` (raw PTY output). Incident-window log `f02bedcb…` (14 Jun 21:01, 15 MB) has **0 newlines** — longest no-newline run = the entire 14.57 MB. Byte census: 1.5M ESC, 164K CR, 0 LF → a Claude full-screen TUI redraw stream (`\e[?1049h \e[2J \e[H … \e[3G \r`). Normal sessions: ~20 bytes/line, longest line ~5-7KB.
- Root cause: two buffers bound by NEWLINE COUNT, never bound for a no-newline TUI stream:
  1. `RingBuffer.pushData` (ring-buffer.ts:36-51): `partial + data` then `split('\n')` every frame → O(partial) per frame, O(n²)/session, partial unbounded. No byte cap (only the stderr ring at session-manager.ts:67 has maxLineLength=10000).
  2. `ShellperReplayBuffer.append` (shellper-replay-buffer.ts:45,58): evicts only when lineCount>maxLines → 0 newlines → never evicts → unbounded; fed by shellper-process.ts:143.
- Explains ALL symptoms incl. the two the listener theory couldn't: CPU-without-memory, and **restart-unreliability** (shellper replay is also unbounded → restart re-seeds a 15 MB partial → O(n²) resumes unless the heavy session is gone). That is the answer to "not sure restart resolves it."

### Fix (plan rewritten)
Primary: (1) RingBuffer.pushData scan only `data` + byte-cap `partial` (front-trim); (2) ShellperReplayBuffer byte cap. Secondary/optional: listener hygiene (attachShellper idempotent, createSessionRaw teardown). Plus targeted instrumentation (log partial/replay sizes on the 30s heartbeat). Accelerated unit tests compress the leak into CI; replay-correctness test guards no-regression.

Plan rewritten in codev/plans/1047-tower-terminals-architects-bui.md — still at plan-approval gate, awaiting review. Two open questions for reviewer: cap sizes, and whether to include listener-hygiene here or split it out.

### CLINCHER: client-side replay storm (2026-06-15, from VSCode log)
Architect supplied tmp/vscode-log.txt (42,143 lines, 58 min) + screenshot. Storm confirmed:
- 14,026 "WebSocket connected" / 14,015 "Backpressure exceeded 1MB" / 14,026 "Connecting to" (1:1:1).
- 14,017 reconnects target ONE terminal: f2dc55d1. Its disk log = 1.9 MB, 0 newlines → replay 1.9 MB > client MAX_QUEUE (1 MB).
- Client handleData (terminal-adapter.ts:300-308): queuedBytes += payload; if >1MB → reconnect(). reconnect() (281-296) does backoff.reset() → instant retry, no backoff. Tower re-sends the 1.9 MB replay (tower-websocket.ts:62-65 getAll() = [partial]) → infinite loop.
- This replay storm (Tower re-serializing multi-MB replay ~14k×/hr on the single event loop) is the DOMINANT CPU driver; O(n²) split is secondary. Only ~1 MB of no-newline output is needed to trigger.

### Plan now has 3 coordinated fixes
A: RingBuffer.pushData scan-only-data + byte-cap partial (< MAX_QUEUE). B: ShellperReplayBuffer byte cap. C: client backpressure path must not infinite-loop (backoff + re-trip guard; ideally pause/resume bracket so replay isn't counted as live backpressure). Plus instrumentation. Still at plan-approval gate.
