# Builder thread: pir-1198

PIR builder for issue #1198 (shellper reconnect error swallowed, terminal becomes silent zombie).

## Plan phase

- Verified every claim in the issue against the code. All confirmed:
  - `shellper-client.ts` `cleanup()` clears `_connected` before the socket `'close'` event fires, so the `wasConnected` guard suppresses `'close'` on every error-path close.
  - `session-manager.ts` close handlers (both createSession and reconnectSession paths) are the only code that logs "shellper disconnected unexpectedly" and removes the dead session. They never run on error-path closes.
  - `'session-error'` has zero consumers outside session-manager.ts (grep across packages/codev and packages/core).
  - `write()`/`resize()` are silent no-ops when `_connected` is false; the message router logs "Message sent" regardless.
  - `towerStop` sends SIGTERM and returns without waiting.
- Important extra finding: fixing the close emission ALONE is hazardous. The unexpected-close path calls `removeDeadSession` (unlinks the LIVE shellper's socket file) and PtySession's close handler emits 'exit', whose tower-side handler calls `deleteTerminalSession` (deletes the SQLite row). A transient socket error against a healthy shellper would permanently orphan a live Claude conversation. So the plan includes reconnect-in-place (bounded retry) before declaring the session dead. This is also what the issue's item 5 suggests ("re-run the reconnect for that session").
- Second extra finding (matches architect's fleet-sweep comment): both adoption call sites read `client.getReplayData()` synchronously right after `connect()` resolves, racing the REPLAY frame which often arrives in a later socket read. `waitForReplay()` exists and is unused there. This explains the blank-until-poked healthy terminals (6 false positives in the sweep).
- attach.ts (terminal-mode client) has the same swallowed-close symptom and gets fixed for free.

Plan written to codev/plans/1198-shellper-reconnect-error-is-sw.md. Waiting at plan-approval gate.

## Implement phase

Plan approved as written (architect confirmed the core = swallowed close + session-error consumer; heartbeat detection stays a follow-up). Implementation landed in six commits:

1. shellper-client.ts: `_everConnected` + `_intentionalDisconnect` flags; error-path closes now emit 'close'; write/resize return boolean.
2. session-manager.ts: wiring unified into `wireClientEvents`; unexpected close triggers `recoverSession` (up to 3 attempts, 500ms/1s/2s backoff, PID + start-time + socket-file preflight, 3-round cap with 30s stability reset) before the historical dead path; new 'session-reconnected' event. pty-manager.ts gained `findByShellperSessionId` (create flow keys SessionManager by a UUID distinct from the terminal id; adoption keys by terminal id — the helper handles both).
3. pty-session.ts: unexpected-close teardown deferred behind a 15s grace timer (`SHELLPER_CLOSE_GRACE_MS`), cancelled by attachShellper; `writable` getter; boolean write/resize.
4. Tower: session-error now logged at ERROR; session-reconnected re-attaches the replacement client (empty replay to avoid duplicating ring-buffer content); both adoption sites use `waitForReplay()` instead of racing the REPLAY frame; send router returns 503 TERMINAL_NOT_WRITABLE + logs "Message DROPPED" instead of "Message sent"; send-buffer holds messages while a session is unwritable and only drops (loudly) at max age.
5. tower.ts: towerStop polls for process exit (8s), SIGKILL escalation.

Notable test change: tower-shellper-integration's "emits exit with code -1 on unexpected disconnect" was asserting the OLD immediate-teardown behavior; rewritten for the grace-window semantics plus a re-attach-cancels-teardown case.
