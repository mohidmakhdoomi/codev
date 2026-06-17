# PIR Plan: Reconcile terminal sessions before serving requests

## Understanding

On a Tower restart, `tower-server.ts` opens the TCP port and wires up the HTTP
handler *before* startup reconcile re-registers persistent (shellper-backed)
terminal sessions:

- `http.createServer(...)` — `tower-server.ts:343`
- `server.listen(port, bindHost, async () => { ... })` — `tower-server.ts:349`
- inside that listen callback: shellper-manager init, `initTerminals(...)`,
  `startSendBuffer(...)`, **then** `await reconcileTerminalSessions()` — `tower-server.ts:405`

So during the startup window the server already answers requests, but the
`role → terminalId` mapping that reconcile rebuilds isn't there yet:

1. `/api/state` (`handleWorkspaceState`, `tower-routes.ts:1751`) and `/api/overview`
   both read terminal state through the shared rehydration helper
   `getRehydratedTerminalsEntry()` (`tower-terminals.ts:164`). During reconcile,
   on-the-fly reconnection is intentionally suppressed (the `!_reconciling` guard at
   `tower-terminals.ts:780`), so these endpoints return an *incomplete* set of sessions.
2. A WS upgrade to `/ws/terminal/:id` (`tower-websocket.ts:188`) calls
   `getSession()` directly; a not-yet-reconnected session is rejected
   (`rejectUnknownSession`, `tower-websocket.ts:161`).
3. `GET /health` (`handleHealthCheck`, `tower-routes.ts:286`) reports process-up,
   not reconcile-complete — there's no readiness signal to wait on.

