# PIR #997 — reconcile terminal sessions before serving requests

## Plan phase

### Investigation findings
- Startup in `tower-server.ts`: `http.createServer` (343) → `server.listen()` (349) → inside the
  listen callback: shellper init, `initTerminals`, `startSendBuffer`, then
  `await reconcileTerminalSessions()` (405). So the TCP port is open and the HTTP handler
  is live *before* reconcile re-registers persistent sessions. That's the race.
- #991 (PR #999, merged) pivoted to **preserving terminal ids across restart** (pty-manager:121,
  tower-terminals). So the successor-id *reassignment* is gone on main; `recoverSuccessor` named
  in the issue does NOT exist on main (991 dropped that approach). What remains is the
  *registration-timing* race: state/WS served before reconcile finishes registering sessions.
- Shared chokepoint: `getRehydratedTerminalsEntry()` (tower-terminals.ts:164) feeds BOTH
  `/api/state` (handleWorkspaceState) and `/api/overview`. Gating here covers both with one edit.
- WS upgrade (`tower-websocket.ts:188`) calls `getSession()` directly — needs its own gate.
- `/health` = `handleHealthCheck` (tower-routes.ts:286) reports process-up only, no readiness.
- Existing `isReconciling()` (tower-terminals.ts:82) can't distinguish "not started" from "done"
  (false in both) → need a distinct settled-once barrier.
- Reconcile probes are already per-session time-bounded (session-manager socket timeouts ~5s),
  so a hung shellper won't block indefinitely — mitigates the issue's hung-probe concern.
- reconcile is startup-only (single call site, tower-server.ts:405).

### Chosen approach (hybrid; recommended at plan-gate)
Bounded **readiness barrier** + `ready` flag on `/health`:
- New settled-once barrier in tower-terminals.ts, resolved in `reconcileTerminalSessions()` finally.
- `getRehydratedTerminalsEntry` awaits the barrier → /api/state + /api/overview deterministic.
- WS upgrade awaits the barrier before getSession → no spurious reject during window.
- /health gains `ready: isStartupReconcileSettled()` (stays immediately answerable = liveness).
- Await-in-handler (not 503) → deterministic single call, zero required client changes.

Rejected: moving reconcile before listen() (closes port during startup, bigger refactor, hung
probe makes Tower wholly unreachable); 503-during-window (forces client poll); readiness-endpoint
alone (every client must learn handshake to get determinism).

Plan written, awaiting plan-approval gate.
