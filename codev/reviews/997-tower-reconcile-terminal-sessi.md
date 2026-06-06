# PIR Review: Reconcile terminal sessions before serving requests

Fixes #997

## Summary

On a Tower restart the HTTP server opened its port and began answering `/api/state`, `/api/overview`, and WebSocket terminal upgrades *before* `reconcileTerminalSessions()` had re-registered persistent (shellper-backed) sessions, so the first post-restart read saw a half-populated `role → terminalId` map and a client couldn't tell "successor not registered yet" from "session gone". This PR adds a monotonic startup-readiness barrier that the readers of reconcile's output await until reconcile settles, making the first reachable `/api/state` deterministic with no client-side polling, and exposes the same signal as a `ready` flag on `/health`.

## Files Changed

- `packages/codev/src/agent-farm/servers/tower-terminals.ts` (+86 / -1) — readiness barrier + gate on `getRehydratedTerminalsEntry`
- `packages/codev/src/agent-farm/servers/tower-websocket.ts` (+9 / -1) — gate both terminal-upgrade routes on the barrier
- `packages/codev/src/agent-farm/servers/tower-routes.ts` (+5 / -0) — `ready` on `/health`
- `packages/core/src/tower-client.ts` (+8 / -0) — optional `TowerHealth.ready`
- `packages/codev/src/agent-farm/__tests__/tower-terminals.test.ts` (+79 / -0) — barrier + gated-rehydrate unit tests
- `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` (+20 / -1) — `/health.ready` test
- `packages/codev/src/agent-farm/__tests__/tower-websocket.test.ts` (+4 / -0) — mock fast-path settled

## Commits

- `6cdfa8b4` [PIR #997] Add optional ready flag to TowerHealth wire type
- `ae9e7b7c` [PIR #997] Add startup-readiness barrier; gate getRehydratedTerminalsEntry on it
- `4199849e` [PIR #997] Gate WS upgrade on reconcile barrier; report ready on /health
- `33395b51` [PIR #997] Tests: readiness barrier, gated rehydrate, /health.ready

## Test Results

- `npm run build`: ✓ pass
- `npm test`: ✓ pass — full unit suite 3249 passed, 13 skipped, 0 failed (7 new: 6 barrier/gating + 1 `/health.ready`)
- Manual verification: approved by the human at the `dev-approval` gate (running worktree).

## Architecture Updates

Added a short "Startup Readiness Barrier (#997)" subsection to `codev/resources/arch.md` under the Shellper section. It records the new startup invariant: Tower binds the port immediately (liveness) but gates terminal-state reads and WS terminal upgrades on reconcile completion via a settled-once barrier, and `/health.ready` exposes it. Worth documenting because it's a cross-cutting ordering invariant future Tower-startup work must preserve (a new endpoint that reads `workspaceTerminals` should route through `getRehydratedTerminalsEntry`, which already carries the gate).

## Lessons Learned Updates

Added one lesson to `codev/resources/lessons-learned.md`: process-liveness is not readiness — `server.listen()` firing (and `/health` returning `healthy`) means the process accepts connections, not that async startup work is done. Gate consumers of startup-reconcile output on an explicit completion barrier, and keep the liveness signal separate from the readiness signal so a slow reconcile can't make Tower look dead to a supervisor. This extends the bugfix-274 ordering lesson (which suppressed *on-the-fly* reconnect during reconcile via `_reconciling` but left the serve-before-reconcile window open) and the #971/#991 thread on successor recovery.

## Things to Look At During PR Review

- **Barrier release paths** (`tower-terminals.ts`): `markStartupReconcileSettled()` fires from `reconcileTerminalSessions()`'s `finally` (success *or* throw) and from its early `!_deps` return. Plus `whenStartupReconcileSettled(timeoutMs)` has a defensive timeout (default 10s, `CODEV_STARTUP_READY_TIMEOUT_MS`). Three independent ways serving can never wedge forever. Worth confirming the `finally` placement covers the throw path (it does — `markStartupReconcileSettled` is after `_reconciling = false`).
- **WS fast-path**: `if (!isStartupReconcileSettled()) await whenStartupReconcileSettled();` keeps post-startup upgrades fully synchronous (zero per-upgrade microtask overhead and no behavior change once settled). This is also why the existing synchronous WS upgrade tests pass without modification — the test mock reports the barrier settled.
- **Timeout releases the waiter, not the barrier**: on the defensive timeout, the individual request proceeds but `isStartupReconcileSettled()` / `/health.ready` stay `false` until reconcile genuinely finishes. Intentional.
- **`ready` is additive, not load-bearing**: the determinism guarantee comes from the await-barrier on `getRehydratedTerminalsEntry`; `ready` on `/health` is the optional explicit signal (keeps `status:'healthy'` as pure liveness — matters for `restartTower`'s wait-for-`/health` logic in `tower-starter.ts`).

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-997 → **Review Diff**
- **Run / verify** (this repo restarts Tower to pick up the change):
  1. `pnpm -w run local-install` with a builder/architect terminal active (rebuilds + restarts Tower)
  2. Immediately after restart: `curl -s localhost:<port>/health | jq .ready` (watch it flip `false`→`true`) and `curl -s .../api/state` — the role→terminalId mapping is complete on the **first** read
  3. Open a terminal tab in VSCode/dashboard right after restart — it attaches without a stale-session blip