A client therefore can't tell *"successor not registered yet (reconcile pending)"*
from *"session gone forever"* — both look identical (absent from state). #991
(PR #999, merged) worked around this client-side; its final fix **preserves terminal
ids across restart** (so the id-reassignment problem named in the issue is already
gone on `main`, and `recoverSuccessor` does not exist here). What remains is the
**registration-timing race** this issue targets at the root.

Note on existing state: `isReconciling()` (`tower-terminals.ts:82`) is `false`
both *before* reconcile starts and *after* it finishes, so it cannot serve as a
"reconcile has completed at least once" readiness signal. We need a distinct,
settled-once barrier.

## Proposed Change

**Approach: a bounded startup-readiness barrier, plus a `ready` flag on `/health`.**
This is the issue's Approach 1 ("reconcile before serving") realized as a
*request-level* barrier rather than a startup reordering, and it folds in Approach 2's
readiness signal essentially for free.

Why this shape (over moving `reconcileTerminalSessions()` ahead of `server.listen()`):

- Reconcile depends on `shellperManager` and `initTerminals(...)`, both initialized
  *inside* the listen callback. Hoisting reconcile means hoisting that whole init block
  and calling `listen()` last — a larger, riskier refactor.
- Moving `listen()` last closes the TCP port during startup, so health checks and other
  workspaces get connection-refused, and a pathologically hung shellper probe would make
  Tower *wholly* unreachable. The barrier keeps the port bound (liveness preserved) and
  holds only reconcile-dependent responses.
- **Awaiting** the barrier inside the request (rather than returning `503`) yields the
  deterministic single-call behavior the acceptance demands — no client retry/poll.

### Mechanics

1. **Barrier state** (owned by `tower-terminals.ts`, which already owns reconcile state):
   a module-level settled-once flag + a pending promise created at module load, with:
   - `markStartupReconcileSettled()` — idempotent; flips the flag and resolves the promise once.
   - `isStartupReconcileSettled(): boolean` — synchronous, for `/health`.
   - `whenStartupReconcileSettled(timeoutMs?): Promise<void>` — awaited by request handlers;
     races the barrier against an optional defensive timeout (default ~10s, env-overridable)
     so a never-resolving barrier can't hang requests forever (logs a warning and proceeds).
   - The barrier is resolved in `reconcileTerminalSessions()`'s `finally` (and on its early
     `!_deps` return), so readiness is tied to reconcile completion, set exactly once, and
     resolved even if reconcile throws (non-blocking-on-failure, per the issue's mitigation).
     Reconcile's own per-session socket timeouts already bound how long this takes.

2. **Gate the shared state chokepoint**: `getRehydratedTerminalsEntry()` awaits
   `whenStartupReconcileSettled()` at the top → `/api/state` *and* `/api/overview` both
   become deterministic with a single edit.

3. **Gate the WS upgrade**: the `/ws/terminal/:id` and workspace-scoped terminal upgrade
   paths await `whenStartupReconcileSettled()` before `getSession()` → no spurious
   `rejectUnknownSession` during the startup window.

4. **Readiness on `/health`**: `handleHealthCheck` adds `ready: isStartupReconcileSettled()`
   to the JSON, computed synchronously (no await) so `/health` stays an immediate liveness
   probe. `status: 'healthy'` is unchanged for liveness; `ready` is the new readiness field.
   Satisfies the acceptance's "or reports ready" path.

5. **Test hook**: export a way to mark the barrier settled (or reset it) so unit tests that
   exercise state without running a full reconcile don't block; the defensive timeout in
   `whenStartupReconcileSettled` is the backstop.

Net: no client changes are *required*. The dashboard's existing 1s state poll
(`POLL_INTERVAL_MS`, `dashboard/src/lib/constants.ts:3`) and any VSCode
`getWorkspaceState` fetch become deterministic for free.

## Files to Change

- `packages/codev/src/agent-farm/servers/tower-terminals.ts`
  - Add the barrier state + `markStartupReconcileSettled` / `isStartupReconcileSettled` /
    `whenStartupReconcileSettled` near the existing `isReconciling()` (≈ line 54–83).
  - Resolve the barrier in `reconcileTerminalSessions()` `finally` and the early return (476–485).
  - `getRehydratedTerminalsEntry()` (164): `await whenStartupReconcileSettled()` before rehydrating.
- `packages/codev/src/agent-farm/servers/tower-websocket.ts`
  - In the upgrade handler (`setupUpgradeHandler`, 183–…), `await whenStartupReconcileSettled()`
    before `getSession()` on the direct and workspace-scoped terminal routes.
- `packages/codev/src/agent-farm/servers/tower-routes.ts`
  - `handleHealthCheck` (286): add `ready: isStartupReconcileSettled()` to the response body.
- Tests (new/extended):
  - Unit: barrier blocks `getRehydratedTerminalsEntry` / state until settled; `/health.ready`
    flips false→true on settle.
  - Restart integration: extend `agent-farm/__tests__/bugfix-430-tower-restart.test.ts` or the
    tower-reconnect e2e — after a restart with active persistent sessions, a **single**
    `/api/state` fetch reflects the completed reconcile (no poll), and the role→terminalId
    mapping is complete on first read.

## Risks & Alternatives Considered

- **Risk: a hung/slow reconcile holds all state + WS requests.** Mitigated three ways:
  reconcile already bounds each shellper probe with socket timeouts; the barrier resolves in
  reconcile's `finally` (so it always settles once reconcile returns); and
  `whenStartupReconcileSettled` carries a defensive timeout that logs and proceeds.
- **Risk: unit tests that don't run reconcile block on the barrier.** Mitigated by the test
  hook (mark/reset settled) plus the defensive timeout backstop.
- **Risk: first terminal WS connect after restart gains a little latency** (waits for settle).
  Bounded, and that determinism is exactly the goal.
- **Risk: `/health` consumers misreading `ready` as liveness.** `status: 'healthy'` is unchanged
  for liveness; `ready` is additive and documented as readiness.
- **Alternative — move `reconcileTerminalSessions()` before `server.listen()` (issue Approach 1
  literal).** Rejected: closes the TCP port during startup (connection-refused for health checks
  and other workspaces), requires hoisting the whole terminal-init block, and a hung probe makes
  Tower wholly unreachable. The barrier preserves liveness.
- **Alternative — `503` during the window.** Rejected: forces clients to retry/poll, contradicting
  "no client polling needed."
- **Alternative — readiness endpoint alone (issue Approach 2, as the whole fix).** Rejected as sole
  fix: every client must learn the handshake to get determinism, so "once Tower is reachable"
  wouldn't be deterministic. We include the `ready` flag as a complement, not the whole fix.

## Test Plan

- **Unit**:
  - Before `markStartupReconcileSettled()`, `whenStartupReconcileSettled()` is pending and
    `isStartupReconcileSettled()` is `false`; after, it resolves and reads `true`.
  - `/health` body includes `ready: false` pre-settle and `ready: true` post-settle.
  - `getRehydratedTerminalsEntry()` does not return until the barrier settles (use the
    defensive-timeout path to keep the test bounded).
- **Restart integration**: with active persistent (shellper-backed) sessions, stop+start Tower,
  then issue **one** `/api/state`; assert every expected role→terminalId mapping is present on the
  first response (no retry loop).
- **Manual**: with a builder/architect terminal running, `pnpm -w run local-install` (restarts
  Tower); immediately `curl /health` (watch `ready` flip false→true) and `curl /api/state`
  (mapping complete on first read). Open a terminal tab in VSCode/dashboard right after restart
  and confirm it attaches without a stale-session blip.
- **Regression**: full `pnpm --filter @cluesmith/codev test` (terminal/reconnect/tower suites).
