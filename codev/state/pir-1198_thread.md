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
